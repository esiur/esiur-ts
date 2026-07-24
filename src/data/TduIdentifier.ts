/**
 * Leading type byte of a Transmission Data Unit (port of C# `TduIdentifier`).
 *
 * Bit layout: `[class:2][size-or-exponent:3][index:3]`. For {@link TduClass.Fixed}
 * the middle 3 bits are the size exponent; for {@link TduClass.Dynamic} they hold
 * the byte-count of the length prefix when a payload is present.
 */
export enum TduIdentifier {
  // Fixed, zero-payload
  Null = 0x0,
  False = 0x1,
  True = 0x2,
  NotModified = 0x3,
  Infinity = 0x4,
  // Fixed, 1 byte
  UInt8 = 0x8,
  Int8 = 0x9,
  Char8 = 0xa,
  LocalResource8 = 0xb,
  RemoteResource8 = 0xc,
  LocalProcedure8 = 0xd,
  RemoteProcedure8 = 0xe,
  // Fixed, 2 bytes
  UInt16 = 0x10,
  Int16 = 0x11,
  Char16 = 0x12,
  LocalResource16 = 0x13,
  RemoteResource16 = 0x14,
  LocalProcedure16 = 0x15,
  RemoteProcedure16 = 0x16,
  // Fixed, 4 bytes
  UInt32 = 0x18,
  Int32 = 0x19,
  Float32 = 0x1a,
  LocalResource32 = 0x1b,
  RemoteResource32 = 0x1c,
  LocalProcedure32 = 0x1d,
  RemoteProcedure32 = 0x1e,
  // Fixed, 8 bytes
  UInt64 = 0x20,
  Int64 = 0x21,
  Float64 = 0x22,
  DateTime = 0x23,
  // Fixed, 16 bytes
  UInt128 = 0x28,
  Int128 = 0x29,
  Decimal128 = 0x2a,
  UUID = 0x2b,

  // Dynamic (length-prefixed)
  RawData = 0x40,
  String = 0x41,
  List = 0x42,
  ResourceList = 0x43,
  RecordList = 0x44,
  ResourceLink = 0x45,
  Map = 0x46,
  MapList = 0x47,

  // Typed
  Typed = 0x80,
  TypeDef = 0x81,
  TRU = 0x82,

  // Extension
  TypeContinuation = 0xc0,
  TypeOfTarget = 0xc1,
}
