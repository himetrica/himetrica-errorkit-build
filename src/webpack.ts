// webpack 5 plugin (also what the Next.js wrapper adds to the client build).
//
//   const { HimetricaErrorKitPlugin } = require("@himetrica/errorkit-build/webpack");
//   plugins: [new HimetricaErrorKitPlugin({ release: process.env.GIT_SHA })]
//
// Runs after webpack wrote its output (`afterEmit`), so it sees final file
// contents; the app must emit source maps (devtool "hidden-source-map" or "source-map").

import path from "node:path";
import { processDirectory, type ErrorKitBuildOptions } from "./index";

interface MinimalCompiler {
  outputPath: string;
  hooks: { afterEmit: { tapPromise(name: string, fn: (compilation: unknown) => Promise<void>): void } };
}

export interface WebpackPluginOptions extends ErrorKitBuildOptions {
  /** Sub-directory of the output path to process (Next uses "static" for the client build). */
  subDir?: string;
}

export class HimetricaErrorKitPlugin {
  constructor(private readonly options: WebpackPluginOptions = {}) {}

  apply(compiler: MinimalCompiler): void {
    compiler.hooks.afterEmit.tapPromise("HimetricaErrorKitPlugin", async () => {
      const dir = this.options.subDir ? path.join(compiler.outputPath, this.options.subDir) : compiler.outputPath;
      try {
        await processDirectory(dir, this.options);
      } catch (err) {
        (this.options.log ?? console.warn)(`[himetrica-errorkit] skipped: ${(err as Error).message}`);
      }
    });
  }
}

export default HimetricaErrorKitPlugin;
