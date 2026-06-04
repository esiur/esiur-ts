/**
 * Explicit numeric-width wrappers. A bare JS `number` is treated as a C#
 * `double` and a bare `bigint` as a C# `long`; wrap a value in one of these to
 * pin the wire width the serializer should use (e.g. unsigned types, or a
 * 32-bit float). Like the C# composers, these still narrow to the smallest
 * representation that fits — `u32(255)` encodes as `UInt8`.
 */

export class Int8 {
  constructor(readonly value: number) {}
}
export class UInt8 {
  constructor(readonly value: number) {}
}
export class Int16 {
  constructor(readonly value: number) {}
}
export class UInt16 {
  constructor(readonly value: number) {}
}
export class Int32 {
  constructor(readonly value: number) {}
}
export class UInt32 {
  constructor(readonly value: number) {}
}
export class Int64 {
  constructor(readonly value: bigint) {}
}
export class UInt64 {
  constructor(readonly value: bigint) {}
}
export class Float32 {
  constructor(readonly value: number) {}
}
/** A UTF-16 code unit, encoded as the `Char16` TDU. */
export class Char16 {
  constructor(readonly value: number) {}
}

/** Convenience factories for the width wrappers. */
export const i8 = (v: number) => new Int8(v);
export const u8 = (v: number) => new UInt8(v);
export const i16 = (v: number) => new Int16(v);
export const u16 = (v: number) => new UInt16(v);
export const i32 = (v: number) => new Int32(v);
export const u32 = (v: number) => new UInt32(v);
export const i64 = (v: bigint) => new Int64(v);
export const u64 = (v: bigint) => new UInt64(v);
export const f32 = (v: number) => new Float32(v);
export const char16 = (v: number | string) =>
  new Char16(typeof v === "string" ? v.charCodeAt(0) : v);
