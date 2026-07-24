import type { TypeDef } from "./template.js";

/**
 * A resource whose properties aren't backed by real class fields — e.g. a
 * remote {@link EpResource} proxy, whose values live in a wire-driven cache
 * indexed by property number rather than named class members. Implementing
 * this lets {@link Instance} read/write/serialize it the same way it does a
 * locally-defined resource (port of C# `IDynamicResource`).
 */
export interface IDynamicResource {
  /** The TypeDef describing this resource's shape (bypasses constructor-based lookup). */
  readonly resourceDefinition: TypeDef;
  getResourceProperty(index: number): unknown;
  setResourceProperty(index: number, value: unknown): void;
  getResourcePropertyAge(index: number): number;
  getResourcePropertyDate(index: number): Date | undefined;
}

export function isDynamicResource(value: unknown): value is IDynamicResource {
  return !!value && typeof (value as IDynamicResource).getResourceProperty === "function";
}
