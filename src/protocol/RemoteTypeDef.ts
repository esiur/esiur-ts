import { parseAsync, parseSync } from "../data/Codec.js";
import * as DC from "../data/DC.js";
import { Tru, type RemoteTypeDefResolver, type Tru as TruType } from "../data/Tru.js";
import { TduIdentifier } from "../data/TduIdentifier.js";
import {
  TypeDefKind,
  type ITypeDef,
  type TypeDefConstant,
  type TypeDefProperty,
} from "../data/types/ITypeDef.js";
import { TypeDefInfo } from "../data/types/TypeDefInfo.js";
import type { MemberDefInfo } from "../data/types/MemberDefInfo.js";
import type { PropertyDefInfo } from "../data/types/PropertyDefInfo.js";
import type { FunctionDefInfo } from "../data/types/FunctionDefInfo.js";
import type { EventDefInfo } from "../data/types/EventDefInfo.js";
import type { ConstantDefInfo } from "../data/types/ConstantDefInfo.js";
import type { ArgumentDefInfo } from "../data/types/ArgumentDefInfo.js";
import { MemberDefFlags } from "../data/types/MemberDefFlags.js";
import { PropertyDefFlags } from "../data/types/PropertyDefFlags.js";
import { FunctionDefFlags } from "../data/types/FunctionDefFlags.js";
import { EventDefFlags } from "../data/types/EventDefFlags.js";
import { ArgumentDefFlags } from "../data/types/ArgumentDefFlags.js";
import {
  ArgumentTemplate,
  EventTemplate,
  FunctionTemplate,
  PropertyTemplate,
  TypeDef,
} from "../resource/template.js";

/**
 * Documentation/semantics metadata shared by every member kind, introduced
 * alongside the `IndexedStructure`-based wire format. Absent (`undefined`)
 * for members decoded from the legacy manual byte format.
 */
export interface RemoteMemberMetadata {
  deprecated?: boolean;
  deprecationMessage?: string;
  description?: string;
  usage?: string;
  examples?: unknown[];
  tags?: string[];
  unit?: string;
  minimum?: unknown;
  maximum?: unknown;
  allowedValues?: unknown[];
  pattern?: string;
  format?: string;
  preconditions?: string[];
  postconditions?: string[];
  /** {@link import("../data/types/OperationEffects.js").OperationEffects} bitmask. */
  effects?: number;
  warnings?: string[];
  relatedMembers?: number[];
}

export interface RemoteArgumentDef extends RemoteMemberMetadata {
  index: number;
  name: string;
  type?: TruType;
  optional: boolean;
  variadic?: boolean;
  defaultValue?: unknown;
  annotations?: Map<string, string>;
}

export interface RemoteFunctionDef extends RemoteMemberMetadata {
  index: number;
  name: string;
  returnType?: TruType;
  arguments: RemoteArgumentDef[];
  inherited: boolean;
  isStatic: boolean;
  readOnly?: boolean;
  idempotent?: boolean;
  cancellable?: boolean;
  pausable?: boolean;
  /** {@link import("../data/types/StreamMode.js").StreamMode} bitmask. */
  streamMode?: number;
  annotations?: Map<string, string>;
}

export interface RemotePropertyDef extends RemoteMemberMetadata {
  index: number;
  name: string;
  valueType?: TruType;
  inherited: boolean;
  /** Legacy 2-bit permission field; not populated by the new-format decoder (unused downstream — see `readOnly`/`constant`/`volatile`). */
  permission: number;
  hasHistory: boolean;
  readOnly?: boolean;
  constant?: boolean;
  volatile?: boolean;
  orderingControl?: number;
  historyControl?: number;
  defaultValue?: unknown;
  annotations?: Map<string, string>;
}

export interface RemoteEventDef extends RemoteMemberMetadata {
  index: number;
  name: string;
  argumentType?: TruType;
  argumentName?: string;
  inherited: boolean;
  subscribable: boolean;
  autoDelivered?: boolean;
  orderingControl?: number;
  historyControl?: number;
  annotations?: Map<string, string>;
}

