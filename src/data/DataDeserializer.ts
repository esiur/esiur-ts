import { ParsedTdu } from "./ParsedTdu.js";
import { TduClass } from "./TduClass.js";
import { TduIdentifier } from "./TduIdentifier.js";
import { NotModified } from "./NotModified.js";
import { Uuid } from "./Uuid.js";
import { Int128 } from "./Int128.js";
import { UInt128 } from "./UInt128.js";
import { Decimal128 } from "./Decimal128.js";
import { ResourceId } from "./ResourceId.js";
import { ResourceLink } from "./ResourceLink.js";
import * as DC from "./DC.js";
import { parseSyncTdu } from "./Codec.js";
import { Tru, TruComposite } from "./Tru.js";
import { TruIdentifier } from "./TruIdentifier.js";
import { GroupInt32Codec } from "./gvwie/GroupInt32Codec.js";

/**
 * Sync value parsers (port of the sync parsers in C# `DataDeserializer`). Each
 * reads its value from `tdu.data` at `tdu.payloadOffset`. Returned JS types:
 * integers ≤32-bit and floats → `number`, 64-bit → `bigint`, decimal →
 * {@link Decimal128}, datetime → `Date`, uuid → {@link Uuid}.
 */
export type Parser = (tdu: ParsedTdu, warehouse: unknown) => unknown;

export const nullParser: Parser = () => null;
export const booleanTrueParser: Parser = () => true;
export const booleanFalseParser: Parser = () => false;
export const notModifiedParser: Parser = () => NotModified.Default;
export const infinityParser: Parser = () => Number.POSITIVE_INFINITY;

export const uint8Parser: Parser = (t) => DC.getUint8(t.data, t.payloadOffset);
export const int8Parser: Parser = (t) => DC.getInt8(t.data, t.payloadOffset);
export const char8Parser: Parser = (t) => DC.getUint8(t.data, t.payloadOffset);
export const char16Parser: Parser = (t) => DC.getUint16(t.data, t.payloadOffset);
export const int16Parser: Parser = (t) => DC.getInt16(t.data, t.payloadOffset);
export const uint16Parser: Parser = (t) => DC.getUint16(t.data, t.payloadOffset);
export const int32Parser: Parser = (t) => DC.getInt32(t.data, t.payloadOffset);
export const uint32Parser: Parser = (t) => DC.getUint32(t.data, t.payloadOffset);
export const float32Parser: Parser = (t) => DC.getFloat32(t.data, t.payloadOffset);
export const float64Parser: Parser = (t) => DC.getFloat64(t.data, t.payloadOffset);
export const int64Parser: Parser = (t) => DC.getInt64(t.data, t.payloadOffset);
export const uint64Parser: Parser = (t) => DC.getUint64(t.data, t.payloadOffset);
export const dateTimeParser: Parser = (t) => DC.getDateTime(t.data, t.payloadOffset);

export const decimal128Parser: Parser = (t) =>
  Decimal128.fromBytes(t.data, t.payloadOffset);
export const uuidParser: Parser = (t) => new Uuid(t.data, t.payloadOffset);

export const int128Parser: Parser = (t) =>
  new Int128(
    DC.getUint64(t.data, t.payloadOffset),
    DC.getUint64(t.data, t.payloadOffset + 8),
  );
export const uint128Parser: Parser = (t) =>
  new UInt128(
    DC.getUint64(t.data, t.payloadOffset),
    DC.getUint64(t.data, t.payloadOffset + 8),
  );

export const resourceLinkParser: Parser = (t) =>
  new ResourceLink(DC.getString(t.data, t.payloadOffset, t.payloadLength));

export const rawDataParser: Parser = (t) =>
  t.data.slice(t.payloadOffset, t.payloadOffset + t.payloadLength);
export const stringParser: Parser = (t) =>
  DC.getString(t.data, t.payloadOffset, t.payloadLength);

