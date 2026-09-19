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
import { parseAsyncTdu, parseAsync, parseSync, parseSyncTdu } from "./Codec.js";
import { Tru, TruComposite, TruTypeDef, type RemoteTypeDefResolver } from "./Tru.js";
import { TruIdentifier } from "./TruIdentifier.js";
import { TypeDefKind, type ITypeDef } from "./types/ITypeDef.js";
import { fromIndexedMap } from "./IndexedStructureCodec.js";
import { TypeDefInfo } from "./types/TypeDefInfo.js";
import { PropertyDefInfo } from "./types/PropertyDefInfo.js";
import { FunctionDefInfo } from "./types/FunctionDefInfo.js";
import { EventDefInfo } from "./types/EventDefInfo.js";
import { ConstantDefInfo } from "./types/ConstantDefInfo.js";
import { ArgumentDefInfo } from "./types/ArgumentDefInfo.js";
import {
  GroupInt16Codec,
  GroupInt32Codec,
  GroupInt64Codec,
  GroupUInt16Codec,
  GroupUInt32Codec,
  GroupUInt64Codec,
} from "./gvwie/index.js";
import { ensureAllocation, ensureCollectionCount, saturatedMultiply } from "./ParserGuard.js";

const pointerSize = 8;

function ensureTypedArrayBudget(tdu: ParsedTdu, warehouse: unknown, elementSize: number): void {
  ensureAllocation(warehouse, saturatedMultiply(tdu.payloadLength, elementSize), "typed array");
}

function decodedArrayGuard(warehouse: unknown, elementSize: number): (count: number) => void {
  return (count) => ensureCollectionCount(warehouse, count, elementSize);
}

/**
 * Sync value parsers (port of the sync parsers in C# `DataDeserializer`). Each
 * reads its value from `tdu.data` at `tdu.payloadOffset`. Returned JS types:
 * integers ≤32-bit and floats → `number`, 64-bit → `bigint`, decimal →
 * {@link Decimal128}, datetime → `Date`, uuid → {@link Uuid}.
 */
export type Parser = (tdu: ParsedTdu, warehouse: unknown) => unknown;

/**
 * Async twin of {@link Parser}, used where a `Tru`/`TypeDef`-family value
 * anywhere in the tree may need to resolve a not-yet-fetched remote TypeDef
 * reference via `remoteResolver`.
 */
export type AsyncParser = (
  tdu: ParsedTdu,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly bigint[] | null,
) => Promise<unknown>;

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

export const resourceLinkParser: Parser = (t, w) => {
  ensureAllocation(w, saturatedMultiply(t.payloadLength, 2), "resource link");
  return new ResourceLink(DC.getString(t.data, t.payloadOffset, t.payloadLength));
};

export const rawDataParser: Parser = (t, w) => {
  ensureAllocation(w, t.payloadLength, "raw data");
  return t.data.slice(t.payloadOffset, t.payloadOffset + t.payloadLength);
};
export const stringParser: Parser = (t, w) => {
  ensureAllocation(w, saturatedMultiply(t.payloadLength, 2), "string");
  return DC.getString(t.data, t.payloadOffset, t.payloadLength);
};

// Resource references (sync path returns placeholders).
export const resource8Parser: Parser = (t) => new ResourceId(false, DC.getUint8(t.data, t.payloadOffset));
export const resource16Parser: Parser = (t) => new ResourceId(false, DC.getUint16(t.data, t.payloadOffset));
export const resource32Parser: Parser = (t) => new ResourceId(false, DC.getUint32(t.data, t.payloadOffset));
export const localResource8Parser: Parser = (t) => new ResourceId(true, DC.getUint8(t.data, t.payloadOffset));
export const localResource16Parser: Parser = (t) => new ResourceId(true, DC.getUint16(t.data, t.payloadOffset));
export const localResource32Parser: Parser = (t) => new ResourceId(true, DC.getUint32(t.data, t.payloadOffset));

function resourceReferenceId(tdu: ParsedTdu): number {
  switch (tdu.identifier) {
    case TduIdentifier.LocalResource8:
    case TduIdentifier.RemoteResource8:
      return DC.getUint8(tdu.data, tdu.payloadOffset);
    case TduIdentifier.LocalResource16:
    case TduIdentifier.RemoteResource16:
      return DC.getUint16(tdu.data, tdu.payloadOffset);
    case TduIdentifier.LocalResource32:
    case TduIdentifier.RemoteResource32:
      return DC.getUint32(tdu.data, tdu.payloadOffset);
    default:
      throw new Error(`TDU ${tdu.identifier} is not a resource reference.`);
  }
}