export interface RemoteConstantDef extends RemoteMemberMetadata {
  index: number;
  name: string;
  valueType?: TruType;
  value: unknown;
  inherited: boolean;
  annotations?: Map<string, string>;
}

export interface RemoteTypeDefSnapshot {
  id: number;
  name: string;
  kind: string;
  version: number;
  parentTypeId?: number;
  annotations?: Record<string, string>;
  properties: Array<Record<string, unknown>>;
  functions: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  constants: Array<Record<string, unknown>>;
}

export class RemoteTypeDef implements ITypeDef {
  template = new TypeDef("", []);

  private cachedProperties: TypeDefProperty[] = [];
  private _id = 0;
  private _kind = TypeDefKind.Resource;
  private _name = "";
  private _version = 0;
  private _parentTypeId: number | undefined;
  private _annotations: Map<string, string> | undefined;
  private _remoteProperties: RemotePropertyDef[] = [];
  private _remoteFunctions: RemoteFunctionDef[] = [];
  private _remoteEvents: RemoteEventDef[] = [];
  private _remoteConstants: RemoteConstantDef[] = [];

  get id(): number {
    return this._id;
  }

  get kind(): TypeDefKind {
    return this._kind;
  }

  get name(): string {
    return this._name;
  }

  get version(): number {
    return this._version;
  }

  get parentTypeId(): number | undefined {
    return this._parentTypeId;
  }

  get annotations(): Map<string, string> | undefined {
    return this._annotations;
  }

  get remoteProperties(): ReadonlyArray<RemotePropertyDef> {
    return this._remoteProperties;
  }

  get remoteFunctions(): ReadonlyArray<RemoteFunctionDef> {
    return this._remoteFunctions;
  }

  get remoteEvents(): ReadonlyArray<RemoteEventDef> {
    return this._remoteEvents;
  }

  get remoteConstants(): ReadonlyArray<RemoteConstantDef> {
    return this._remoteConstants;
  }

  hydrate(
    id: number,
    kind: TypeDefKind,
    name: string,
    version: number,
    parentTypeId: number | undefined,
    annotations: Map<string, string> | undefined,
    remoteProperties: RemotePropertyDef[],
    remoteFunctions: RemoteFunctionDef[],
    remoteEvents: RemoteEventDef[],
    remoteConstants: RemoteConstantDef[],
  ): void {
    this._id = id;
    this._kind = kind;
    this._name = name;
    this._version = version;
    this._parentTypeId = parentTypeId;
    this._annotations = annotations;
    this._remoteProperties = remoteProperties;
    this._remoteFunctions = remoteFunctions;
    this._remoteEvents = remoteEvents;
    this._remoteConstants = remoteConstants;

    const members = [
      ...remoteProperties.map(
        (p) => new PropertyTemplate(p.name, p.index, p.valueType, false, p.annotations),
      ),
      ...remoteFunctions.map(
        (f) =>
          new FunctionTemplate(
            f.name,
            f.index,
            f.returnType,
            f.arguments.map(
              (a) => new ArgumentTemplate(a.name, a.type, a.optional, a.annotations),
            ),
            f.isStatic,
            f.annotations,
          ),
      ),
      ...remoteEvents.map(
        (e) =>
          new EventTemplate(
            e.name,
            e.index,
            e.argumentType,
            e.annotations,
            e.subscribable,
          ),
      ),
    ];
    this.template = new TypeDef(name, members, annotations);
    this.cachedProperties = remoteProperties.map((p) => ({
      name: p.name,
      valueType: p.valueType,
    }));
  }

  get properties(): TypeDefProperty[] {
    return this.cachedProperties;
  }

  get constants(): TypeDefConstant[] {
    return this.remoteConstants.map((c) => ({
      name: c.name,
      value: c.value,
      index: c.index,
    }));
  }

  createInstance(): object {
    return {};
  }

  setProperty(instance: object, name: string, value: unknown): void {
    (instance as Record<string, unknown>)[name] = value;
  }

