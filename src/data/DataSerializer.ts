import { Tdu } from "./Tdu.js";
import { TduIdentifier } from "./TduIdentifier.js";
import { Decimal128 } from "./Decimal128.js";
import { Uuid } from "./Uuid.js";
import * as DC from "./DC.js";

/**
 * Primitive value composers (port of the primitive parts of C#
 * `DataSerializer`). Each returns a {@link Tdu}. The integer/float composers
 * narrow to the smallest wire representation that preserves the value, matching
 * the C# implementation exactly. Typed/collection composers land with the type
 * registry in the Phase 2 continuation.
 */

const SBYTE_MIN = -128, SBYTE_MAX = 127;
const SHORT_MIN = -32768, SHORT_MAX = 32767;
const INT_MIN = -2147483648, INT_MAX = 2147483647;
const BYTE_MAX = 255, USHORT_MAX = 65535, UINT_MAX = 4294967295;

const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;
const U64_MAX = 2n ** 64n - 1n;

function fixed(id: TduIdentifier, data: Uint8Array): Tdu {
  return new Tdu(id, data, data.length);
}

export function boolComposer(value: boolean): Tdu {
  return new Tdu(value ? TduIdentifier.True : TduIdentifier.False, null, 0);
}

export function notModifiedComposer(): Tdu {
  return new Tdu(TduIdentifier.NotModified, null, 0);
}

export function uint8Composer(value: number): Tdu {
  return fixed(TduIdentifier.UInt8, Uint8Array.of(value & 0xff));
}

export function int8Composer(value: number): Tdu {
  return fixed(TduIdentifier.Int8, Uint8Array.of(value & 0xff));
}

export function char16Composer(value: number): Tdu {
  return fixed(TduIdentifier.Char16, DC.uint16ToBytes(value & 0xffff));
}

export function int16Composer(value: number): Tdu {
  if (value >= SBYTE_MIN && value <= SBYTE_MAX)
    return fixed(TduIdentifier.Int8, Uint8Array.of(value & 0xff));
  return fixed(TduIdentifier.Int16, DC.int16ToBytes(value));
}

export function uint16Composer(value: number): Tdu {
  if (value <= BYTE_MAX) return fixed(TduIdentifier.UInt8, Uint8Array.of(value & 0xff));
  return fixed(TduIdentifier.UInt16, DC.uint16ToBytes(value));
}

export function int32Composer(value: number): Tdu {
  if (value >= SBYTE_MIN && value <= SBYTE_MAX)
    return fixed(TduIdentifier.Int8, Uint8Array.of(value & 0xff));
  if (value >= SHORT_MIN && value <= SHORT_MAX)
    return fixed(TduIdentifier.Int16, DC.int16ToBytes(value));
  return fixed(TduIdentifier.Int32, DC.int32ToBytes(value));
}

export function uint32Composer(value: number): Tdu {
  if (value <= BYTE_MAX) return fixed(TduIdentifier.UInt8, Uint8Array.of(value & 0xff));
  if (value <= USHORT_MAX) return fixed(TduIdentifier.UInt16, DC.uint16ToBytes(value));
  return fixed(TduIdentifier.UInt32, DC.uint32ToBytes(value));
}

export function int64Composer(value: bigint): Tdu {
  if (value >= BigInt(SBYTE_MIN) && value <= BigInt(SBYTE_MAX))
    return fixed(TduIdentifier.Int8, Uint8Array.of(Number(value) & 0xff));
  if (value >= BigInt(SHORT_MIN) && value <= BigInt(SHORT_MAX))
    return fixed(TduIdentifier.Int16, DC.int16ToBytes(Number(value)));
  if (value >= BigInt(INT_MIN) && value <= BigInt(INT_MAX))
    return fixed(TduIdentifier.Int32, DC.int32ToBytes(Number(value)));
  if (value < I64_MIN || value > I64_MAX)
    throw new RangeError("value exceeds Int64 range; use Int128");
  return fixed(TduIdentifier.Int64, DC.int64ToBytes(value));
}