/** Resolve resource references on the async/connection-aware decode path. */
export async function resourceReferenceParserAsync(
  tdu: ParsedTdu,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly bigint[] | null,
): Promise<unknown> {
  const id = resourceReferenceId(tdu);
  const local =
    tdu.identifier === TduIdentifier.LocalResource8 ||
    tdu.identifier === TduIdentifier.LocalResource16 ||
    tdu.identifier === TduIdentifier.LocalResource32;

  if (local) {
    if (remoteResolver?.resolveLocalResource)
      return await remoteResolver.resolveLocalResource(id);
    const candidate = warehouse as { getById?: (resourceId: number) => unknown } | null;
    return candidate?.getById?.(id) ?? new ResourceId(true, id);
  }

  if (remoteResolver?.resolveRemoteResource)
    return await remoteResolver.resolveRemoteResource(id, requestSequence);
  return new ResourceId(false, id);
}

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
    ensureCollectionCount(warehouse, list.length, pointerSize);

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
export const mapParser: Parser = (t, w) => {
  const flat = parseDynamicArray(t, w);
  const map = new Map<unknown, unknown>();
  for (let i = 0; i + 1 < flat.length; i += 2)
    map.set(flat[i], flat[i + 1]);
  return map;
};
export const mapListParser: Parser = (t, w) => parseDynamicArray(t, w);

export const typedParser: Parser = (tdu, warehouse) => {
  const tru = tdu.metadata;
  if (tru instanceof TruComposite) {
    switch (tru.identifier) {
      case TruIdentifier.TypedList:
        return typedArrayParser(tdu, tru.subTypes[0], warehouse);
      case TruIdentifier.TypedMap:
        return typedMapParser(tdu, tru.subTypes[0], tru.subTypes[1], warehouse);
      case TruIdentifier.Tuple2:
      case TruIdentifier.Tuple3:
      case TruIdentifier.Tuple4:
      case TruIdentifier.Tuple5:
      case TruIdentifier.Tuple6:
      case TruIdentifier.Tuple7:
        return tupleParser(tdu, tru.subTypes, warehouse);
      default:
        throw new Error("Unsupported type for typed parser.");
    }
  }
  if (tru instanceof TruTypeDef) return typedObjectParser(tdu, tru.typeDef, warehouse);
  throw new Error("Unknown TRU.");
};

/** Dispatch a TypeDef-described typed value to the record/enum parser. */
function typedObjectParser(tdu: ParsedTdu, typeDef: ITypeDef, warehouse: unknown): unknown {
  if (typeDef.kind === TypeDefKind.Record) return recordParser(tdu, typeDef, warehouse);
  if (typeDef.kind === TypeDefKind.Enum) return enumParser(tdu, typeDef);
  throw new Error("Typed resource parsing is not supported yet.");
}

/** Decode a record TDU: parse each property in TypeDef order, then build the instance. */
function recordParser(tdu: ParsedTdu, typeDef: ITypeDef, warehouse: unknown): object {
  ensureCollectionCount(warehouse, typeDef.properties.length, pointerSize);
  const values: unknown[] = [];
  let offset = tdu.payloadOffset;
  let length = tdu.payloadLength;
  const ends = offset + length;
  let previous: ParsedTdu | null = null;

  for (let i = 0; i < typeDef.properties.length; i++) {
    const current = ParsedTdu.parseSync(tdu.data, offset, ends, warehouse);
    if (current.tduClass === TduClass.Invalid) throw new Error("Unknown type.");

    if (current.identifier === TduIdentifier.TypeContinuation && previous) {
      current.tduClass = previous.tduClass;
      current.identifier = previous.identifier;
      current.metadata = previous.metadata;
    } else if (current.identifier === TduIdentifier.TypeOfTarget) {
      current.tduClass = TduClass.Typed;
      current.identifier = TduIdentifier.Typed;
      current.metadata = typeDef.properties[i].valueType ?? null;
      current.index = TduIdentifier.Typed & 0x7;
    }

    values.push(parseSyncTdu(current, warehouse));

    if (current.totalLength <= 0)
      throw new Error("Error while parsing structured data.");
    offset += current.totalLength;
    length -= current.totalLength;
    previous = current;
  }

  const instance = typeDef.createInstance();
  for (let i = 0; i < typeDef.properties.length; i++)
    typeDef.setProperty(instance, typeDef.properties[i].name, values[i]);
  return instance;
}

