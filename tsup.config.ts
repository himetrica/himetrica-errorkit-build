import { defineConfig } from "tsup";

// Build-time only (runs in the customer's CI, never in the browser): Node 18+,
// zero runtime dependencies. One config so `clean` cannot race a second build;
// the CLI's shebang lives in src/cli.ts and esbuild keeps it.
export default defineConfig({
  entry: ["src/index.ts", "src/vite.ts", "src/webpack.ts", "src/next.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  platform: "node",
});