  toJSON(): RemoteTypeDefSnapshot {
    return {
      id: this.id,
      name: this.name,
      kind: TypeDefKind[this.kind] ?? String(this.kind),
      version: this.version,
      parentTypeId: this.parentTypeId,
      annotations: mapToObject(this.annotations),
      properties: this.remoteProperties.map((p) => ({
        index: p.index,
        name: p.name,
        type: p.valueType?.toString(),
        inherited: p.inherited,
        permission: p.permission,
        hasHistory: p.hasHistory,
        readOnly: p.readOnly,
        constant: p.constant,
        volatile: p.volatile,
        deprecated: p.deprecated,
        description: p.description,
        annotations: mapToObject(p.annotations),
      })),
      functions: this.remoteFunctions.map((f) => ({
        index: f.index,
        name: f.name,
        returnType: f.returnType?.toString(),
        inherited: f.inherited,
        isStatic: f.isStatic,
        readOnly: f.readOnly,
        idempotent: f.idempotent,
        cancellable: f.cancellable,
        pausable: f.pausable,
        deprecated: f.deprecated,
        description: f.description,
        arguments: f.arguments.map((a) => ({
          index: a.index,
          name: a.name,
          type: a.type?.toString(),
          optional: a.optional,
          variadic: a.variadic,
          annotations: mapToObject(a.annotations),
        })),
        annotations: mapToObject(f.annotations),
      })),
      events: this.remoteEvents.map((e) => ({
        index: e.index,
        name: e.name,
        argumentType: e.argumentType?.toString(),
        inherited: e.inherited,
        subscribable: e.subscribable,
        autoDelivered: e.autoDelivered,
        deprecated: e.deprecated,
        description: e.description,
        annotations: mapToObject(e.annotations),
      })),
      constants: this.remoteConstants.map((c) => ({
        index: c.index,
        name: c.name,
        type: c.valueType?.toString(),
        value: c.value,
        inherited: c.inherited,
        deprecated: c.deprecated,
        description: c.description,
        annotations: mapToObject(c.annotations),
      })),
    };
  }

  static parse(data: Uint8Array, warehouse: unknown = null): RemoteTypeDef {
    if ((data[0] & 0xc7) === TduIdentifier.TypeDef) {
      const parsed = parseSync(data, 0, warehouse);
      if (parsed.length !== data.length || !(parsed.value instanceof TypeDefInfo))
        throw new Error("Invalid TypeDefInfo payload.");
      const typeDef = new RemoteTypeDef();
      applyInfo(typeDef, parsed.value);
      return typeDef;
    }

    let offset = 0;
    const flags = data[offset++];
    const hasParent = (flags & 0x80) > 0;
    const hasClassAnnotation = (flags & 0x40) > 0;
    const kind = (flags & 0x0f) as TypeDefKind;

    const id = Number(DC.getUint64(data, offset));
    offset += 8;

    const name = readName(data, offset);
    offset = name.offset;

    let parentTypeId: number | undefined;
    if (hasParent) {
      parentTypeId = Number(DC.getUint64(data, offset));
      offset += 8;
    }

    let annotations: Map<string, string> | undefined;
    if (hasClassAnnotation) {
      const parsed = parseSync(data, offset, warehouse);
      annotations = asStringMap(parsed.value);
      offset += parsed.length;
    }

    const version = DC.getInt32(data, offset);
    offset += 4;
    const memberCount = DC.getUint16(data, offset);
    offset += 2;

    const functions: RemoteFunctionDef[] = [];
    const properties: RemotePropertyDef[] = [];
    const events: RemoteEventDef[] = [];
    const constants: RemoteConstantDef[] = [];

    let functionIndex = 0;
    let propertyIndex = 0;
    let eventIndex = 0;
    let constantIndex = 0;

    for (let i = 0; i < memberCount; i++) {
      const inherited = (data[offset] & 0x80) > 0;
      const memberType = (data[offset] >> 5) & 0x3;
      if (memberType === 0) {
        const parsed = parseFunction(data, offset, functionIndex++, inherited, warehouse);
        functions.push(parsed.value);
        offset = parsed.offset;
      } else if (memberType === 1) {
        const parsed = parseProperty(data, offset, propertyIndex++, inherited, warehouse);
        properties.push(parsed.value);
        offset = parsed.offset;
      } else if (memberType === 2) {
        const parsed = parseEvent(data, offset, eventIndex++, inherited, warehouse);
        events.push(parsed.value);
        offset = parsed.offset;
      } else {
        const parsed = parseConstant(data, offset, constantIndex++, inherited, warehouse);
        constants.push(parsed.value);
        offset = parsed.offset;
      }
    }

    const typeDef = new RemoteTypeDef();
    typeDef.hydrate(
      id,
      kind,
      name.value,
      version,
      parentTypeId,
      annotations,
      properties,
      functions,
      events,
      constants,
    );
    return typeDef;
  }

