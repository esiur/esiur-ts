import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep platform-specific imports (node:net, ws, …) external so the bundle
  // stays isomorphic; the conditional `exports` map resolves them at runtime.
  splitting: false,
});
