// Next.js wrapper.
//
//   // next.config.mjs
//   import { withHimetricaErrorKit } from "@himetrica/errorkit-build/next";
//   export default withHimetricaErrorKit(nextConfig, { release: process.env.VERCEL_GIT_COMMIT_SHA });
//
// webpack builds (`next build`): turns on productionBrowserSourceMaps and adds
// the plugin to the CLIENT compilation only (stamps + uploads .next/static).
//
// Turbopack builds (`next build --turbopack`) run no webpack plugins. There the
// wrapper only enables the maps, and the build script stamps and uploads:
//   "build": "next build --turbopack && himetrica-errorkit sourcemaps upload --dir .next/static --delete-maps"
// Stamping after the build is exactly what the plugin does at afterEmit, so both
// paths produce the same Debug IDs.

import { HimetricaErrorKitPlugin, type WebpackPluginOptions } from "./webpack";

type WebpackFn = (config: { plugins?: unknown[] } & Record<string, unknown>, ctx: { isServer: boolean; dev: boolean; nextRuntime?: string }) => unknown;
type NextConfig = Record<string, unknown> & { webpack?: WebpackFn; productionBrowserSourceMaps?: boolean };

export function withHimetricaErrorKit<T extends NextConfig>(nextConfig: T, options: WebpackPluginOptions = {}): T {
  const userWebpack = nextConfig.webpack;
  return {
    ...nextConfig,
    productionBrowserSourceMaps: true,
    webpack(config, ctx) {
      const out = (userWebpack ? userWebpack(config, ctx) : config) as typeof config;
      if (!ctx.dev && !ctx.isServer) {
        out.plugins = [...(out.plugins ?? []), new HimetricaErrorKitPlugin({ subDir: "static", ...options })];
      }
      return out;
    },
  } as T;
}

export default withHimetricaErrorKit;
