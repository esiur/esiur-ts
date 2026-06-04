/**
 * Runtime shim for `Symbol.metadata` (TC39 decorator-metadata proposal).
 *
 * TS 5 standard decorators read/write per-class metadata through `Symbol.metadata`.
 * Some runtimes (e.g. current Node) don't define it yet, so we polyfill it with a
 * registered symbol. This module must be imported before any decorated class is
 * evaluated; the decorator implementations import it for that reason.
 */
declare global {
  interface SymbolConstructor {
    readonly metadata: unique symbol;
  }
}

if (typeof (Symbol as { metadata?: symbol }).metadata !== "symbol") {
  Object.defineProperty(Symbol, "metadata", {
    value: Symbol.for("Symbol.metadata"),
    writable: false,
    enumerable: false,
    configurable: true,
  });
}

export {};
