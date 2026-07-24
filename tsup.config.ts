import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
    // Powers bin/esiur.js only — not part of the public `exports` map, no one
    // should `import "esiur/cli"`.
    cli: "src/cli/esiurBin.ts",
  },
  format: ["esm", "cjs"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep platform-specific imports (node:net, ws, react, …) external so the
  // bundles stay isomorphic and the core build never pulls react in; the
  // conditional `exports` map resolves them at runtime/install time.
  external: ["react"],
  splitting: false,
});