// Resource references (sync path returns placeholders).
export const resource8Parser: Parser = (t) => new ResourceId(false, DC.getUint8(t.data, t.payloadOffset));
export const resource16Parser: Parser = (t) => new ResourceId(false, DC.getUint16(t.data, t.payloadOffset));
export const resource32Parser: Parser = (t) => new ResourceId(false, DC.getUint32(t.data, t.payloadOffset));
export const localResource8Parser: Parser = (t) => new ResourceId(true, DC.getUint8(t.data, t.payloadOffset));
export const localResource16Parser: Parser = (t) => new ResourceId(true, DC.getUint16(t.data, t.payloadOffset));
export const localResource32Parser: Parser = (t) => new ResourceId(true, DC.getUint32(t.data, t.payloadOffset));

/** Parse a self-describing array payload, honouring TypeContinuation runs. */
function parseDynamicArray(tdu: ParsedTdu, warehouse: unknown): unknown[] {
  const list: unknown[] = [];
  let offset = tdu.payloadOffset;
  let length = tdu.payloadLength;
  const ends = offset + length;
  let previous: ParsedTdu | null = null;

  while (length > 0) {
    const current = ParsedTdu.parseSync(tdu.data, offset, ends, warehouse);
    if (current.tduClass === TduClass.Invalid) throw new Error("Unknown type.");

    if (current.identifier === TduIdentifier.TypeContinuation && previous) {
      current.tduClass = previous.tduClass;
      current.identifier = previous.identifier;
      current.metadata = previous.metadata;
    }

    list.push(parseSyncTdu(current, warehouse));

    if (current.totalLength <= 0)
      throw new Error("Error while parsing structured data.");
    offset += current.totalLength;
    length -= current.totalLength;
    previous = current;
  }

  return list;
}

export const listParser: Parser = (t, w) => parseDynamicArray(t, w);
export const resourceListParser: Parser = (t, w) => parseDynamicArray(t, w);
export const recordListParser: Parser = (t, w) => parseDynamicArray(t, w);

export const typedParser: Parser = (tdu, warehouse) => {
  const tru = tdu.metadata;
  if (tru instanceof TruComposite) {
    switch (tru.identifier) {
      case TruIdentifier.TypedList:
        return typedArrayParser(tdu, tru.subTypes[0], warehouse);
      case TruIdentifier.TypedMap:
      case TruIdentifier.Tuple2:
      case TruIdentifier.Tuple3:
      case TruIdentifier.Tuple4:
      case TruIdentifier.Tuple5:
      case TruIdentifier.Tuple6:
      case TruIdentifier.Tuple7:
        throw new Error("Typed map/tuple parsing is a follow-up.");
      default:
        throw new Error("Unsupported type for typed parser.");
    }
  }
  throw new Error("Unknown TRU (TypeDef references need Phase 3).");
};

/** Decode the payload of a `TypedList<element>` TDU into a JS array. */
function typedArrayParser(tdu: ParsedTdu, element: Tru, warehouse: unknown): unknown[] {
  const start = tdu.payloadOffset;
  const end = start + tdu.payloadLength;

  switch (element.identifier) {
    case TruIdentifier.Int32:
      return GroupInt32Codec.decode(tdu.data, start, end);
    case TruIdentifier.Int16:
    case TruIdentifier.Int64:
    case TruIdentifier.UInt16:
    case TruIdentifier.UInt32:
    case TruIdentifier.UInt64:
      throw new Error(
        `Gvwie codec for ${TruIdentifier[element.identifier]} arrays is not yet ported (follow-up).`,
      );
    default: {
      const list: unknown[] = [];
      let offset = start;
      let length = tdu.payloadLength;
      let previous: ParsedTdu | null = null;

      while (length > 0) {
        const current = ParsedTdu.parseSync(tdu.data, offset, end, warehouse);
        if (current.tduClass === TduClass.Invalid) throw new Error("Unknown type.");

        if (current.identifier === TduIdentifier.TypeContinuation && previous) {
          current.tduClass = previous.tduClass;
          current.identifier = previous.identifier;
          current.metadata = previous.metadata;
        } else if (current.identifier === TduIdentifier.TypeOfTarget) {
          current.tduClass = TduClass.Typed;
          current.identifier = TduIdentifier.Typed;
          current.metadata = element;
          current.index = TduIdentifier.Typed & 0x7;
        }

        list.push(parseSyncTdu(current, warehouse));

        if (current.totalLength <= 0)
          throw new Error("Error while parsing structured data.");
        offset += current.totalLength;
        length -= current.totalLength;
        previous = current;
      }
      return list;
    }
  }
}
