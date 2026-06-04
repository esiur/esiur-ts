import {
  TypeDefKind,
  type ITypeDef,
  type TypeDefConstant,
  type TypeDefProperty,
} from "../data/types/ITypeDef.js";
import type { TypeTemplate } from "./template.js";

/**
 * Concrete type definition built from a resource/record class's
 * {@link TypeTemplate} (port of C# `LocalTypeDef`). Implements the layer-neutral
 * {@link ITypeDef} consumed by the serializer.
 */
export class LocalTypeDef implements ITypeDef {
  private cachedProperties?: TypeDefProperty[];

  constructor(
    readonly id: number,
    readonly kind: TypeDefKind,
    readonly name: string,
    readonly template: TypeTemplate,
    private readonly ctor?: new () => object,
    readonly constants?: TypeDefConstant[],
  ) {}

  get properties(): TypeDefProperty[] {
    return (this.cachedProperties ??= this.template.properties.map((p) => ({
      name: p.name,
      valueType: p.valueType,
    })));
  }

  createInstance(): object {
    if (!this.ctor) throw new Error(`TypeDef '${this.name}' has no constructor.`);
    return new this.ctor();
  }

  setProperty(instance: object, name: string, value: unknown): void {
    (instance as { [key: string]: unknown })[name] = value;
  }
}
