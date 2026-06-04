import { Tdu } from "./Tdu.js";
import { TduIdentifier } from "./TduIdentifier.js";
import { TduClass } from "./TduClass.js";
import { ParsedTdu } from "./ParsedTdu.js";
import * as D from "./DataDeserializer.js";
import { Decimal128 } from "./Decimal128.js";
import { Uuid } from "./Uuid.js";
import { merge } from "./DC.js";
import { TruComposite, type Tru } from "./Tru.js";
import { TruIdentifier } from "./TruIdentifier.js";
import { TypedList } from "./descriptors.js";
import { GroupInt32Codec } from "./gvwie/GroupInt32Codec.js";
import {
  Int8,
  UInt8,
  Int16,
  UInt16,
  Int32,
  UInt32,
  Int64,
  UInt64,
  Float32,
  Char16,
} from "./widths.js";
import * as S from "./DataSerializer.js";

/**
 * Self-describing value codec (port of C# `Codec`). Encodes a value to its
 * type-prefixed TDU representation.
 *
 * Type mapping for bare JS values:
 *  - `null`/`undefined` → Null
 *  - `boolean` → True/False
 *  - `number` → C# `double` semantics (narrowed; integral → smallest int)
 *  - `bigint` → C# `long` semantics (narrowed)
 *  - `string` → String
 *  - `Date` → DateTime, `Uuid` → UUID, `Decimal128` → Decimal128
 *  - width wrappers (`u8`, `i32`, `f32`, …) pin an explicit wire width
 *
 * Collections, maps, records and resources require the type registry and
 * connection context and are added in the Phase 2 continuation.
 */
export function composeInternal(
  value: unknown,
  warehouse: unknown = null,
  connection: unknown = null,
): Tdu {
  if (value === null || value === undefined)
    return new Tdu(TduIdentifier.Null, null, 0);

  // Explicit width wrappers
  if (value instanceof UInt8) return S.uint8Composer(value.value);
  if (value instanceof Int8) return S.int8Composer(value.value);
  if (value instanceof UInt16) return S.uint16Composer(value.value);
  if (value instanceof Int16) return S.int16Composer(value.value);
  if (value instanceof UInt32) return S.uint32Composer(value.value);
  if (value instanceof Int32) return S.int32Composer(value.value);
  if (value instanceof UInt64) return S.uint64Composer(value.value);
  if (value instanceof Int64) return S.int64Composer(value.value);
  if (value instanceof Float32) return S.float32Composer(value.value);
  if (value instanceof Char16) return S.char16Composer(value.value);

  switch (typeof value) {
    case "boolean":
      return S.boolComposer(value);
    case "number":
      return S.float64Composer(value);
    case "bigint":
      return S.int64Composer(value);
    case "string":
      return S.stringComposer(value);
  }

  if (value instanceof Date) return S.dateTimeComposer(value);
  if (value instanceof Uuid) return S.uuidComposer(value);
  if (value instanceof Decimal128) return S.decimal128Composer(value);
  if (value instanceof Uint8Array) return S.rawDataComposer(value);
  if (value instanceof TypedList) return typedListComposer(value, warehouse, connection);

  // A bare JS array becomes a dynamic, self-describing List (each element keeps
  // its own type tag). Typed Gvwie arrays are produced from explicit typed-list
  // values, added with the Tru family in the Phase 2 continuation.
  if (Array.isArray(value))
    return listComposer(value, TduIdentifier.List, warehouse, connection);

  throw new Error(
    `Codec.compose: serialization for ${describe(value)} is not yet implemented ` +
      `(typed/collection support lands in the Phase 2 continuation).`,
  );
}

/** Encode a value to its self-describing TDU bytes (leading identifier included). */
export function compose(
  value: unknown,
  warehouse: unknown = null,
  connection: unknown = null,
): Uint8Array {
  return composeInternal(value, warehouse, connection).composed;
}

/**
 * Compose a self-describing array as a single Dynamic TDU. Consecutive items of
 * the same typed shape collapse to a TypeContinuation (matching C#
 * `DynamicArrayComposer`); primitives never match, so each is emitted in full.
 */
