// @himetrica/errorkit-build: stamps Debug IDs into built JS + source maps and
// uploads the maps to Himetrica, so ErrorKit shows original code for minified
// stack traces.
//
// How a frame finds its map:
//   1. each emitted chunk gets a tiny snippet that registers
//      globalThis._hmDebugIds[new Error().stack] = "<uuid>", plus `//# debugId=<uuid>`;
//   2. the chunk's .map gets the same "debugId";
//   3. the browser SDK turns the registry into { file -> debugId } for the frames
//      of an error, and the server fetches the map by debugId.
// No release or URL matching, so CDNs, basePaths and renamed files just work.
//
// The snippet is APPENDED (before the sourceMappingURL comment), never
// prepended: prepending would shift every generated line and break the map, and
// would push a "use strict" directive out of first position.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

export interface ErrorKitBuildOptions {
  /** Project secret key (hm_sk_...). Defaults to HIMETRICA_SECRET_KEY. */
  secretKey?: string;
  /** Same value the SDK's init({ release }) uses. Optional with Debug IDs, kept for the fallback lookup. */
  release?: string;
  /** API origin. Defaults to HIMETRICA_API_URL or https://app.himetrica.com. */
  apiUrl?: string;
  /** Keep the original source inside the uploaded maps (shows code context). Default false. */
  includeSources?: boolean;
  /** Delete the .map files from the build output after uploading (and drop their sourceMappingURL). Default false. */
  deleteMaps?: boolean;
  /** Only inject, do not upload. */
  dryRun?: boolean;
  /** Log lines; default console.log with a prefix. Pass () => {} to silence. */
  log?: (line: string) => void;
  /** Parallel uploads. Default 4. */
  concurrency?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
}

export interface ProcessedFile {
  jsFile: string;
  mapFile: string;
  debugId: string;
  uploaded: boolean;
  bytes: number;
}

const JS_EXT = /\.(m|c)?js$/;
const DEBUG_ID_COMMENT = /\/\/# debugId=([0-9a-f-]{36})\s*$/m;
const SOURCE_MAPPING_URL = /\/\/[#@] sourceMappingURL=([^\s'"]+)\s*$/m;

/** Deterministic v4-shaped uuid from content: same build, same id; no state to keep. */
export function debugIdFromContent(content: string): string {
  const h = createHash("sha256").update(content).digest("hex");
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function snippet(debugId: string): string {
  return `;!function(){try{var e=globalThis,n=(new e.Error).stack;n&&(e._hmDebugIds=e._hmDebugIds||{},e._hmDebugIds[n]="${debugId}")}catch(e){}}();`;
}

/**
 * Stamps one chunk and its map. Idempotent: a chunk that already carries a
 * debugId comment keeps it (rebuilding with the plugin and the CLI is safe).
 * Returns null when the chunk has no map to pair with.
 */
export async function injectFile(jsFile: string, includeSources = false): Promise<{ debugId: string; mapFile: string } | null> {
  let code = await fs.readFile(jsFile, "utf8");
  const mapFile = await findMap(jsFile, code);
  if (!mapFile) return null;

  let debugId = DEBUG_ID_COMMENT.exec(code)?.[1];
  if (!debugId) {
    debugId = debugIdFromContent(code);
    const urlMatch = SOURCE_MAPPING_URL.exec(code);
    const body = urlMatch ? code.slice(0, urlMatch.index).replace(/\s*$/, "") : code.replace(/\s*$/, "");
    const tail = urlMatch ? `\n${urlMatch[0].trim()}` : "";
    code = `${body}\n${snippet(debugId)}\n//# debugId=${debugId}${tail}\n`;
    await fs.writeFile(jsFile, code);
  }

  const map = JSON.parse(await fs.readFile(mapFile, "utf8")) as Record<string, unknown>;
  map.debugId = debugId;
  map.debug_id = debugId;
  if (!includeSources) delete map.sourcesContent;
  await fs.writeFile(mapFile, JSON.stringify(map));
  return { debugId, mapFile };
}

async function findMap(jsFile: string, code: string): Promise<string | null> {
  const ref = SOURCE_MAPPING_URL.exec(code)?.[1];
  const candidates: string[] = [];
  if (ref && !ref.startsWith("data:") && !/^[a-z]+:\/\//i.test(ref)) candidates.push(path.resolve(path.dirname(jsFile), ref.split("?")[0]));
  candidates.push(`${jsFile}.map`);
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // next candidate
    }
  }
  return null;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "cache") continue;
      await walk(p, out);
    } else if (JS_EXT.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Stamps every chunk under `dir` and uploads its map. The single entry point for CLI and plugins. */
export async function processDirectory(dir: string, opts: ErrorKitBuildOptions = {}): Promise<ProcessedFile[]> {
  const log = opts.log ?? ((l: string) => console.log(`[himetrica-errorkit] ${l}`));
  const secretKey = opts.secretKey ?? process.env.HIMETRICA_SECRET_KEY;
  const apiUrl = (opts.apiUrl ?? process.env.HIMETRICA_API_URL ?? "https://app.himetrica.com").replace(/\/$/, "");
  const doUpload = !opts.dryRun;
  if (doUpload && !secretKey) {
    log("HIMETRICA_SECRET_KEY is not set: stamped the chunks, skipped the upload.");
  }

  const files = await walk(path.resolve(dir));
  const stamped: ProcessedFile[] = [];
  for (const jsFile of files) {
    const res = await injectFile(jsFile, opts.includeSources);
    if (res) stamped.push({ jsFile, mapFile: res.mapFile, debugId: res.debugId, uploaded: false, bytes: 0 });
  }
  log(`stamped ${stamped.length} chunk(s) with Debug IDs in ${dir}`);
  if (!doUpload || !secretKey) return stamped;

  const doFetch = opts.fetch ?? fetch;
  const queue = stamped.slice();
  let failed = 0;
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const body = gzipSync(await fs.readFile(item.mapFile));
      item.bytes = body.length;
      const qs = new URLSearchParams({ debugId: item.debugId, fileName: path.basename(item.jsFile) });
      if (opts.release) qs.set("release", opts.release);
      try {
        const res = await doFetch(`${apiUrl}/api/errorkit/artifacts?${qs}`, {
          method: "POST",
          headers: { "X-API-Key": secretKey, "Content-Type": "application/octet-stream", "X-Content-Gzip": "1" },
          body,
        });
        if (res.ok) item.uploaded = true;
        else {
          failed++;
          log(`upload failed for ${path.basename(item.mapFile)}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
        }
      } catch (err) {
        failed++;
        log(`upload failed for ${path.basename(item.mapFile)}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  const ok = stamped.filter((s) => s.uploaded);
  log(`uploaded ${ok.length}/${stamped.length} source map(s) (${Math.round(ok.reduce((n, s) => n + s.bytes, 0) / 1024)} KB gzipped)${failed ? `, ${failed} failed` : ""}`);

  if (opts.deleteMaps) {
    for (const s of ok) {
      await fs.rm(s.mapFile, { force: true });
      const code = await fs.readFile(s.jsFile, "utf8");
      await fs.writeFile(s.jsFile, code.replace(SOURCE_MAPPING_URL, "").replace(/\s*$/, "\n"));
    }
    log(`deleted ${ok.length} uploaded .map file(s) from the build output`);
  }
  return stamped;
}
