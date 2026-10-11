# @himetrica/errorkit-build

Source map upload for [Himetrica ErrorKit](https://www.npmjs.com/package/@himetrica/errorkit): stack traces in your issues show your original files, functions and lines instead of minified bundles.

At build time it stamps a Debug ID into each JavaScript chunk and its `.map`, then uploads the maps to Himetrica. The SDK reports the Debug IDs with each error, so the right map is always found, whatever the file names or deploy. Source code is not uploaded unless you ask for it.

## Install

```bash
npm install --save-dev @himetrica/errorkit-build
```

Set your project's **secret** key in the build environment (CI, Vercel, etc.):

```bash
HIMETRICA_SECRET_KEY=hm_sk_...
```

## Vite

```ts
// vite.config.ts
import { himetricaErrorKit } from "@himetrica/errorkit-build/vite";

export default defineConfig({
  plugins: [himetricaErrorKit({ release: process.env.GIT_SHA, deleteMaps: true })],
});
```

If `build.sourcemap` is not set, the plugin turns on hidden source maps for you.

## Next.js (webpack)

```js
// next.config.mjs
import { withHimetricaErrorKit } from "@himetrica/errorkit-build/next";

export default withHimetricaErrorKit(nextConfig, {
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  deleteMaps: true,
});
```

## webpack

```js
const { HimetricaErrorKitPlugin } = require("@himetrica/errorkit-build/webpack");

module.exports = {
  devtool: "hidden-source-map",
  plugins: [new HimetricaErrorKitPlugin({ release: process.env.GIT_SHA })],
};
```

## CLI (any bundler, Turbopack included)

```bash
npx himetrica-errorkit sourcemaps upload --dir .next/static --release "$VERCEL_GIT_COMMIT_SHA" --delete-maps
```

| Flag | |
| --- | --- |
| `--dir` | Build output to scan for `.js` + `.map` files |
| `--release` | Same value as the SDK's `init({ release })` |
| `--include-sources` | Keep your source inside the maps to show code context in issues |
| `--delete-maps` | Remove the `.map` files from the output after upload |
| `--api-url` | Override the API origin |

`himetrica-errorkit sourcemaps inject --dir <dir>` only stamps the Debug IDs, without uploading.

A failed upload logs a warning and never fails your build.

## Options (plugins)

| Option | Default | |
| --- | --- | --- |
| `secretKey` | `HIMETRICA_SECRET_KEY` | Project secret key |
| `release` | | Same value as the SDK's `release` |
| `includeSources` | `false` | Keep source code inside the uploaded maps |
| `deleteMaps` | `false` | Delete `.map` files from the build output after upload |
| `apiUrl` | `HIMETRICA_API_URL` or `https://app.himetrica.com` | API origin |

## License

Apache-2.0
