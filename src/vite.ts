// Vite / Rollup plugin.
//
//   import { himetricaErrorKit } from "@himetrica/errorkit-build/vite";
//   export default defineConfig({ plugins: [himetricaErrorKit({ release: process.env.GIT_SHA })] });
//
// Turns on `build.sourcemap: "hidden"` when the app has none (maps are emitted
// but not referenced from the bundle, so browsers never download them), then
// stamps and uploads after Vite writes the bundle.

import { processDirectory, type ErrorKitBuildOptions } from "./index";

interface MinimalVitePlugin {
  name: string;
  apply: "build";
  enforce: "post";
  config(config: { build?: { sourcemap?: unknown } }): { build: { sourcemap: unknown } } | undefined;
  writeBundle(outputOptions: { dir?: string; file?: string }): Promise<void>;
}

export function himetricaErrorKit(options: ErrorKitBuildOptions = {}): MinimalVitePlugin {
  return {
    name: "himetrica-errorkit",
    apply: "build",
    enforce: "post",
    config(config) {
      if (config.build?.sourcemap) return undefined;
      return { build: { sourcemap: "hidden" } };
    },
    async writeBundle(outputOptions) {
      const dir = outputOptions.dir ?? (outputOptions.file ? outputOptions.file.replace(/[/\\][^/\\]+$/, "") : undefined);
      if (!dir) return;
      try {
        await processDirectory(dir, options);
      } catch (err) {
        // Never fail the build over observability.
        (options.log ?? console.warn)(`[himetrica-errorkit] skipped: ${(err as Error).message}`);
      }
    },
  };
}

export default himetricaErrorKit;