  static async parseAsync(
    data: Uint8Array,
    warehouse: unknown = null,
    remoteResolver?: RemoteTypeDefResolver,
    requestSequence: readonly number[] | null = null,
  ): Promise<RemoteTypeDef> {
    return RemoteTypeDef.parseAsyncInto(
      new RemoteTypeDef(),
      data,
      warehouse,
      remoteResolver,
      requestSequence,
    );
  }

  static async parseAsyncInto(
    target: RemoteTypeDef,
    data: Uint8Array,
    warehouse: unknown = null,
    remoteResolver?: RemoteTypeDefResolver,
    requestSequence: readonly number[] | null = null,
  ): Promise<RemoteTypeDef> {
    if ((data[0] & 0xc7) === TduIdentifier.TypeDef) {
      const parsed = await parseAsync(data, 0, warehouse, remoteResolver, requestSequence);
      if (parsed.length !== data.length || !(parsed.value instanceof TypeDefInfo))
        throw new Error("Invalid TypeDefInfo payload.");
      applyInfo(target, parsed.value);
      return target;
    }

    let offset = 0;
    const flags = data[offset++];
    const hasParent = (flags & 0x80) > 0;
    const hasClassAnnotation = (flags & 0x40) > 0;
    const kind = (flags & 0x0f) as TypeDefKind;

    const id = Number(DC.getUint64(data, offset));
    offset += 8;

    const name = readName(data, offset);
    offset = name.offset;

    let parentTypeId: number | undefined;
    if (hasParent) {
      parentTypeId = Number(DC.getUint64(data, offset));
      offset += 8;
    }

    let annotations: Map<string, string> | undefined;
    if (hasClassAnnotation) {
      const parsed = parseSync(data, offset, warehouse);
      annotations = asStringMap(parsed.value);
      offset += parsed.length;
    }

    const version = DC.getInt32(data, offset);
    offset += 4;
    const memberCount = DC.getUint16(data, offset);
    offset += 2;

    const functions: RemoteFunctionDef[] = [];
    const properties: RemotePropertyDef[] = [];
    const events: RemoteEventDef[] = [];
    const constants: RemoteConstantDef[] = [];

    target.hydrate(
      id,
      kind,
      name.value,
      version,
      parentTypeId,
      annotations,
      properties,
      functions,
      events,
      constants,
    );

    let functionIndex = 0;
    let propertyIndex = 0;
    let eventIndex = 0;
    let constantIndex = 0;

    for (let i = 0; i < memberCount; i++) {
      const inherited = (data[offset] & 0x80) > 0;
      const memberType = (data[offset] >> 5) & 0x3;
      if (memberType === 0) {
        const parsed = await parseFunctionAsync(
          data,
          offset,
          functionIndex++,
          inherited,
          warehouse,
          remoteResolver,
          requestSequence,
        );
        functions.push(parsed.value);
        offset = parsed.offset;
      } else if (memberType === 1) {
        const parsed = await parsePropertyAsync(
          data,
          offset,
          propertyIndex++,
          inherited,
          warehouse,
          remoteResolver,
          requestSequence,
        );
        properties.push(parsed.value);
        offset = parsed.offset;
      } else if (memberType === 2) {
        const parsed = await parseEventAsync(
          data,
          offset,
          eventIndex++,
          inherited,
          warehouse,
          remoteResolver,
          requestSequence,
        );
        events.push(parsed.value);
        offset = parsed.offset;
      } else {
        const parsed = await parseConstantAsync(
          data,
          offset,
          constantIndex++,
          inherited,
          warehouse,
          remoteResolver,
          requestSequence,
        );
        constants.push(parsed.value);
        offset = parsed.offset;
      }
    }

    target.hydrate(
      id,
      kind,
      name.value,
      version,
      parentTypeId,
      annotations,
      properties,
      functions,
      events,
      constants,
    );
    return target;
  }
}

