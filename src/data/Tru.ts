import { TruIdentifier } from "./TruIdentifier.js";
import { merge } from "./DC.js";
import { registerTruParser } from "./ParsedTdu.js";
import type { ComposableTru } from "./Tdu.js";

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
      if (subsCount === 0)
        throw new Error("Tru TypeDef references require the type registry (Phase 3).");

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

// Make typed TDUs decodable by wiring Tru parsing into ParsedTdu.
registerTruParser((data, offset, warehouse) => Tru.parseSync(data, offset, warehouse));
