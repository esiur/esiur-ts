import { IndexedStructure } from "./IndexedStructure.js";
import { getIndexedMembers } from "./IndexAttribute.js";
import { TypedList, TypedMap, t } from "./descriptors.js";
import { TruComposite, type Tru } from "./Tru.js";
import { TruIdentifier } from "./TruIdentifier.js";
import {
  Char16,
  Float32,
  Int8,
  Int16,
  Int32,
  Int64,
  UInt8,
  UInt16,
  UInt32,
  UInt64,
} from "./widths.js";

/**
 * Convert an {@link IndexedStructure} instance to a sparse `TypedMap<u8,
 * dynamic>` (port of C# `IndexedStructureCodec.ToMap`). `null`/`undefined`
 * members are omitted. Nested `IndexedStructure` values recurse; arrays map
 * element-wise. TS enums need no unwrap step (already plain numbers at
 * runtime, unlike C# `Enum`).
 *
 * Deliberately uniform for nested structures too: C#'s compose side uses a
 * plain dynamic `Map` (0x46) wire form for *nested* structures but a
 * `TypedMap` for the outer one — an artifact of its runtime-type composer
 * dispatch, not a protocol requirement. Decode only requires the result be
 * `IDictionary`-compatible, and both wire forms satisfy that, so using
 * `TypedMap` everywhere here is safe and lets the existing
 * `typedMapComposer`/`typedMapParser` machinery handle all recursion with no
 * new composer/parser code.
 */
export function toIndexedMap(value: IndexedStructure): TypedMap {
  const members = getIndexedMembers(value.constructor as Function)
    .slice()
    .sort((a, b) => a.index - b.index);
  const record = value as unknown as Record<string, unknown>;
  const entries: Array<[number, unknown]> = [];
  for (const m of members) {
    const raw = record[m.name];
    if (raw === null || raw === undefined) continue;
    entries.push([m.index, prepareValue(raw, m.wireType)]);
  }
  return new TypedMap(t.u8, t.dynamic, entries);
}

function prepareValue(v: unknown, wireType?: Tru): unknown {
  if (wireType) {
    const n = (): number => {
      if (typeof v !== "number" || !Number.isFinite(v))
        throw new TypeError(`Indexed ${TruIdentifier[wireType.identifier]} value must be a finite number.`);
      return v;
    };
    const b = (): bigint => {
      if (typeof v === "bigint") return v;
      if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
      throw new TypeError(`Indexed ${TruIdentifier[wireType.identifier]} value must be a bigint or safe integer.`);
    };

    switch (wireType.identifier) {
      case TruIdentifier.UInt8: return new UInt8(n());
      case TruIdentifier.Int8: return new Int8(n());
      case TruIdentifier.Char: return new Char16(n());
      case TruIdentifier.UInt16: return new UInt16(n());
      case TruIdentifier.Int16: return new Int16(n());
      case TruIdentifier.UInt32: return new UInt32(n());
      case TruIdentifier.Int32: return new Int32(n());
      case TruIdentifier.UInt64: return new UInt64(b());
      case TruIdentifier.Int64: return new Int64(b());
      case TruIdentifier.Float32: return new Float32(n());
      case TruIdentifier.TypedList:
        if (!Array.isArray(v)) throw new TypeError("Indexed TypedList value must be an array.");
        return new TypedList(
          (wireType as TruComposite).subTypes[0],
          v.map((item) => prepareValue(item)),
        );
      case TruIdentifier.TypedMap:
        if (!(v instanceof Map)) throw new TypeError("Indexed TypedMap value must be a Map.");
        return new TypedMap(
          (wireType as TruComposite).subTypes[0],
          (wireType as TruComposite).subTypes[1],
          [...v].map(([key, item]) => [prepareValue(key), prepareValue(item)]),
        );
    }
  }
  if (v instanceof IndexedStructure) return toIndexedMap(v);
  if (Array.isArray(v)) return v.map((item) => prepareValue(item));
  return v;
}

/**
 * Populate a new `T` from a decoded indexed-map payload (port of C#
 * `IndexedStructureCodec.FromMap`). Version tolerant: indices absent from the
 * map leave the constructed instance's default; indices in the map with no
 * matching `@Index` member are ignored.
 *
 * Only scalar/already-fully-decoded values are assigned generically here —
 * there is no runtime field-type reflection in TS to drive automatic nested
 * structure/list conversion the way C# reflection does, so callers that need
 * a field's value re-interpreted as a specific nested `IndexedStructure`
 * subclass (e.g. `TypeDefInfo.properties: PropertyDefInfo[]`) must convert it
 * themselves after this call — mirroring how C#'s own
 * `RemoteTypeDef.ApplyInfo`/`ToProperty`/etc. hand-write their nested
 * conversions rather than trusting blind reflection there either.
 */
export function fromIndexedMap<T extends IndexedStructure>(
  ctor: new () => T,
  value: unknown,
): T {
  if (!(value instanceof Map))
    throw new Error("An indexed structure payload must decode to a Map.");
  const instance = new ctor();
  const members = getIndexedMembers(ctor);
  const record = instance as unknown as Record<string, unknown>;
  for (const m of members) {
    if (value.has(m.index)) record[m.name] = value.get(m.index);
  }
  return instance;
}
