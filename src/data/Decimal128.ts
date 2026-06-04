import { Endian } from "./Endian.js";
import * as DC from "./DC.js";

const MASK32 = 0xffffffffn;
const TWO_96 = 1n << 96n;

/**
 * 128-bit base-10 floating point, wire-compatible with .NET `decimal`
 * (port of the value carried by C# `Decimal128`).
 *
 * Value = (-1)^negative × mantissa × 10^(−scale), where `mantissa` is a 96-bit
 * unsigned integer and `scale` ∈ [0, 28]. Serialized as the raw .NET in-memory
 * layout: four little-endian 32-bit words in the order `[flags, hi, lo, mid]`.
 */
export class Decimal128 {
  readonly negative: boolean;
  readonly scale: number;
  readonly mantissa: bigint;

  constructor(negative: boolean, scale: number, mantissa: bigint) {
    if (scale < 0 || scale > 28) throw new RangeError(`decimal scale out of range: ${scale}`);
    if (mantissa < 0n || mantissa >= TWO_96)
      throw new RangeError("decimal mantissa exceeds 96 bits");
    this.mantissa = mantissa;
    this.scale = scale;
    this.negative = mantissa === 0n ? false : negative;
  }

  // ---- wire ----------------------------------------------------------------

  /** 16-byte .NET layout: LE words `[flags, hi, lo, mid]`. */
  toBytes(endian: Endian = Endian.Little): Uint8Array {
    const lo = Number(this.mantissa & MASK32) >>> 0;
    const mid = Number((this.mantissa >> 32n) & MASK32) >>> 0;
    const hi = Number((this.mantissa >> 64n) & MASK32) >>> 0;
    const flags = ((this.scale << 16) | (this.negative ? 0x80000000 : 0)) >>> 0;

    const out = new Uint8Array(16);
    const v = new DataView(out.buffer);
    const le = endian === Endian.Little;
    v.setUint32(0, flags, le);
    v.setUint32(4, hi, le);
    v.setUint32(8, lo, le);
    v.setUint32(12, mid, le);
    if (endian === Endian.Big) out.reverse();
    return out;
  }

  static fromBytes(data: Uint8Array, offset = 0, endian: Endian = Endian.Little): Decimal128 {
    let buf = data.subarray(offset, offset + 16);
    if (endian === Endian.Big) buf = buf.slice().reverse();
    const flags = DC.getUint32(buf, 0, Endian.Little);
    const hi = BigInt(DC.getUint32(buf, 4, Endian.Little));
    const lo = BigInt(DC.getUint32(buf, 8, Endian.Little));
    const mid = BigInt(DC.getUint32(buf, 12, Endian.Little));
    const mantissa = (hi << 64n) | (mid << 32n) | lo;
    const scale = (flags >>> 16) & 0xff;
    const negative = (flags & 0x80000000) !== 0;
    return new Decimal128(negative, scale, mantissa);
  }

  // ---- conversions ---------------------------------------------------------

  /** Parse a decimal string (e.g. "-12.3450"); preserves trailing-zero scale. */
  static parse(text: string): Decimal128 {
    let s = text.trim();
    let negative = false;
    if (s[0] === "+" || s[0] === "-") {
      negative = s[0] === "-";
      s = s.slice(1);
    }
    let scale = 0;
    const dot = s.indexOf(".");
    let digits = s;
    if (dot >= 0) {
      scale = s.length - dot - 1;
      digits = s.slice(0, dot) + s.slice(dot + 1);
    }
    if (digits === "" || !/^\d+$/.test(digits))
      throw new SyntaxError(`invalid decimal: ${text}`);
    return new Decimal128(negative, scale, BigInt(digits));
  }

  static fromNumber(value: number): Decimal128 {
    if (!Number.isFinite(value)) throw new RangeError("decimal must be finite");
    return Decimal128.parse(value.toString());
  }

  toString(): string {
    let digits = this.mantissa.toString();
    let result: string;
    if (this.scale === 0) {
      result = digits;
    } else {
      if (digits.length <= this.scale) digits = digits.padStart(this.scale + 1, "0");
      const point = digits.length - this.scale;
      result = `${digits.slice(0, point)}.${digits.slice(point)}`;
    }
    return this.negative ? `-${result}` : result;
  }

  toNumber(): number {
    return Number(this.toString());
  }

  equals(other: unknown): boolean {
    return (
      other instanceof Decimal128 &&
      other.negative === this.negative &&
      other.scale === this.scale &&
      other.mantissa === this.mantissa
    );
  }
}