// ---- new-format (IndexedStructure/TduIdentifier.TypeDef) conversion -------

/**
 * Populate `target` from a decoded new-format {@link TypeDefInfo} (port of C#
 * `RemoteTypeDef.ApplyInfo`/`ApplyMember`/`ToProperty`/`ToFunction`/
 * `ToArgument`/`ToEvent`/`ToConstant`). The member lists are already fully
 * decoded objects by this point (see `hydrateTypeDefInfo` in
 * `DataDeserializer.ts`) — this is purely field remapping onto the existing
 * `Remote*Def` shapes, no further byte parsing.
 */
function applyInfo(target: RemoteTypeDef, info: TypeDefInfo): void {
  const properties = (info.properties ?? []).map((p) => toRemoteProperty(p));
  const functions = (info.functions ?? []).map((f) => toRemoteFunction(f));
  const events = (info.events ?? []).map((e) => toRemoteEvent(e));
  const constants = (info.constants ?? []).map((c) => toRemoteConstant(c));

  target.hydrate(
    info.id,
    info.kind,
    info.name,
    info.version,
    info.parent,
    info.annotations,
    properties,
    functions,
    events,
    constants,
  );
}

function toRemoteProperty(p: PropertyDefInfo): RemotePropertyDef {
  const flags = p.flags;
  return {
    index: p.index,
    name: p.name,
    valueType: p.valueType,
    inherited: (flags & MemberDefFlags.Inherited) !== 0,
    // Legacy 2-bit permission field; the new format has no equivalent (and
    // nothing downstream consumes it — see `readOnly`/`constant`/`volatile`).
    permission: 0,
    hasHistory: (flags & PropertyDefFlags.Historical) !== 0 || p.historyControl !== 0,
    readOnly: (flags & PropertyDefFlags.ReadOnly) !== 0,
    constant: (flags & PropertyDefFlags.Constant) !== 0,
    volatile: (flags & PropertyDefFlags.Volatile) !== 0,
    orderingControl: p.orderingControl,
    historyControl: p.historyControl,
    defaultValue: p.defaultValue,
    annotations: p.annotations,
    ...memberMetadata(p),
  };
}

function toRemoteFunction(f: FunctionDefInfo): RemoteFunctionDef {
  const flags = f.flags;
  return {
    index: f.index,
    name: f.name,
    returnType: f.returnType,
    arguments: (f.arguments ?? []).map(toRemoteArgument),
    inherited: (flags & MemberDefFlags.Inherited) !== 0,
    isStatic: (flags & FunctionDefFlags.Static) !== 0,
    readOnly: (flags & FunctionDefFlags.ReadOnly) !== 0,
    idempotent: (flags & FunctionDefFlags.Idempotent) !== 0,
    cancellable: (flags & FunctionDefFlags.Cancellable) !== 0,
    pausable: (flags & FunctionDefFlags.Pausable) !== 0,
    streamMode: f.streamMode,
    annotations: f.annotations,
    ...memberMetadata(f),
  };
}

function toRemoteEvent(e: EventDefInfo): RemoteEventDef {
  const flags = e.flags;
  return {
    index: e.index,
    name: e.name,
    argumentType: e.argumentType,
    argumentName: e.argumentName,
    inherited: (flags & MemberDefFlags.Inherited) !== 0,
    // The new format has no direct "subscribable" bit; an auto-delivered
    // event is pushed without a subscription, so treat non-auto-delivered
    // events as subscribable (matches typical Subscribe/Unsubscribe usage).
    subscribable: (flags & EventDefFlags.AutoDelivered) === 0,
    autoDelivered: (flags & EventDefFlags.AutoDelivered) !== 0,
    orderingControl: e.orderingControl,
    historyControl: e.historyControl,
    annotations: e.annotations,
    ...memberMetadata(e),
  };
}

