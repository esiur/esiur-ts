# Esiur (TypeScript)

TypeScript port of [Esiur](https://github.com/esiur/esiur-dotnet) **v3** — a distributed object /
resource framework with real-time property modification, asynchronous function invocation and event
handling over the IIP/Ep binary protocol.

This package is a fresh, isomorphic (browser + Node.js) implementation that is **wire-compatible
with esiur-dotnet v3**. It is *not* compatible with the legacy `esiur` v2 / `esiur-dart`.

> Status: **early development.** Being ported phase-by-phase from the C# reference
> (`esiur-dotnet/Libraries/Esiur`). See `PORTING.md` for the mapping and progress.

## Design notes

- **Standard TS 5 decorators** (`@Resource`, `@Export`, …) replace C#'s `[Resource] partial class`
  source generator. No `reflect-metadata`; member element types / numeric widths are declared
  explicitly via small type descriptors (`t.u32`, `t.list(t.string)`), which the codegen CLI emits.
- **`AsyncReply<T>`** is `PromiseLike` (works with `await`) while keeping Esiur's extra channels
  (progress / chunk / propagation / warning).
- **Numerics:** `number` for ≤32-bit ints and floats, `bigint` for 64/128-bit, explicit width
  wrappers where the wire width can't be inferred from a bare JS number.
- **Binary I/O** on `Uint8Array` / `DataView` (little-endian wire), so the same code runs in the
  browser and Node.

## Develop

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT © Ahmed Kh. Zamil
