// Unit tests for Debug ID stamping and source map upload (real esbuild bundle, fake API).
//
// Run from packages/errorkit-build:
//   node --import tsx --test src/build.test.ts
//
// What must never break: the appended snippet must not move generated lines
// (the map would point at the wrong code), stamping must be idempotent, and the
// map that leaves the machine must not carry the original sources by default.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { debugIdFromContent, injectFile, processDirectory } from "./index";

async function bundle(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ek-build-"));
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(
    path.join(dir, "src", "app.ts"),
    ["export function loadUser(res: any) {", "  const user = res.data.user;", "  return user.id;", "}", "(globalThis as any).run = () => loadUser({ data: {} });", ""].join("\n"),
  );
  await build({ entryPoints: [path.join(dir, "src", "app.ts")], bundle: true, minify: true, sourcemap: true, outfile: path.join(dir, "dist", "app-9f8e7d6c.js"), format: "iife", logLevel: "silent" });
  return dir;
}

test("debug ids are deterministic and uuid shaped", () => {
  const a = debugIdFromContent("abc");
  assert.equal(a, debugIdFromContent("abc"));
  assert.notEqual(a, debugIdFromContent("abd"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("stamping appends the snippet without moving mapped code, and is idempotent", async () => {
  const dir = await bundle();
  const js = path.join(dir, "dist", "app-9f8e7d6c.js");
  const before = await fs.readFile(js, "utf8");
  const throwCol = before.split("\n")[0].indexOf(".id");
  const mapBefore = new TraceMap(await fs.readFile(js + ".map", "utf8"));
  const posBefore = originalPositionFor(mapBefore, { line: 1, column: throwCol });
  const res = await injectFile(js);
  assert.ok(res);
  const after = await fs.readFile(js, "utf8");
  assert.equal(after.split("\n")[0], before.split("\n")[0], "first generated line untouched");
  assert.match(after, new RegExp(`_hmDebugIds\\[n\\]="${res.debugId}"`));
  assert.match(after, new RegExp(`//# debugId=${res.debugId}\\n//# sourceMappingURL=app-9f8e7d6c.js.map\\n$`));

  const map = JSON.parse(await fs.readFile(res.mapFile, "utf8"));
  assert.equal(map.debugId, res.debugId);
  assert.equal(map.sourcesContent, undefined, "sources stripped by default");
  const pos = originalPositionFor(new TraceMap(map), { line: 1, column: throwCol });
  assert.deepEqual(pos, posBefore, "stamping does not move the mapping");
  assert.ok(pos.line === 2 || pos.line === 3, "maps into loadUser's body");
  assert.match(String(pos.source), /app\.ts$/);

  const again = await injectFile(js);
  assert.equal(again?.debugId, res.debugId);
  assert.equal(await fs.readFile(js, "utf8"), after, "second run changes nothing");
});

test("processDirectory uploads gzipped maps and can delete them", async () => {
  const dir = await bundle();
  const calls: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
  const fakeFetch = (async (url: string, init: { headers: Record<string, string>; body: Buffer }) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const out = await processDirectory(path.join(dir, "dist"), { secretKey: "hm_sk_test", release: "1.0.0", apiUrl: "https://api.test", deleteMaps: true, fetch: fakeFetch, log: () => {} });
  assert.equal(out.length, 1);
  assert.equal(out[0].uploaded, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.test\/api\/errorkit\/artifacts\?debugId=[0-9a-f-]{36}&fileName=app-9f8e7d6c\.js&release=1\.0\.0$/);
  assert.equal(calls[0].headers["X-API-Key"], "hm_sk_test");
  const uploaded = JSON.parse(gunzipSync(calls[0].body).toString("utf8"));
  assert.equal(uploaded.debugId, out[0].debugId);
  await assert.rejects(fs.access(out[0].mapFile), "map deleted after upload");
  assert.doesNotMatch(await fs.readFile(out[0].jsFile, "utf8"), /sourceMappingURL/);
});

test("no secret key: stamps but never calls the API", async () => {
  const dir = await bundle();
  const prev = process.env.HIMETRICA_SECRET_KEY;
  delete process.env.HIMETRICA_SECRET_KEY;
  let called = false;
  const out = await processDirectory(path.join(dir, "dist"), { fetch: (async () => { called = true; return new Response(null); }) as unknown as typeof fetch, log: () => {} });
  if (prev) process.env.HIMETRICA_SECRET_KEY = prev;
  assert.equal(out.length, 1);
  assert.equal(called, false);
});
