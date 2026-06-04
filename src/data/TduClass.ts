/**
 * The top 2 bits of a TDU identifier select its class, which determines how the
 * payload length is framed (port of C# `TduClass`).
 */
export enum TduClass {
  /** Self-sized primitive (length implied by the identifier's exponent). */
  Fixed = 0x0,
  /** Length-prefixed payload (string, list, raw bytes, …). */
  Dynamic = 0x1,
  /** Length-prefixed payload preceded by a type-representation (Tru). */
  Typed = 0x2,
  /** Reserved extension space. */
  Extension = 0x3,
  /** Not a valid TDU. */
  Invalid = 0x4,
}
