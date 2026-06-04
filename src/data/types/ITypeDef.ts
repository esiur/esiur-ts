import type { Tru } from "../Tru.js";

/** Kind of a type definition (port of C# `TypeDefKind`). */
export enum TypeDefKind {
  Resource = 0,
  Record = 1,
  Enum = 2,
  Function = 3,
}

/** A property entry within a type definition. */
export interface TypeDefProperty {
  name: string;
  valueType?: Tru;
}

/** A constant entry within an enum type definition. */
export interface TypeDefConstant {
  name: string;
  value: unknown;
  index: number;
}

/**
 * Minimal, layer-neutral view of a type definition used by the serializer
 * (records/enums). The full implementation (`LocalTypeDef`) lives in the
 * resource layer and is resolved via a registered hook, keeping `data/`
 * independent of the resource model.
 */
export interface ITypeDef {
  readonly id: number;
  readonly kind: TypeDefKind;
  readonly name: string;
  readonly properties: ReadonlyArray<TypeDefProperty>;
  readonly constants?: ReadonlyArray<TypeDefConstant>;
  /** Create a fresh instance of the described type. */
  createInstance(): object;
  /** Assign a decoded property value to an instance. */
  setProperty(instance: object, name: string, value: unknown): void;
}