function toRemoteConstant(c: ConstantDefInfo): RemoteConstantDef {
  const flags = c.flags;
  return {
    index: c.index,
    name: c.name,
    valueType: c.valueType,
    value: c.value,
    inherited: (flags & MemberDefFlags.Inherited) !== 0,
    annotations: c.annotations,
    ...memberMetadata(c),
  };
}

function toRemoteArgument(a: ArgumentDefInfo): RemoteArgumentDef {
  const flags = a.flags;
  return {
    index: a.index,
    name: a.name,
    type: a.valueType,
    optional: (flags & ArgumentDefFlags.Optional) !== 0,
    variadic: (flags & ArgumentDefFlags.Variadic) !== 0,
    defaultValue: a.defaultValue,
    annotations: a.annotations,
  };
}

/** Extract the shared documentation/semantics metadata fields common to every member kind. */
function memberMetadata(m: MemberDefInfo): RemoteMemberMetadata {
  const meta: RemoteMemberMetadata = {};
  if ((m.flags & MemberDefFlags.Deprecated) !== 0) meta.deprecated = true;
  if (m.deprecationMessage !== undefined) meta.deprecationMessage = m.deprecationMessage;
  if (m.description !== undefined) meta.description = m.description;
  if (m.usage !== undefined) meta.usage = m.usage;
  if (m.examples !== undefined) meta.examples = m.examples;
  if (m.tags !== undefined) meta.tags = m.tags;
  if (m.unit !== undefined) meta.unit = m.unit;
  if (m.minimum !== undefined) meta.minimum = m.minimum;
  if (m.maximum !== undefined) meta.maximum = m.maximum;
  if (m.allowedValues !== undefined) meta.allowedValues = m.allowedValues;
  if (m.pattern !== undefined) meta.pattern = m.pattern;
  if (m.format !== undefined) meta.format = m.format;
  if (m.preconditions !== undefined) meta.preconditions = m.preconditions;
  if (m.postconditions !== undefined) meta.postconditions = m.postconditions;
  if (m.effects !== undefined) meta.effects = m.effects;
  if (m.warnings !== undefined) meta.warnings = m.warnings;
  if (m.relatedMembers !== undefined) meta.relatedMembers = m.relatedMembers;
  return meta;
}

// ---- legacy manual-byte-format helpers -------------------------------------

function parseFunction(
  data: Uint8Array,
  offset: number,
  index: number,
  inherited: boolean,
  warehouse: unknown,
): { value: RemoteFunctionDef; offset: number } {
  const header = data[offset++];
  const isStatic = (header & 0x04) > 0;
  const hasAnnotations = (header & 0x10) > 0;

  const name = readName(data, offset);
  offset = name.offset;

  const returnType = Tru.parseSync(data, offset, warehouse);
  offset += returnType.size;

  const argsCount = data[offset++];
  const args: RemoteArgumentDef[] = [];
  for (let i = 0; i < argsCount; i++) {
    const parsed = parseArgument(data, offset, i, warehouse);
    args.push(parsed.value);
    offset = parsed.offset;
  }

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseAnnotationMap(data, offset, warehouse, true);
    annotations = parsed.value;
    offset = parsed.offset;
  }

  return {
    value: {
      index,
      name: name.value,
      returnType: returnType.value,
      arguments: args,
      inherited,
      isStatic,
      annotations,
    },
    offset,
  };
}

async function parseFunctionAsync(
  data: Uint8Array,
  offset: number,
  index: number,
  inherited: boolean,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly number[] | null,
): Promise<{ value: RemoteFunctionDef; offset: number }> {
  const header = data[offset++];
  const isStatic = (header & 0x04) > 0;
  const hasAnnotations = (header & 0x10) > 0;

  const name = readName(data, offset);
  offset = name.offset;

  const returnType = await Tru.parseAsync(
    data,
    offset,
    warehouse,
    remoteResolver,
    requestSequence,
  );
  offset += returnType.size;

  const argsCount = data[offset++];
  const args: RemoteArgumentDef[] = [];
  for (let i = 0; i < argsCount; i++) {
    const parsed = await parseArgumentAsync(
      data,
      offset,
      i,
      warehouse,
      remoteResolver,
      requestSequence,
    );
    args.push(parsed.value);
    offset = parsed.offset;
  }

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseAnnotationMap(data, offset, warehouse, true);
    annotations = parsed.value;
    offset = parsed.offset;
  }

  return {
    value: {
      index,
      name: name.value,
      returnType: returnType.value,
      arguments: args,
      inherited,
      isStatic,
      annotations,
    },
    offset,
  };
}

