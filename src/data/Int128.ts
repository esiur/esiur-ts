const MASK64 = (1n << 64n) - 1n;
const TWO_128 = 1n << 128n;
const SIGN_BIT = 1n << 127n;

/**
 * Signed 128-bit integer (port of C# `Int128`, a `{MSB, LSB}` value struct).
 *
 * Backed by a JS `bigint`. Also serves as an explicit wire-width marker so the
 * serializer encodes the value as a 128-bit integer rather than inferring a
 * narrower width from a bare `bigint`.
 */
export class Int128 {
  /** Two's-complement value in the signed 128-bit range. */
  readonly value: bigint;

  constructor(value: bigint);
  constructor(lsb: bigint, msb: bigint);
  constructor(a: bigint, b?: bigint) {
    let v = b === undefined ? a : ((b & MASK64) << 64n) | (a & MASK64);
    v &= TWO_128 - 1n;
    if (v & SIGN_BIT) v -= TWO_128; // interpret as signed
    this.value = v;
  }

  /** Low 64 bits. */
  get lsb(): bigint {
    return this.value & MASK64;
  }

  /** High 64 bits. */
  get msb(): bigint {
    return (this.value >> 64n) & MASK64;
  }

  toString(): string {
    return this.value.toString();
  }

  equals(other: unknown): boolean {
    return other instanceof Int128 && other.value === this.value;
  }
}
