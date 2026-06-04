/**
 * Type-Representation Unit identifier (port of C# `TruIdentifier`).
 *
 * Values < 0x40 are primitives. Values ≥ 0x40 set bit 6 (the "composite/ref"
 * flag); their bits 3-5 encode the sub-type count, so `TypedList` (0x48) implies
 * one sub-type and `TypedMap`/`Tuple2` (0x50/0x51) imply two.
 */
export enum TruIdentifier {
  Void = 0x0,
  Dynamic = 0x1,
  Bool = 0x2,
  UInt8 = 0x3,
  Int8 = 0x4,
  Char = 0x5,
  UInt16 = 0x6,
  Int16 = 0x7,
  UInt32 = 0x8,
  Int32 = 0x9,
  Float32 = 0xa,
  UInt64 = 0xb,
  Int64 = 0xc,
  Float64 = 0xd,
  DateTime = 0xe,
  UInt128 = 0xf,
  Int128 = 0x10,
  Decimal = 0x11,
  String = 0x12,
  RawData = 0x13,
  Resource = 0x14,
  Record = 0x15,
  List = 0x16,
  Map = 0x17,

  LocalType8 = 0x40,
  RemoteType8 = 0x41,
  LocalType16 = 0x42,
  RemoteType16 = 0x43,
  LocalType32 = 0x44,
  RemoteType32 = 0x45,
  LocalType64 = 0x46,
  RemoteType64 = 0x47,

  TypedList = 0x48,

  Tuple2 = 0x50,
  TypedMap = 0x51,
  Tuple3 = 0x58,
  Tuple4 = 0x60,
  Tuple5 = 0x68,
  Tuple6 = 0x70,
  Tuple7 = 0x78,
}