function parseProperty(
  data: Uint8Array,
  offset: number,
  index: number,
  inherited: boolean,
  warehouse: unknown,
): { value: RemotePropertyDef; offset: number } {
  const header = data[offset++];
  const hasAnnotations = (header & 0x08) > 0;
  const hasHistory = (header & 0x01) > 0;
  const permission = (header >> 1) & 0x03;

  const name = readName(data, offset);
  offset = name.offset;

  const valueType = Tru.parseSync(data, offset, warehouse);
  offset += valueType.size;

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseAnnotationMap(data, offset, warehouse, true);
    annotations = parsed.value;
    offset = parsed.offset;
  }

  return {
    value: {
      index,
      name: name.value,
      valueType: valueType.value,
      inherited,
      permission,
      hasHistory,
      annotations,
    },
    offset,
  };
}

async function parsePropertyAsync(
  data: Uint8Array,
  offset: number,
  index: number,
  inherited: boolean,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly number[] | null,
): Promise<{ value: RemotePropertyDef; offset: number }> {
  const header = data[offset++];
  const hasAnnotations = (header & 0x08) > 0;
  const hasHistory = (header & 0x01) > 0;
  const permission = (header >> 1) & 0x03;

  const name = readName(data, offset);
  offset = name.offset;

  const valueType = await Tru.parseAsync(
    data,
    offset,
    warehouse,
    remoteResolver,
    requestSequence,
  );
  offset += valueType.size;

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseAnnotationMap(data, offset, warehouse, true);
    annotations = parsed.value;
    offset = parsed.offset;
  }

  return {
    value: {
      index,
      name: name.value,
      valueType: valueType.value,
      inherited,
      permission,
      hasHistory,
      annotations,
    },
    offset,
  };
}

function parseEvent(
  data: Uint8Array,
  offset: number,
  index: number,
  inherited: boolean,
  warehouse: unknown,
): { value: RemoteEventDef; offset: number } {
  const header = data[offset++];
  const hasAnnotations = (header & 0x10) > 0;
  const subscribable = (header & 0x08) > 0;

  const name = readName(data, offset);
  offset = name.offset;

  const argType = Tru.parseSync(data, offset, warehouse);
  offset += argType.size;

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseAnnotationMap(data, offset, warehouse, true);
    annotations = parsed.value;
    offset = parsed.offset;
  }

  return {
    value: {
      index,
      name: name.value,
      argumentType: argType.value,
      inherited,
      subscribable,
      annotations,
    },
    offset,
  };
}

async function parseEventAsync(
  data: Uint8Array,
  offset: number,
  index: number,
  inherited: boolean,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly number[] | null,
): Promise<{ value: RemoteEventDef; offset: number }> {
  const header = data[offset++];
  const hasAnnotations = (header & 0x10) > 0;
  const subscribable = (header & 0x08) > 0;

  const name = readName(data, offset);
  offset = name.offset;

  const argType = await Tru.parseAsync(
    data,
    offset,
    warehouse,
    remoteResolver,
    requestSequence,
  );
  offset += argType.size;

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseAnnotationMap(data, offset, warehouse, true);
    annotations = parsed.value;
    offset = parsed.offset;
  }

  return {
    value: {
      index,
      name: name.value,
      argumentType: argType.value,
      inherited,
      subscribable,
      annotations,
    },
    offset,
  };
}

function parseArgument(
  data: Uint8Array,
  offset: number,
  index: number,
  warehouse: unknown,
): { value: RemoteArgumentDef; offset: number } {
  const header = data[offset++];
  const optional = (header & 0x01) > 0;
  const hasAnnotations = (header & 0x02) > 0;

  const name = readName(data, offset);
  offset = name.offset;

  const type = Tru.parseSync(data, offset, warehouse);
  offset += type.size;

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseSync(data, offset, warehouse);
    annotations = asStringMap(parsed.value);
    offset += parsed.length;
  }

  return {
    value: {
      index,
      name: name.value,
      type: type.value,
      optional,
      annotations,
    },
    offset,
  };
}