function listComposer(
  value: Iterable<unknown>,
  identifier: TduIdentifier,
  warehouse: unknown,
  connection: unknown,
): Tdu {
  const parts: Uint8Array[] = [];
  let previous: Tdu | null = null;

  for (const el of value) {
    const tdu = composeInternal(el, warehouse, connection);
    if (previous && tdu.matchType(previous)) {
      const d = tdu.composed.subarray(tdu.contentOffset);
      parts.push(new Tdu(TduIdentifier.TypeContinuation, d, d.length).composed);
    } else {
      parts.push(tdu.composed);
    }
    previous = tdu;
  }

  const content = merge(...parts);
  return new Tdu(identifier, content, content.length);
}

/** Compose an explicitly-typed array as a Typed TDU with `TypedList<element>`. */
function typedListComposer(value: TypedList, warehouse: unknown, connection: unknown): Tdu {
  const payload = typedArrayComposer(value.values, value.element, warehouse, connection);
  const metadata = new TruComposite(TruIdentifier.TypedList, false, [value.element]);
  return new Tdu(TduIdentifier.Typed, payload, payload.length, metadata, connection);
}

/**
 * Encode the elements of a typed array. Numeric element types use the compact
 * Gvwie group encoding; other element types fall back to a concatenation of
 * self-describing TDUs (matching C# `DataSerializer.TypedArrayComposer` for
 * primitive elements).
 */
function typedArrayComposer(
  values: readonly unknown[],
  element: Tru,
  warehouse: unknown,
  connection: unknown,
): Uint8Array {
  switch (element.identifier) {
    case TruIdentifier.Int32:
      return GroupInt32Codec.encode(values as number[]);
    case TruIdentifier.Int16:
    case TruIdentifier.Int64:
    case TruIdentifier.UInt16:
    case TruIdentifier.UInt32:
    case TruIdentifier.UInt64:
      throw new Error(
        `Gvwie codec for ${TruIdentifier[element.identifier]} arrays is not yet ported (follow-up).`,
      );
    default:
      return merge(
        ...values.map((v) => composeInternal(v, warehouse, connection).composed),
      );
  }
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return "array";
  const ctor = (value as { constructor?: { name?: string } })?.constructor?.name;
  return ctor ?? typeof value;
}

// ---- decode -----------------------------------------------------------------

/** Sync parser dispatch table, indexed `[exponent][index]` for Fixed TDUs. */
const fixedParsers: D.Parser[][] = [
  [D.nullParser, D.booleanFalseParser, D.booleanTrueParser, D.notModifiedParser, D.infinityParser],
  [D.uint8Parser, D.int8Parser, D.char8Parser, D.localResource8Parser, D.resource8Parser],
  [D.uint16Parser, D.int16Parser, D.char16Parser, D.localResource16Parser, D.resource16Parser],
  [D.uint32Parser, D.int32Parser, D.float32Parser, D.localResource32Parser, D.resource32Parser],
  [D.uint64Parser, D.int64Parser, D.float64Parser, D.dateTimeParser],
  [D.uint128Parser, D.int128Parser, D.decimal128Parser, D.uuidParser],
];

const dynamicParsers: D.Parser[] = [
  D.rawDataParser,
  D.stringParser,
  D.listParser,
  D.resourceListParser,
  D.recordListParser,
  D.resourceLinkParser,
];

const typedParsers: D.Parser[] = [D.typedParser];

/** Dispatch an already-parsed TDU header to the matching value parser. */
export function parseSyncTdu(tdu: ParsedTdu, warehouse: unknown = null): unknown {
  switch (tdu.tduClass) {
    case TduClass.Fixed:
      return fixedParsers[tdu.exponent][tdu.index](tdu, warehouse);
    case TduClass.Dynamic:
      return dynamicParsers[tdu.index](tdu, warehouse);
    case TduClass.Typed:
      return typedParsers[tdu.index](tdu, warehouse);
    case TduClass.Extension:
      throw new Error("Extension TDUs are not supported.");
    default:
      throw new Error("Invalid TDU.");
  }
}

/** Decode one value at `offset`; returns the value and bytes consumed. */
export function parseSync(
  data: Uint8Array,
  offset = 0,
  warehouse: unknown = null,
): { value: unknown; length: number } {
  const tdu = ParsedTdu.parseSync(data, offset, data.length, warehouse);
  if (tdu.tduClass === TduClass.Invalid)
    throw new Error("DataType can't be parsed.");
  return { value: parseSyncTdu(tdu, warehouse), length: tdu.totalLength };
}

/** Decode one value at `offset` and return just the value. */
export function parse(data: Uint8Array, offset = 0, warehouse: unknown = null): unknown {
  return parseSync(data, offset, warehouse).value;
}
