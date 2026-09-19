import { TypeDefInfo } from "../data/types/TypeDefInfo.js";
import { PropertyDefInfo } from "../data/types/PropertyDefInfo.js";
import { FunctionDefInfo } from "../data/types/FunctionDefInfo.js";
import { EventDefInfo } from "../data/types/EventDefInfo.js";
import { ConstantDefInfo } from "../data/types/ConstantDefInfo.js";
import { ArgumentDefInfo } from "../data/types/ArgumentDefInfo.js";
import type { MemberDefInfo } from "../data/types/MemberDefInfo.js";
import { PropertyDefFlags } from "../data/types/PropertyDefFlags.js";
import { FunctionDefFlags } from "../data/types/FunctionDefFlags.js";
import { EventDefFlags } from "../data/types/EventDefFlags.js";
import { ArgumentDefFlags } from "../data/types/ArgumentDefFlags.js";
import type { TypeDefKind } from "../data/types/ITypeDef.js";
import type {
  ArgumentTemplate,
  ConstantTemplate,
  EventTemplate,
  FunctionTemplate,
  MemberMetadata,
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
 * The template classes intentionally mirror dotnet's `TypeDefInfo` metadata
 * and flag surface so a TypeScript host can describe the same contract as a
 * dotnet host without losing information while relaying a remote TypeDef.
 */
export function typeDefInfoFromTypeDef(id: bigint, kind: TypeDefKind, typeDef: TypeDef): TypeDefInfo {
  const info = new TypeDefInfo();
  info.version = typeDef.version;
  info.id = id;
  info.kind = kind;
  info.name = typeDef.className;
  info.parent = typeDef.parentTypeId;
  info.namespace = typeDef.namespace;
  info.usage = typeDef.usage;
  info.description = typeDef.description;
  info.example = typeDef.example;
  info.category = typeDef.category;
  info.since = typeDef.since;
  info.annotations = typeDef.annotations;
  info.properties = typeDef.properties.map(propertyDefInfoFromTemplate);
  info.functions = typeDef.functions.map(functionDefInfoFromTemplate);
  info.events = typeDef.events.map(eventDefInfoFromTemplate);
  info.constants = typeDef.constants.map(constantDefInfoFromTemplate);
  return info;
}

function copyMember<T extends MemberDefInfo>(source: MemberMetadata, target: T): T {
  target.description = source.description;
  target.usage = source.usage;
  target.examples = source.examples;
  target.tags = source.tags;
  target.unit = source.unit;
  target.minimum = source.minimum;
  target.maximum = source.maximum;
  target.allowedValues = source.allowedValues;
  target.pattern = source.pattern;
  target.format = source.format;
  target.preconditions = source.preconditions;
  target.postconditions = source.postconditions;
  target.effects = source.effects ?? 0;
  target.warnings = source.warnings;
  target.relatedMembers = source.relatedMembers;
  target.deprecationMessage = source.deprecationMessage;
  return target;
}

function propertyDefInfoFromTemplate(source: PropertyTemplate): PropertyDefInfo {
  const info = copyMember(source, new PropertyDefInfo());
  info.index = source.index;
  info.name = source.name;
  info.flags =
    (source.inherited ? PropertyDefFlags.Inherited : PropertyDefFlags.None) |
    (source.deprecated ? PropertyDefFlags.Deprecated : PropertyDefFlags.None) |
    (source.readOnly ? PropertyDefFlags.ReadOnly : PropertyDefFlags.None) |
    (source.constant ? PropertyDefFlags.Constant : PropertyDefFlags.None) |
    (source.volatile ? PropertyDefFlags.Volatile : PropertyDefFlags.None) |
    (source.historical ? PropertyDefFlags.Historical : PropertyDefFlags.None);
  info.annotations = source.annotations;
  info.valueType = source.valueType;
  info.orderingControl = source.orderingControl;
  info.historyControl = source.historyControl || (source.historical ? 1 : 0);
  info.defaultValue = source.defaultValue;
  return info;
}

function functionDefInfoFromTemplate(source: FunctionTemplate): FunctionDefInfo {
  const info = copyMember(source, new FunctionDefInfo());
  info.index = source.index;
  info.name = source.name;
  info.flags =
    (source.inherited ? FunctionDefFlags.Inherited : FunctionDefFlags.None) |
    (source.deprecated ? FunctionDefFlags.Deprecated : FunctionDefFlags.None) |
    (source.isStatic ? FunctionDefFlags.Static : FunctionDefFlags.None) |
    (source.readOnly ? FunctionDefFlags.ReadOnly : FunctionDefFlags.None) |
    (source.idempotent ? FunctionDefFlags.Idempotent : FunctionDefFlags.None) |
    (source.cancellable ? FunctionDefFlags.Cancellable : FunctionDefFlags.None) |
    (source.pausable ? FunctionDefFlags.Pausable : FunctionDefFlags.None);
  info.annotations = source.annotations;
  info.returnType = source.returnType;
  info.streamMode = source.streamMode;
  info.arguments = source.args.map(argumentDefInfoFromTemplate);
  return info;
}

function eventDefInfoFromTemplate(source: EventTemplate): EventDefInfo {
  const info = copyMember(source, new EventDefInfo());
  info.index = source.index;
  info.name = source.name;
  info.flags =
    (source.inherited ? EventDefFlags.Inherited : EventDefFlags.None) |
    (source.deprecated ? EventDefFlags.Deprecated : EventDefFlags.None) |
    (source.subscribable ? EventDefFlags.None : EventDefFlags.AutoDelivered) |
    (source.historical ? EventDefFlags.Historical : EventDefFlags.None);
  info.annotations = source.annotations;
  info.argumentType = source.argType;
  info.argumentName = source.argumentName;
  info.orderingControl = source.orderingControl;
  info.historyControl = source.historyControl || (source.historical ? 1 : 0);
  return info;
}

function constantDefInfoFromTemplate(source: ConstantTemplate): ConstantDefInfo {
  const info = copyMember(source, new ConstantDefInfo());
  info.index = source.index;
  info.name = source.name;
  info.flags =
    (source.inherited ? 0x01 : 0) |
    (source.deprecated ? 0x02 : 0);
  info.annotations = source.annotations;
  info.valueType = source.valueType;
  info.value = source.value;
  return info;
}

function argumentDefInfoFromTemplate(source: ArgumentTemplate, index: number): ArgumentDefInfo {
  const info = new ArgumentDefInfo();
  info.index = index;
  info.name = source.name;
  info.flags =
    (source.optional ? ArgumentDefFlags.Optional : ArgumentDefFlags.None) |
    (source.variadic ? ArgumentDefFlags.Variadic : ArgumentDefFlags.None);
  info.annotations = source.annotations;
  info.valueType = source.type;
  info.defaultValue = source.defaultValue;
  return info;
}
