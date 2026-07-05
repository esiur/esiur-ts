import { TruIdentifier } from "./TruIdentifier.js";
import { merge } from "./DC.js";
import * as DC from "./DC.js";
import { registerTruParser } from "./ParsedTdu.js";
import type { ComposableTru } from "./Tdu.js";
import type { ITypeDef } from "./types/ITypeDef.js";

export type RemoteTypeDefResolver = (
  id: number,
  requestSequence: readonly number[] | null,
) => ITypeDef | PromiseLike<ITypeDef>;

/**
 * Type-Representation Unit (port of C# `Tru`). Describes how a value's type maps
 * onto the wire. Because TypeScript has no runtime reflection, Trus are built
 * explicitly via the `t.*` descriptors (see `descriptors.ts`) rather than from a
 * CLR `Type`.
 *
 * Wire encoding (one header byte): `(nullable ? 0x80 : 0) | identifier`. For
 * composites the identifier's bits 3-5 imply the sub-type count, whose Trus
 * follow inline.
 */
export abstract class Tru implements ComposableTru {
  identifier: TruIdentifier;
  nullable: boolean;

  protected constructor(identifier: TruIdentifier, nullable: boolean) {
    this.identifier = identifier;
    this.nullable = nullable;
  }

  abstract compose(connection?: unknown): Uint8Array;
  abstract match(other: Tru): boolean;
  abstract toNullable(): Tru;

  protected get headerByte(): number {
    return ((this.nullable ? 0x80 : 0) | this.identifier) & 0xff;
  }

  /** Parse a Tru at `offset`; returns the Tru and the number of bytes consumed. */
  static parseSync(
    data: Uint8Array,
    offset: number,
    warehouse: unknown = null,
  ): { value: Tru; size: number } {
    const start = offset;
    const header = data[offset++];
    const nullable = (header & 0x80) > 0;
    const identifier = (header & 0x7f) as TruIdentifier;

    if ((header & 0x40) > 0) {
      const subsCount = (header >> 3) & 0x7;
      if (subsCount === 0) {
        // TypeDef reference (record/enum/resource): id follows, width by identifier.
        const ref = readTypeDefId(data, offset, identifier);
        if (ref.remote)
          throw new Error("Remote type definitions require a connection (Phase 5).");
        const typeDef = typeDefResolver(warehouse, ref.id);
        return { value: new TruTypeDef(nullable, typeDef), size: 1 + ref.size };
      }

      const subTypes: Tru[] = [];
      for (let i = 0; i < subsCount; i++) {
        const pr = Tru.parseSync(data, offset, warehouse);
        subTypes.push(pr.value);
        offset += pr.size;
      }
      return { value: new TruComposite(identifier, nullable, subTypes), size: offset - start };
    }

    return { value: new TruPrimitive(identifier, nullable), size: 1 };
  }

  /** Async parser variant used when remote TypeDef references may need fetching. */
  static async parseAsync(
    data: Uint8Array,
    offset: number,
    warehouse: unknown = null,
    remoteResolver?: RemoteTypeDefResolver,
    requestSequence: readonly number[] | null = null,
  ): Promise<{ value: Tru; size: number }> {
    const start = offset;
    const header = data[offset++];
    const nullable = (header & 0x80) > 0;
    const identifier = (header & 0x7f) as TruIdentifier;

    if ((header & 0x40) > 0) {
      const subsCount = (header >> 3) & 0x7;
      if (subsCount === 0) {
        const ref = readTypeDefId(data, offset, identifier);
        const typeDef = ref.remote
          ? await resolveRemoteTypeDef(remoteResolver, ref.id, requestSequence)
          : typeDefResolver(warehouse, ref.id);
        return { value: new TruTypeDef(nullable, typeDef), size: 1 + ref.size };
      }

      const subTypes: Tru[] = [];
      for (let i = 0; i < subsCount; i++) {
        const pr = await Tru.parseAsync(
          data,
          offset,
          warehouse,
          remoteResolver,
          requestSequence,
        );
        subTypes.push(pr.value);
        offset += pr.size;
      }
      return { value: new TruComposite(identifier, nullable, subTypes), size: offset - start };
    }

    return { value: new TruPrimitive(identifier, nullable), size: 1 };
  }
}

/** A primitive Tru (single header byte, no sub-types). */
export class TruPrimitive extends Tru {
  constructor(identifier: TruIdentifier, nullable = false) {
    super(identifier, nullable);
  }

  override compose(): Uint8Array {
    return Uint8Array.of(this.headerByte);
  }

  override match(other: Tru): boolean {
    return other instanceof TruPrimitive && other.identifier === this.identifier;
  }

  override toNullable(): TruPrimitive {
    return new TruPrimitive(this.identifier, true);
  }

  override toString(): string {
    return TruIdentifier[this.identifier] + (this.nullable ? "?" : "");
  }
}

/** A composite Tru (typed list/map/tuple) carrying inline sub-type Trus. */
export class TruComposite extends Tru {
  readonly subTypes: Tru[];

