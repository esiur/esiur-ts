import { compose } from "../data/Codec.js";
import { composeForSignature, name64, signatureOf } from "../data/typeDefSignature.js";
import type { TypeDefKind } from "../data/types/ITypeDef.js";
import { typeDefInfoFromTypeDef } from "../resource/typeDefInfoCompose.js";
import type { TypeDef } from "../resource/template.js";
import type { LocalTypeDef } from "../resource/typedef.js";
import type { Warehouse } from "../resource/Warehouse.js";

/**
 * The id-independent signature of a definition this node serves (docs/typedef-sync.md): a hash
 * of its normal wire encoding with its own id zeroed and every type reference written as the
 * hash of the referenced class name.
 */
export function computeTypeDefSignature(
  kind: TypeDefKind,
  template: TypeDef,
  warehouse: Warehouse,
): bigint {
  const info = typeDefInfoFromTypeDef(0n, kind, template);
  info.signature = undefined;

  if (info.parent !== undefined) {
    let parentName: string | undefined;
    try {
      parentName = warehouse.getLocalTypeDefById(info.parent).name;
    } catch {
      /* a parent that cannot be named keeps no parent in the hash rather than an id */
    }
    info.parent = parentName === undefined ? undefined : name64(parentName);
  }

  return signatureOf(composeForSignature(() => compose(info, warehouse, null)));
}

/** Cached per definition: a registered definition does not change. */
export function localTypeDefSignature(local: LocalTypeDef, warehouse: Warehouse): bigint {
  local.signature ??= computeTypeDefSignature(local.kind, local.template, warehouse);
  return local.signature;
}