export function uint64Composer(value: bigint): Tdu {
  if (value <= BigInt(BYTE_MAX)) return fixed(TduIdentifier.UInt8, Uint8Array.of(Number(value) & 0xff));
  if (value <= BigInt(USHORT_MAX)) return fixed(TduIdentifier.UInt16, DC.uint16ToBytes(Number(value)));
  if (value <= BigInt(UINT_MAX)) return fixed(TduIdentifier.UInt32, DC.uint32ToBytes(Number(value)));
  if (value < 0n || value > U64_MAX)
    throw new RangeError("value exceeds UInt64 range; use UInt128");
  return fixed(TduIdentifier.UInt64, DC.uint64ToBytes(value));
}

export function float32Composer(value: number): Tdu {
  if (Number.isNaN(value) || !Number.isFinite(value))
    return new Tdu(TduIdentifier.Infinity, null, 0);
  if (value === Math.trunc(value)) {
    if (value >= SBYTE_MIN && value <= SBYTE_MAX)
      return fixed(TduIdentifier.Int8, Uint8Array.of(value & 0xff));
    if (value >= SHORT_MIN && value <= SHORT_MAX)
      return fixed(TduIdentifier.Int16, DC.int16ToBytes(value));
  }
  return fixed(TduIdentifier.Float32, DC.float32ToBytes(value));
}

export function float64Composer(value: number): Tdu {
  if (Number.isNaN(value) || !Number.isFinite(value))
    return new Tdu(TduIdentifier.Infinity, null, 0);

  if (value === Math.trunc(value)) {
    if (value >= SBYTE_MIN && value <= SBYTE_MAX)
      return fixed(TduIdentifier.Int8, Uint8Array.of(value & 0xff));
    if (value >= SHORT_MIN && value <= SHORT_MAX)
      return fixed(TduIdentifier.Int16, DC.int16ToBytes(value));
    if (value >= INT_MIN && value <= INT_MAX)
      return fixed(TduIdentifier.Int32, DC.int32ToBytes(value));
    // integral but wider than int32: fall through to float encoding
  }

  if (Math.fround(value) === value)
    return fixed(TduIdentifier.Float32, DC.float32ToBytes(value));

  return fixed(TduIdentifier.Float64, DC.float64ToBytes(value));
}

export function dateTimeComposer(value: Date): Tdu {
  return fixed(TduIdentifier.DateTime, DC.dateTimeToBytes(value));
}

export function stringComposer(value: string): Tdu {
  const b = DC.stringToBytes(value);
  return new Tdu(TduIdentifier.String, b, b.length);
}

export function uuidComposer(value: Uuid): Tdu {
  return fixed(TduIdentifier.UUID, value.data);
}

export function rawDataComposer(value: Uint8Array): Tdu {
  return new Tdu(TduIdentifier.RawData, value, value.length);
}

/**
 * Decimal composer. Narrows a scale-0 decimal to the smallest signed integer
 * that fits (matching C#); otherwise emits the full 16-byte .NET layout.
 *
 * Note: C# additionally shrinks decimals that are exactly representable as
 * float32/float64. We always send full precision for fractional decimals — a
 * lossless, interoperable choice — so those specific byte sequences differ while
 * the decoded value is identical.
 */
export function decimal128Composer(value: Decimal128): Tdu {
  if (value.scale === 0) {
    const iv = value.negative ? -value.mantissa : value.mantissa;
    if (iv >= BigInt(SBYTE_MIN) && iv <= BigInt(SBYTE_MAX))
      return fixed(TduIdentifier.Int8, Uint8Array.of(Number(iv) & 0xff));
    if (iv >= BigInt(SHORT_MIN) && iv <= BigInt(SHORT_MAX))
      return fixed(TduIdentifier.Int16, DC.int16ToBytes(Number(iv)));
    if (iv >= BigInt(INT_MIN) && iv <= BigInt(INT_MAX))
      return fixed(TduIdentifier.Int32, DC.int32ToBytes(Number(iv)));
    if (iv >= I64_MIN && iv <= I64_MAX)
      return fixed(TduIdentifier.Int64, DC.int64ToBytes(iv));
  }
  return fixed(TduIdentifier.Decimal128, value.toBytes());
}