  constructor(identifier: TruIdentifier, nullable: boolean, subTypes: Tru[]) {
    super(identifier, nullable);
    this.subTypes = subTypes;
  }

  override compose(connection?: unknown): Uint8Array {
    return merge(
      Uint8Array.of(this.headerByte),
      ...this.subTypes.map((s) => s.compose(connection)),
    );
  }

  override match(other: Tru): boolean {
    if (!(other instanceof TruComposite)) return false;
    if (other.identifier !== this.identifier) return false;
    if (other.subTypes.length !== this.subTypes.length) return false;
    for (let i = 0; i < this.subTypes.length; i++)
      if (!this.subTypes[i].match(other.subTypes[i])) return false;
    return true;
  }

  override toNullable(): TruComposite {
    return new TruComposite(this.identifier, true, this.subTypes);
  }

  override toString(): string {
    return `${TruIdentifier[this.identifier]}<${this.subTypes.map((s) => s.toString()).join(",")}>${this.nullable ? "?" : ""}`;
  }
}

/** Smallest local-typedef identifier that can carry `id`. */
function localTypeIdentifier(id: number): TruIdentifier {
  if (id <= 0xff) return TruIdentifier.LocalType8;
  if (id <= 0xffff) return TruIdentifier.LocalType16;
  if (id <= 0xffffffff) return TruIdentifier.LocalType32;
  return TruIdentifier.LocalType64;
}

/** Read a typedef id (little-endian) whose width is implied by the identifier. */
function readTypeDefId(
  data: Uint8Array,
  offset: number,
  identifier: TruIdentifier,
): { id: number; remote: boolean; size: number } {
  switch (identifier) {
    case TruIdentifier.LocalType8:
      return { id: DC.getUint8(data, offset), remote: false, size: 1 };
    case TruIdentifier.RemoteType8:
      return { id: DC.getUint8(data, offset), remote: true, size: 1 };
    case TruIdentifier.LocalType16:
      return { id: DC.getUint16(data, offset), remote: false, size: 2 };
    case TruIdentifier.RemoteType16:
      return { id: DC.getUint16(data, offset), remote: true, size: 2 };
    case TruIdentifier.LocalType32:
      return { id: DC.getUint32(data, offset), remote: false, size: 4 };
    case TruIdentifier.RemoteType32:
      return { id: DC.getUint32(data, offset), remote: true, size: 4 };
    case TruIdentifier.LocalType64:
      return { id: Number(DC.getUint64(data, offset)), remote: false, size: 8 };
    case TruIdentifier.RemoteType64:
      return { id: Number(DC.getUint64(data, offset)), remote: true, size: 8 };
    default:
      throw new Error("Invalid Tru typedef identifier.");
  }
}

async function resolveRemoteTypeDef(
  resolver: RemoteTypeDefResolver | undefined,
  id: number,
  requestSequence: readonly number[] | null,
): Promise<ITypeDef> {
  if (!resolver)
    throw new Error("Remote type definitions require a connection.");
  return await resolver(id, requestSequence);
}

/** A Tru referencing a registered type definition (record/enum/resource). */
export class TruTypeDef extends Tru {
  readonly typeDef: ITypeDef;

  constructor(nullable: boolean, typeDef: ITypeDef) {
    super(localTypeIdentifier(typeDef.id), nullable);
    this.typeDef = typeDef;
  }

  override compose(): Uint8Array {
    const id = this.typeDef.id;
    let idBytes: Uint8Array;
    switch (this.identifier) {
      case TruIdentifier.LocalType8:
        idBytes = Uint8Array.of(id & 0xff);
        break;
      case TruIdentifier.LocalType16:
        idBytes = DC.uint16ToBytes(id);
        break;
      case TruIdentifier.LocalType32:
        idBytes = DC.uint32ToBytes(id);
        break;
      default:
        idBytes = DC.uint64ToBytes(BigInt(id));
        break;
    }
    return merge(Uint8Array.of(this.headerByte), idBytes);
  }

  override match(other: Tru): boolean {
    return other instanceof TruTypeDef && other.typeDef.id === this.typeDef.id;
  }

  override toNullable(): TruTypeDef {
    return new TruTypeDef(true, this.typeDef);
  }

  override toString(): string {
    return this.typeDef.name + (this.nullable ? "?" : "");
  }
}

/** Resolves a typedef id to its definition (registered by the resource layer). */
let typeDefResolver: (warehouse: unknown, id: number) => ITypeDef = () => {
  throw new Error("No TypeDef resolver registered (import the resource layer).");
};

/** Register the typedef resolver used when decoding TypeDef-referencing Trus. */
export function registerTypeDefResolver(
  fn: (warehouse: unknown, id: number) => ITypeDef,
): void {
  typeDefResolver = fn;
}

// Make typed TDUs decodable by wiring Tru parsing into ParsedTdu.
registerTruParser((data, offset, warehouse) => Tru.parseSync(data, offset, warehouse));
