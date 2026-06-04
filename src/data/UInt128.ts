const MASK64 = (1n << 64n) - 1n;
const MASK128 = (1n << 128n) - 1n;

/**
 * Unsigned 128-bit integer (port of C# `UInt128`, a `{MSB, LSB}` value struct).
 *
 * Backed by a JS `bigint`. Also serves as an explicit wire-width marker so the
 * serializer encodes the value as a 128-bit integer.
 */
export class UInt128 {
  /** Value in the unsigned 128-bit range. */
  readonly value: bigint;

  constructor(value: bigint);
  constructor(lsb: bigint, msb: bigint);
  constructor(a: bigint, b?: bigint) {
    const v = b === undefined ? a : ((b & MASK64) << 64n) | (a & MASK64);
    this.value = v & MASK128;
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
    return other instanceof UInt128 && other.value === this.value;
  }
}