async function parseArgumentAsync(
  data: Uint8Array,
  offset: number,
  index: number,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly number[] | null,
): Promise<{ value: RemoteArgumentDef; offset: number }> {
  const header = data[offset++];
  const optional = (header & 0x01) > 0;
  const hasAnnotations = (header & 0x02) > 0;

  const name = readName(data, offset);
  offset = name.offset;

  const type = await Tru.parseAsync(
    data,
    offset,
    warehouse,
    remoteResolver,
    requestSequence,
  );
  offset += type.size;

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseSync(data, offset, warehouse);
    annotations = asStringMap(parsed.value);
    offset += parsed.length;
  }

  return {
    value: {
      index,
      name: name.value,
      type: type.value,
      optional,
      annotations,
    },
    offset,
  };
}

function parseConstant(
  data: Uint8Array,
  offset: number,
  index: number,
  inherited: boolean,
  warehouse: unknown,
): { value: RemoteConstantDef; offset: number } {
  const header = data[offset++];
  const hasAnnotations = (header & 0x10) > 0;

  const name = readName(data, offset);
  offset = name.offset;

  const valueType = Tru.parseSync(data, offset, warehouse);
  offset += valueType.size;

  const value = parseSync(data, offset, warehouse);
  offset += value.length;

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseSync(data, offset, warehouse);
    annotations = asStringMap(parsed.value);
    offset += parsed.length;
  }

  return {
    value: {
      index,
      name: name.value,
      valueType: valueType.value,
      value: value.value,
      inherited,
      annotations,
    },
    offset,
  };
}

async function parseConstantAsync(
  data: Uint8Array,
  offset: number,
  index: number,
  inherited: boolean,
  warehouse: unknown,
  remoteResolver: RemoteTypeDefResolver | undefined,
  requestSequence: readonly number[] | null,
): Promise<{ value: RemoteConstantDef; offset: number }> {
  const header = data[offset++];
  const hasAnnotations = (header & 0x10) > 0;

  const name = readName(data, offset);
  offset = name.offset;

  const valueType = await Tru.parseAsync(
    data,
    offset,
    warehouse,
    remoteResolver,
    requestSequence,
  );
  offset += valueType.size;

  const value = parseSync(data, offset, warehouse);
  offset += value.length;

  let annotations: Map<string, string> | undefined;
  if (hasAnnotations) {
    const parsed = parseSync(data, offset, warehouse);
    annotations = asStringMap(parsed.value);
    offset += parsed.length;
  }

  return {
    value: {
      index,
      name: name.value,
      valueType: valueType.value,
      value: value.value,
      inherited,
      annotations,
    },
    offset,
  };
}

function readName(data: Uint8Array, offset: number): { value: string; offset: number } {
  const length = data[offset++];
  const value = DC.getString(data, offset, length);
  return { value, offset: offset + length };
}

function parseAnnotationMap(
  data: Uint8Array,
  offset: number,
  warehouse: unknown,
  allowLengthPrefix = false,
): { value: Map<string, string> | undefined; offset: number } {
  if (allowLengthPrefix && offset + 4 <= data.length) {
    const length = DC.getUint32(data, offset);
    const starts = offset + 4;
    const ends = starts + length;
    if (length > 0 && ends <= data.length) {
      try {
        const parsed = parseSync(data.slice(starts, ends), 0, warehouse);
        if (parsed.length === length)
          return { value: asStringMap(parsed.value), offset: ends };
      } catch {
        // Fall through to the direct TDU shape used by other member annotations.
      }
    }
  }

  const parsed = parseSync(data, offset, warehouse);
  return { value: asStringMap(parsed.value), offset: offset + parsed.length };
}

function asStringMap(value: unknown): Map<string, string> | undefined {
  if (!(value instanceof Map)) return undefined;
  const result = new Map<string, string>();
  for (const [k, v] of value.entries())
    result.set(String(k), String(v));
  return result;
}

function mapToObject(map: Map<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return undefined;
  return Object.fromEntries(map.entries());
}
