import { TypeDefInfo } from "../data/types/TypeDefInfo.js";
import { PropertyDefInfo } from "../data/types/PropertyDefInfo.js";
import { FunctionDefInfo } from "../data/types/FunctionDefInfo.js";
import { EventDefInfo } from "../data/types/EventDefInfo.js";
import { ArgumentDefInfo } from "../data/types/ArgumentDefInfo.js";
import { PropertyDefFlags } from "../data/types/PropertyDefFlags.js";
import { FunctionDefFlags } from "../data/types/FunctionDefFlags.js";
import { EventDefFlags } from "../data/types/EventDefFlags.js";
import { ArgumentDefFlags } from "../data/types/ArgumentDefFlags.js";
import type { TypeDefKind } from "../data/types/ITypeDef.js";
import type {
  ArgumentTemplate,
  EventTemplate,
  FunctionTemplate,
  PropertyTemplate,
  TypeDef,
} from "./template.js";

/**
 * Build the wire-format {@link TypeDefInfo} for a resource's decorated
 * {@link TypeDef} surface (port of C# `TypeDefInfo.FromTypeDef`). `id`/`kind`
 * are supplied separately since ts's structural `TypeDef` (unlike dotnet's
 * richer class) carries no id of its own — callers pass the id a
 * `LocalTypeDef` was registered under, or (when relaying) the id assigned by
 * the upstream connection that originally described the type.
 *
 * ts's `PropertyTemplate`/`FunctionTemplate`/`EventTemplate` are leaner than
 * dotnet's `MemberDef` — no `usage`/`description`/`examples`/etc. metadata,
 * no resource-level constant members — so most `MemberDefInfo` fields beyond
 * identity/flags/type stay `undefined`; that's an accepted, current gap, not
 * an oversight here.
 */
export function typeDefInfoFromTypeDef(id: number, kind: TypeDefKind, typeDef: TypeDef): TypeDefInfo {
  const info = new TypeDefInfo();
  info.id = id;
  info.kind = kind;
  info.name = typeDef.className;
  info.annotations = typeDef.annotations;
  info.properties = typeDef.properties.map(propertyDefInfoFromTemplate);
  info.functions = typeDef.functions.map(functionDefInfoFromTemplate);
  info.events = typeDef.events.map(eventDefInfoFromTemplate);
  return info;
}

function propertyDefInfoFromTemplate(source: PropertyTemplate): PropertyDefInfo {
  const info = new PropertyDefInfo();
  info.index = source.index;
  info.name = source.name;
  info.flags = source.readOnly ? PropertyDefFlags.ReadOnly : PropertyDefFlags.None;
  info.annotations = source.annotations;
  info.valueType = source.valueType;
  return info;
}

function functionDefInfoFromTemplate(source: FunctionTemplate): FunctionDefInfo {
  const info = new FunctionDefInfo();
  info.index = source.index;
  info.name = source.name;
  info.flags = source.isStatic ? FunctionDefFlags.Static : FunctionDefFlags.None;
  info.annotations = source.annotations;
  info.returnType = source.returnType;
  info.arguments = source.args.map(argumentDefInfoFromTemplate);
  return info;
}

function eventDefInfoFromTemplate(source: EventTemplate): EventDefInfo {
  const info = new EventDefInfo();
  info.index = source.index;
  info.name = source.name;
  info.flags = source.subscribable ? EventDefFlags.None : EventDefFlags.AutoDelivered;
  info.annotations = source.annotations;
  info.argumentType = source.argType;
  return info;
}

function argumentDefInfoFromTemplate(source: ArgumentTemplate, index: number): ArgumentDefInfo {
  const info = new ArgumentDefInfo();
  info.index = index;
  info.name = source.name;
  info.flags = source.optional ? ArgumentDefFlags.Optional : ArgumentDefFlags.None;
  info.annotations = source.annotations;
  info.valueType = source.type;
  return info;
}
