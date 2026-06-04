import { Endian } from "./Endian.js";

/**
 * Data Converter (port of C# `DC`). Free functions to convert primitive values
 * to/from their byte representation on a `Uint8Array`, plus byte-buffer helpers.
 *
 * Conventions:
 *  - 8/16/32-bit integers and floats use `number`; 64-bit integers use `bigint`.
 *  - The wire format is little-endian; `endian` defaults to {@link Endian.Little}.
 */

const LITTLE = Endian.Little;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

/** Milliseconds between .NET epoch (0001-01-01) and Unix epoch (1970-01-01). */
export const DOTNET_EPOCH_OFFSET_MS = 62135596800000;
/** .NET ticks per millisecond (1 tick = 100 ns). */
export const TICKS_PER_MS = 10000n;

function view(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ---- value -> bytes ---------------------------------------------------------

export function boolToBytes(value: boolean): Uint8Array {
  return new Uint8Array([value ? 1 : 0]);
}

export function uint8ToBytes(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

export function int8ToBytes(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

export function int16ToBytes(value: number, endian: Endian = LITTLE): Uint8Array {
  const b = new Uint8Array(2);
  view(b).setInt16(0, value, endian === LITTLE);
  return b;
}

export function uint16ToBytes(value: number, endian: Endian = LITTLE): Uint8Array {
  const b = new Uint8Array(2);
  view(b).setUint16(0, value, endian === LITTLE);
  return b;
}

export function int32ToBytes(value: number, endian: Endian = LITTLE): Uint8Array {
  const b = new Uint8Array(4);
  view(b).setInt32(0, value, endian === LITTLE);
  return b;
}

export function uint32ToBytes(value: number, endian: Endian = LITTLE): Uint8Array {
  const b = new Uint8Array(4);
  view(b).setUint32(0, value >>> 0, endian === LITTLE);
  return b;
}

export function int64ToBytes(value: bigint, endian: Endian = LITTLE): Uint8Array {
  const b = new Uint8Array(8);
  view(b).setBigInt64(0, value, endian === LITTLE);
  return b;
}

export function uint64ToBytes(value: bigint, endian: Endian = LITTLE): Uint8Array {
  const b = new Uint8Array(8);
  view(b).setBigUint64(0, value, endian === LITTLE);
  return b;
}

export function float32ToBytes(value: number, endian: Endian = LITTLE): Uint8Array {
  const b = new Uint8Array(4);
  view(b).setFloat32(0, value, endian === LITTLE);
  return b;
}

export function float64ToBytes(value: number, endian: Endian = LITTLE): Uint8Array {
  const b = new Uint8Array(8);
  view(b).setFloat64(0, value, endian === LITTLE);
  return b;
}

/** UTF-8 encode a string (no length prefix). */
export function stringToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

/** A .NET `DateTime` as a little-endian int64 of UTC ticks. */
export function dateTimeToBytes(value: Date): Uint8Array {
  return int64ToBytes(dateToTicks(value), LITTLE);
}

/** Convert a JS `Date` to .NET UTC ticks. */
export function dateToTicks(value: Date): bigint {
  return (BigInt(value.getTime()) + BigInt(DOTNET_EPOCH_OFFSET_MS)) * TICKS_PER_MS;
}

/** Convert .NET UTC ticks to a JS `Date`. */
export function ticksToDate(ticks: bigint): Date {
  return new Date(Number(ticks / TICKS_PER_MS) - DOTNET_EPOCH_OFFSET_MS);
}

// ---- bytes -> value ---------------------------------------------------------

export function getUint8(data: Uint8Array, offset: number): number {
  return data[offset];
}

export function getInt8(data: Uint8Array, offset: number): number {
  return (data[offset] << 24) >> 24;
}

export function getInt16(data: Uint8Array, offset: number, endian: Endian = LITTLE): number {
  return view(data).getInt16(offset, endian === LITTLE);
}

export function getUint16(data: Uint8Array, offset: number, endian: Endian = LITTLE): number {
  return view(data).getUint16(offset, endian === LITTLE);
}

export function getInt32(data: Uint8Array, offset: number, endian: Endian = LITTLE): number {
  return view(data).getInt32(offset, endian === LITTLE);
}

export function getUint32(data: Uint8Array, offset: number, endian: Endian = LITTLE): number {
  return view(data).getUint32(offset, endian === LITTLE);
}

export function getInt64(data: Uint8Array, offset: number, endian: Endian = LITTLE): bigint {
  return view(data).getBigInt64(offset, endian === LITTLE);
}

export function getUint64(data: Uint8Array, offset: number, endian: Endian = LITTLE): bigint {
  return view(data).getBigUint64(offset, endian === LITTLE);
}

export function getFloat32(data: Uint8Array, offset: number, endian: Endian = LITTLE): number {
  return view(data).getFloat32(offset, endian === LITTLE);
}

export function getFloat64(data: Uint8Array, offset: number, endian: Endian = LITTLE): number {
  return view(data).getFloat64(offset, endian === LITTLE);
}

export function getBoolean(data: Uint8Array, offset: number): boolean {
  return data[offset] > 0;
}

/** Decode `length` bytes of UTF-8 starting at `offset`. */
export function getString(data: Uint8Array, offset: number, length: number): string {
  return textDecoder.decode(data.subarray(offset, offset + length));
}

export function getDateTime(data: Uint8Array, offset: number, endian: Endian = LITTLE): Date {
  return ticksToDate(getInt64(data, offset, endian));
}

// ---- buffer helpers ---------------------------------------------------------

/** Concatenate any number of byte arrays. */
export function merge(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/** Concatenate two byte ranges (port of C# `DC.Combine`). */
export function combine(
  src1: Uint8Array,
  src1Offset: number,
  src1Length: number,
  src2: Uint8Array,
  src2Offset: number,
  src2Length: number,
): Uint8Array {
  const out = new Uint8Array(src1Length + src2Length);
  out.set(src1.subarray(src1Offset, src1Offset + src1Length), 0);
  out.set(src2.subarray(src2Offset, src2Offset + src2Length), src1Length);
  return out;
}

/** Return a copy of `length` bytes starting at `offset`. */
export function clip(data: Uint8Array, offset: number, length: number): Uint8Array {
  if (data.length < offset + length)
    throw new RangeError("Length exceeds array boundary.");
  return data.slice(offset, offset + length);
}

const HEX = "0123456789abcdef";

/** Lowercase hex of a byte range (no separator by default). */
export function toHex(data: Uint8Array, offset = 0, length = data.length - offset, separator = ""): string {
  const parts: string[] = [];
  for (let i = 0; i < length; i++) {
    const b = data[offset + i];
    parts.push(HEX[b >> 4] + HEX[b & 0xf]);
  }
  return parts.join(separator);
}

/** Parse a hex string (optionally separated) into bytes. */
export function fromHex(hex: string, separator: string | null = " "): Uint8Array {
  const tokens =
    separator == null
      ? (hex.match(/.{1,2}/g) ?? [])
      : hex.split(separator).filter((t) => t.length > 0);
  const out = new Uint8Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) out[i] = parseInt(tokens[i], 16) & 0xff;
  return out;
}
