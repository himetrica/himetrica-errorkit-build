#!/usr/bin/env node
// himetrica-errorkit: stamp Debug IDs and upload source maps from any build.
//
//   himetrica-errorkit sourcemaps upload --dir dist [--release 1.4.2] [--include-sources] [--delete-maps]
//   himetrica-errorkit sourcemaps inject --dir dist
//
// The secret key comes from HIMETRICA_SECRET_KEY (never a flag: flags land in CI logs).

import { processDirectory } from "./index";

const HELP = `Usage:
  himetrica-errorkit sourcemaps upload --dir <build dir> [--release <name>] [--include-sources] [--delete-maps] [--api-url <url>]
  himetrica-errorkit sourcemaps inject --dir <build dir>

Environment:
  HIMETRICA_SECRET_KEY   project secret key (hm_sk_...), required for upload
  HIMETRICA_API_URL      defaults to https://app.himetrica.com

Next.js: --dir .next/static   Vite: --dir dist`;

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const [group, cmd] = argv;
  if (group !== "sourcemaps" || (cmd !== "upload" && cmd !== "inject")) {
    console.log(HELP);
    return group === "--help" || group === "-h" ? 0 : 1;
  }
  const dir = arg(argv, "--dir");
  if (!dir) {
    console.error("--dir is required\n\n" + HELP);
    return 1;
  }
  const files = await processDirectory(dir, {
    release: arg(argv, "--release"),
    apiUrl: arg(argv, "--api-url"),
    includeSources: argv.includes("--include-sources"),
    deleteMaps: argv.includes("--delete-maps"),
    dryRun: cmd === "inject",
  });
  // A failed upload must not fail the customer's deploy: errors still arrive, minified.
  if (cmd === "upload" && files.some((f) => !f.uploaded) && process.env.HIMETRICA_SECRET_KEY) {
    console.warn("[himetrica-errorkit] some maps were not uploaded; errors for those chunks will show minified frames.");
  }
  return 0;
}

const invokedDirectly = typeof process !== "undefined" && process.argv[1] && /himetrica-errorkit|cli\.(c|m)?js$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("[himetrica-errorkit]", err);
      process.exit(0);
    },
  );
}