/** Decode an enum TDU: a single constant-index byte resolved via the typedef. */
function enumParser(tdu: ParsedTdu, typeDef: ITypeDef): unknown {
  const index = tdu.data[tdu.payloadOffset];
  return typeDef.constants?.[index]?.value;
}

/** Decode the payload of a `TypedList<element>` TDU into a JS array. */
function typedArrayParser(tdu: ParsedTdu, element: Tru, warehouse: unknown): unknown[] {
  const start = tdu.payloadOffset;
  const end = start + tdu.payloadLength;

  switch (element.identifier) {
    case TruIdentifier.Int16:
      ensureTypedArrayBudget(tdu, warehouse, 2);
      return GroupInt16Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 2));
    case TruIdentifier.Int32:
      ensureTypedArrayBudget(tdu, warehouse, 4);
      return GroupInt32Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 4));
    case TruIdentifier.Int64:
      ensureTypedArrayBudget(tdu, warehouse, 8);
      return GroupInt64Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 8));
    case TruIdentifier.UInt16:
      ensureTypedArrayBudget(tdu, warehouse, 2);
      return GroupUInt16Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 2));
    case TruIdentifier.UInt32:
      ensureTypedArrayBudget(tdu, warehouse, 4);
      return GroupUInt32Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 4));
    case TruIdentifier.UInt64:
      ensureTypedArrayBudget(tdu, warehouse, 8);
      return GroupUInt64Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 8));
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
        ensureCollectionCount(warehouse, list.length, pointerSize);

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

/** Decode a `TypedMap<key,value>` TDU (two TypeOfTarget-wrapped arrays) to a JS Map. */
function typedMapParser(
  tdu: ParsedTdu,
  keyTru: Tru,
  valueTru: Tru,
  warehouse: unknown,
): Map<unknown, unknown> {
  const keysTdu = ParsedTdu.parseSync(
    tdu.data,
    tdu.payloadOffset,
    tdu.payloadOffset + tdu.payloadLength,
    warehouse,
  );
  const valuesTdu = ParsedTdu.parseSync(
    tdu.data,
    keysTdu.payloadOffset + keysTdu.payloadLength,
    tdu.ends,
    warehouse,
  );

  const keys = typedArrayParser(keysTdu, keyTru, warehouse);
  const values = typedArrayParser(valuesTdu, valueTru, warehouse);
  ensureCollectionCount(warehouse, keys.length, pointerSize * 2);

  const map = new Map<unknown, unknown>();
  for (let i = 0; i < keys.length; i++) map.set(keys[i], values[i]);
  return map;
}

/** Decode a `TupleN<...>` TDU to a JS array (in element order). */
function tupleParser(tdu: ParsedTdu, subTrus: Tru[], warehouse: unknown): unknown[] {
  ensureCollectionCount(warehouse, subTrus.length, pointerSize);
  const results: unknown[] = [];
  let offset = tdu.payloadOffset;
  let length = tdu.payloadLength;
  const ends = offset + length;

  for (let i = 0; i < subTrus.length; i++) {
    const current = ParsedTdu.parseSync(tdu.data, offset, ends, warehouse);
    if (current.tduClass === TduClass.Invalid) throw new Error("Unknown type.");

    if (current.identifier === TduIdentifier.TypeOfTarget) {
      current.tduClass = TduClass.Typed;
      current.identifier = TduIdentifier.Typed;
      current.metadata = subTrus[i];
      current.index = TduIdentifier.Typed & 0x7;
    }

    results.push(parseSyncTdu(current, warehouse));

    if (current.totalLength <= 0)
      throw new Error("Error while parsing structured data.");
    offset += current.totalLength;
    length -= current.totalLength;
  }

  return results;
}

/** Decode a `TduIdentifier.TypeDef` (0x81) payload into a {@link TypeDefInfo}. */
export const typeDefInfoParser: Parser = (tdu, warehouse) => {
  const parsed = parseSync(tdu.data, tdu.payloadOffset, warehouse);
  if (parsed.length !== tdu.payloadLength)
    throw new Error("The TypeDef payload contains trailing or incomplete data.");
  return hydrateTypeDefInfo(fromIndexedMap(TypeDefInfo, parsed.value));
};

