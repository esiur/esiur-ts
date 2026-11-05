import { IndexedStructure } from "../data/IndexedStructure.js";
import { Index } from "../data/IndexAttribute.js";
import { t } from "../data/descriptors.js";
import { TypeDefKind } from "../data/types/ITypeDef.js";

// Wire structures for EpPacketRequest.SyncTypeDefs. See docs/typedef-sync.md.

/** One definition in a client's cache, as sent in a `SyncTypeDefs` request. */
export class TypeDefCacheEntry extends IndexedStructure {
  /** The id the client last used for this definition. */
  @Index(0, t.u64) id = 0n;
  /** Full class name; the identity of the definition. */
  @Index(1) name = "";
  @Index(2, t.u8) kind: TypeDefKind = TypeDefKind.Resource;
  @Index(3, t.i32) version = 0;
  /** The signature the node sent with the cached definition. */
  @Index(4, t.u64) signature = 0n;
}

/** A cached definition whose signature is unchanged but whose id differs. */
export interface TypeDefIdMove {
  oldId: bigint;
  newId: bigint;
}

/** A cached definition that changed: the client replaces it in place. */
export interface TypeDefUpdate {
  oldId: bigint;
  newId: bigint;
  /** The complete definition, exactly as `TypeDefById` returns it. */
  definition: Uint8Array;
}

/** The node's answer to `SyncTypeDefs`. Unchanged entries are not mentioned. */
export interface TypeDefSyncInfo {
  moved: TypeDefIdMove[];
  /** Cached ids that no longer exist, or that the requester may not view. */
  removed: bigint[];
  updated: TypeDefUpdate[];
}

/**
 * Member name to index mapping of a definition at one point in time. Names are the stable
 * identity of a member; indexes are only valid for one definition, so state keyed by index is
 * re-keyed through the layout captured before a definition changed.
 */
export interface TypeDefLayout {
  properties: Map<string, number>;
  functions: Map<string, number>;
  events: Map<string, number>;
}

function asBig(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (value !== null && typeof value === "object" && "value" in value)
    return asBig((value as { value: unknown }).value);
  throw new TypeError("A TypeDef id must be a 64-bit integer.");
}

function field(map: unknown, index: number): unknown {
  if (map instanceof Map) return map.get(index);
  throw new TypeError("A TypeDef sync entry must be an indexed map.");
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  throw new TypeError("A TypeDef sync field must be a list.");
}

/** Reads a decoded `SyncTypeDefs` reply (an indexed map) into its three lists. */
export function readTypeDefSyncInfo(value: unknown): TypeDefSyncInfo {
  if (!(value instanceof Map)) throw new TypeError("A SyncTypeDefs reply must be an indexed map.");

  return {
    moved: list(value.get(0)).map((item) => ({
      oldId: asBig(field(item, 0)),
      newId: asBig(field(item, 1)),
    })),
    removed: list(value.get(1)).map(asBig),
    updated: list(value.get(2)).map((item) => {
      const definition = field(item, 2);
      if (!(definition instanceof Uint8Array))
        throw new TypeError("A TypeDefUpdate definition must be raw bytes.");
      return {
        oldId: asBig(field(item, 0)),
        newId: asBig(field(item, 1)),
        definition,
      };
    }),
  };
}
