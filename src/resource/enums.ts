import { Tdu } from "../data/Tdu.js";
import { TduIdentifier } from "../data/TduIdentifier.js";
import { TruTypeDef } from "../data/Tru.js";
import { registerComposer } from "../data/Codec.js";
import type { Warehouse } from "./Warehouse.js";

/** A named enum constant. */
export interface EnumConstant {
  name: string;
  value: number;
  index: number;
}

/**
 * Describes an enumeration for serialization (port of the enum side of C#
 * `TypeDef`/`LocalTypeDef`). Since a TS enum value is a bare number, wrap values
 * with {@link value}/{@link enumValue} so the serializer knows the enum type.
 */
export class EnumType {
  readonly constants: EnumConstant[];

  constructor(
    readonly name: string,
    members: Record<string, number>,
  ) {
    this.constants = Object.entries(members).map(([n, v], index) => ({
      name: n,
      value: v,
      index,
    }));
  }

  /** Wrap a numeric value as an {@link EnumValue} for serialization. */
  value(v: number): EnumValue {
    return new EnumValue(this, v);
  }
}

/** A value tagged with its {@link EnumType} for serialization. */
export class EnumValue {
  constructor(
    readonly enumType: EnumType,
    readonly value: number,
  ) {}
}

/** Define an enum type, e.g. `defineEnum("Color", { Red: 0, Green: 1, Blue: 2 })`. */
export function defineEnum(name: string, members: Record<string, number>): EnumType {
  return new EnumType(name, members);
}

/** Tag a numeric value with an enum type for serialization. */
export function enumValue(enumType: EnumType, value: number): EnumValue {
  return new EnumValue(enumType, value);
}

/** Compose an enum value as a Typed TDU (`TruTypeDef` metadata + constant index). */
function enumCompose(value: EnumValue, warehouse: Warehouse, connection: unknown): Tdu {
  const ct = value.enumType.constants.find((c) => c.value === value.value);
  if (!ct) return new Tdu(TduIdentifier.Null, null, 0);

  const typeDef = warehouse.getLocalTypeDefByEnum(value.enumType);
  const metadata = new TruTypeDef(false, typeDef);
  return new Tdu(TduIdentifier.Typed, Uint8Array.of(ct.index), 1, metadata, connection);
}

registerComposer((value, warehouse, connection) =>
  value instanceof EnumValue ? enumCompose(value, warehouse as Warehouse, connection) : undefined,
);