/** Decode a `TduIdentifier.TRU` (0x82) payload into a standalone {@link Tru} value. */
export const truParser: Parser = (tdu, warehouse) => {
  const parsed = Tru.parseSync(tdu.data, tdu.payloadOffset, warehouse);
  if (parsed.size !== tdu.payloadLength)
    throw new Error("The TRU payload contains trailing or incomplete data.");
  return parsed.value;
};

/**
 * `fromIndexedMap` only assigns already-fully-decoded values generically; the
 * member-list fields (`properties`/`functions`/`events`/`constants`, and a
 * function's `arguments`) decode as arrays of plain `Map`s (each a nested,
 * generically-decoded `IndexedStructure` payload) that must be converted to
 * their concrete `*DefInfo` classes by hand at this known call site.
 */
function hydrateTypeDefInfo(info: TypeDefInfo): TypeDefInfo {
  // Dynamic numeric TDUs use the narrowest lossless width, so small UInt64
  // values decode as numbers. Normalize protocol identifiers back to bigint
  // at the typed structure boundary; callers must never observe a lossy or
  // width-dependent TypeDef id representation.
  info.id = BigInt(info.id);
  if (info.parent != null) info.parent = BigInt(info.parent);
  if (Array.isArray(info.properties))
    info.properties = info.properties.map((m) => fromIndexedMap(PropertyDefInfo, m));
  if (Array.isArray(info.functions))
    info.functions = info.functions.map((m) => hydrateFunctionDefInfo(fromIndexedMap(FunctionDefInfo, m)));
  if (Array.isArray(info.events))
    info.events = info.events.map((m) => fromIndexedMap(EventDefInfo, m));
  if (Array.isArray(info.constants))
    info.constants = info.constants.map((m) => fromIndexedMap(ConstantDefInfo, m));
  return info;
}

function hydrateFunctionDefInfo(fn: FunctionDefInfo): FunctionDefInfo {
  if (Array.isArray(fn.arguments))
    fn.arguments = fn.arguments.map((a) => fromIndexedMap(ArgumentDefInfo, a));
  return fn;
}

// ---- async parsers ------------------------------------------------------
//
// Async twins of the parsers above, needed only because a `Tru`/`TypeDef`
// value anywhere in a decoded tree (most commonly a `PropertyDefInfo.valueType`
// or `FunctionDefInfo.returnType` inside a `TypeDefInfo`) may reference a
// remote TypeDef that hasn't been fetched yet. Each is a mechanical
// `await`-ified copy of its sync counterpart — matching the C# source, which
// also doesn't share code between its sync and async parser families.

/** Async twin of {@link parseDynamicArray}. */
async function parseDynamicArrayAsync(
  tdu: ParsedTdu,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly bigint[] | null,
): Promise<unknown[]> {
  const list: unknown[] = [];
  let offset = tdu.payloadOffset;
  let length = tdu.payloadLength;
  const ends = offset + length;
  let previous: ParsedTdu | null = null;

  while (length > 0) {
    const current = await ParsedTdu.parseAsync(
      tdu.data,
      offset,
      ends,
      warehouse,
      remoteResolver,
      requestSequence,
    );
    if (current.tduClass === TduClass.Invalid) throw new Error("Unknown type.");

    if (current.identifier === TduIdentifier.TypeContinuation && previous) {
      current.tduClass = previous.tduClass;
      current.identifier = previous.identifier;
      current.metadata = previous.metadata;
    }

    list.push(await parseAsyncTdu(current, warehouse, remoteResolver, requestSequence));
    ensureCollectionCount(warehouse, list.length, pointerSize);

    if (current.totalLength <= 0)
      throw new Error("Error while parsing structured data.");
    offset += current.totalLength;
    length -= current.totalLength;
    previous = current;
  }

  return list;
}

export const listParserAsync: AsyncParser = (t, w, r, s) => parseDynamicArrayAsync(t, w, r, s);
export const resourceListParserAsync: AsyncParser = (t, w, r, s) => parseDynamicArrayAsync(t, w, r, s);
export const recordListParserAsync: AsyncParser = (t, w, r, s) => parseDynamicArrayAsync(t, w, r, s);
export const mapParserAsync: AsyncParser = async (t, w, r, s) => {
  const flat = await parseDynamicArrayAsync(t, w, r, s);
  const map = new Map<unknown, unknown>();
  for (let i = 0; i + 1 < flat.length; i += 2) map.set(flat[i], flat[i + 1]);
  return map;
};
export const mapListParserAsync: AsyncParser = (t, w, r, s) => parseDynamicArrayAsync(t, w, r, s);
export const rawDataParserAsync: AsyncParser = async (t, w) => rawDataParser(t, w);
export const stringParserAsync: AsyncParser = async (t, w) => stringParser(t, w);
export const resourceLinkParserAsync: AsyncParser = async (t, w, r) => {
  const link = resourceLinkParser(t, w) as ResourceLink;
  return r?.resolveResourceLink ? await r.resolveResourceLink(link.link) : link;
};

export const typedParserAsync: AsyncParser = async (tdu, warehouse, remoteResolver, requestSequence) => {
  const tru = tdu.metadata;
  if (tru instanceof TruComposite) {
    switch (tru.identifier) {
      case TruIdentifier.TypedList:
        return typedArrayParserAsync(tdu, tru.subTypes[0], warehouse, remoteResolver, requestSequence);
      case TruIdentifier.TypedMap:
        return typedMapParserAsync(
          tdu,
          tru.subTypes[0],
          tru.subTypes[1],
          warehouse,
          remoteResolver,
          requestSequence,
        );
      case TruIdentifier.Tuple2:
      case TruIdentifier.Tuple3:
      case TruIdentifier.Tuple4:
      case TruIdentifier.Tuple5:
      case TruIdentifier.Tuple6:
      case TruIdentifier.Tuple7:
        return tupleParserAsync(tdu, tru.subTypes, warehouse, remoteResolver, requestSequence);
      default:
        throw new Error("Unsupported type for typed parser.");
    }
  }
  if (tru instanceof TruTypeDef)
    return typedObjectParserAsync(tdu, tru.typeDef, warehouse, remoteResolver, requestSequence);
  throw new Error("Unknown TRU.");
};

async function typedObjectParserAsync(
  tdu: ParsedTdu,
  typeDef: ITypeDef,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly bigint[] | null,
): Promise<unknown> {
  if (typeDef.kind === TypeDefKind.Record)
    return recordParserAsync(tdu, typeDef, warehouse, remoteResolver, requestSequence);
  if (typeDef.kind === TypeDefKind.Enum) return enumParser(tdu, typeDef);
  throw new Error("Typed resource parsing is not supported yet.");
}

async function recordParserAsync(
  tdu: ParsedTdu,
  typeDef: ITypeDef,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly bigint[] | null,
): Promise<object> {
  ensureCollectionCount(warehouse, typeDef.properties.length, pointerSize);
  const values: unknown[] = [];
  let offset = tdu.payloadOffset;
  let length = tdu.payloadLength;
  const ends = offset + length;
  let previous: ParsedTdu | null = null;

  for (let i = 0; i < typeDef.properties.length; i++) {
    const current = await ParsedTdu.parseAsync(
      tdu.data,
      offset,
      ends,
      warehouse,
      remoteResolver,
      requestSequence,
    );
    if (current.tduClass === TduClass.Invalid) throw new Error("Unknown type.");

    if (current.identifier === TduIdentifier.TypeContinuation && previous) {
      current.tduClass = previous.tduClass;
      current.identifier = previous.identifier;
      current.metadata = previous.metadata;
    } else if (current.identifier === TduIdentifier.TypeOfTarget) {
      current.tduClass = TduClass.Typed;
      current.identifier = TduIdentifier.Typed;
      current.metadata = typeDef.properties[i].valueType ?? null;
      current.index = TduIdentifier.Typed & 0x7;
    }

    values.push(await parseAsyncTdu(current, warehouse, remoteResolver, requestSequence));

    if (current.totalLength <= 0)
      throw new Error("Error while parsing structured data.");
    offset += current.totalLength;
    length -= current.totalLength;
    previous = current;
  }

  const instance = typeDef.createInstance();
  for (let i = 0; i < typeDef.properties.length; i++)
    typeDef.setProperty(instance, typeDef.properties[i].name, values[i]);
  return instance;
}

async function typedArrayParserAsync(
  tdu: ParsedTdu,
  element: Tru,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly bigint[] | null,
): Promise<unknown[]> {
  const start = tdu.payloadOffset;
  const end = start + tdu.payloadLength;

  switch (element.identifier) {
    case TruIdentifier.Int16:
      ensureTypedArrayBudget(tdu, warehouse, 2);
      return GroupInt16Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 2));
    case TruIdentifier.Int32:
      ensureTypedArrayBudget(tdu, warehouse, 4);
      return GroupInt32Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 4));
    case TruIdentifier.Int64:
      ensureTypedArrayBudget(tdu, warehouse, 8);
      return GroupInt64Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 8));
    case TruIdentifier.UInt16:
      ensureTypedArrayBudget(tdu, warehouse, 2);
      return GroupUInt16Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 2));
    case TruIdentifier.UInt32:
      ensureTypedArrayBudget(tdu, warehouse, 4);
      return GroupUInt32Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 4));
    case TruIdentifier.UInt64:
      ensureTypedArrayBudget(tdu, warehouse, 8);
      return GroupUInt64Codec.decode(tdu.data, start, end, decodedArrayGuard(warehouse, 8));
    default: {
      const list: unknown[] = [];
      let offset = start;
      let length = tdu.payloadLength;
      let previous: ParsedTdu | null = null;

      while (length > 0) {
        const current = await ParsedTdu.parseAsync(
          tdu.data,
          offset,
          end,
          warehouse,
          remoteResolver,
          requestSequence,
        );
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

        list.push(await parseAsyncTdu(current, warehouse, remoteResolver, requestSequence));
        ensureCollectionCount(warehouse, list.length, pointerSize);

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

async function typedMapParserAsync(
  tdu: ParsedTdu,
  keyTru: Tru,
  valueTru: Tru,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly bigint[] | null,
): Promise<Map<unknown, unknown>> {
  const keysTdu = await ParsedTdu.parseAsync(
    tdu.data,
    tdu.payloadOffset,
    tdu.payloadOffset + tdu.payloadLength,
    warehouse,
    remoteResolver,
    requestSequence,
  );
  const valuesTdu = await ParsedTdu.parseAsync(
    tdu.data,
    keysTdu.payloadOffset + keysTdu.payloadLength,
    tdu.ends,
    warehouse,
    remoteResolver,
    requestSequence,
  );

  const keys = await typedArrayParserAsync(keysTdu, keyTru, warehouse, remoteResolver, requestSequence);
  const values = await typedArrayParserAsync(
    valuesTdu,
    valueTru,
    warehouse,
    remoteResolver,
    requestSequence,
  );
  ensureCollectionCount(warehouse, keys.length, pointerSize * 2);

  const map = new Map<unknown, unknown>();
  for (let i = 0; i < keys.length; i++) map.set(keys[i], values[i]);
  return map;
}

async function tupleParserAsync(
  tdu: ParsedTdu,
  subTrus: Tru[],
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly bigint[] | null,
): Promise<unknown[]> {
  ensureCollectionCount(warehouse, subTrus.length, pointerSize);
  const results: unknown[] = [];
  let offset = tdu.payloadOffset;
  let length = tdu.payloadLength;
  const ends = offset + length;

  for (let i = 0; i < subTrus.length; i++) {
    const current = await ParsedTdu.parseAsync(
      tdu.data,
      offset,
      ends,
      warehouse,
      remoteResolver,
      requestSequence,
    );
    if (current.tduClass === TduClass.Invalid) throw new Error("Unknown type.");

    if (current.identifier === TduIdentifier.TypeOfTarget) {
      current.tduClass = TduClass.Typed;
      current.identifier = TduIdentifier.Typed;
      current.metadata = subTrus[i];
      current.index = TduIdentifier.Typed & 0x7;
    }

    results.push(await parseAsyncTdu(current, warehouse, remoteResolver, requestSequence));

    if (current.totalLength <= 0)
      throw new Error("Error while parsing structured data.");
    offset += current.totalLength;
    length -= current.totalLength;
  }

  return results;
}

/** Async twin of {@link typeDefInfoParser}. */
export const typeDefInfoParserAsync: AsyncParser = async (
  tdu,
  warehouse,
  remoteResolver,
  requestSequence,
) => {
  const parsed = await parseAsync(tdu.data, tdu.payloadOffset, warehouse, remoteResolver, requestSequence);
  if (parsed.length !== tdu.payloadLength)
    throw new Error("The TypeDef payload contains trailing or incomplete data.");
  return hydrateTypeDefInfo(fromIndexedMap(TypeDefInfo, parsed.value));
};

/** Async twin of {@link truParser}. */
export const truParserAsync: AsyncParser = async (tdu, warehouse, remoteResolver, requestSequence) => {
  const parsed = await Tru.parseAsync(
    tdu.data,
    tdu.payloadOffset,
    warehouse,
    remoteResolver,
    requestSequence,
  );
  if (parsed.size !== tdu.payloadLength)
    throw new Error("The TRU payload contains trailing or incomplete data.");
  return parsed.value;
};
