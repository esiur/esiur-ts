import { parseSync } from "../data/Codec.js";
import * as DC from "../data/DC.js";
import { Tru, type RemoteTypeDefResolver, type Tru as TruType } from "../data/Tru.js";
import {
  TypeDefKind,
  type ITypeDef,
  type TypeDefConstant,
  type TypeDefProperty,
} from "../data/types/ITypeDef.js";
import {
  ArgumentTemplate,
  EventTemplate,
  FunctionTemplate,
  PropertyTemplate,
  TypeDef,
} from "../resource/template.js";

export interface RemoteArgumentDef {
  index: number;
  name: string;
  type?: TruType;
  optional: boolean;
  annotations?: Map<string, string>;
}

export interface RemoteFunctionDef {
  index: number;
  name: string;
  returnType?: TruType;
  arguments: RemoteArgumentDef[];
  inherited: boolean;
  isStatic: boolean;
  annotations?: Map<string, string>;
}

export interface RemotePropertyDef {
  index: number;
  name: string;
  valueType?: TruType;
  inherited: boolean;
  permission: number;
  hasHistory: boolean;
  annotations?: Map<string, string>;
}

export interface RemoteEventDef {
  index: number;
  name: string;
  argumentType?: TruType;
  inherited: boolean;
  subscribable: boolean;
  annotations?: Map<string, string>;
}

export interface RemoteConstantDef {
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
        annotations: mapToObject(p.annotations),
      })),
      functions: this.remoteFunctions.map((f) => ({
        index: f.index,
        name: f.name,
        returnType: f.returnType?.toString(),
        inherited: f.inherited,
        isStatic: f.isStatic,
        arguments: f.arguments.map((a) => ({
          index: a.index,
          name: a.name,
          type: a.type?.toString(),
          optional: a.optional,
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
        annotations: mapToObject(e.annotations),
      })),
      constants: this.remoteConstants.map((c) => ({
        index: c.index,
        name: c.name,
        type: c.valueType?.toString(),
        value: c.value,
        inherited: c.inherited,
        annotations: mapToObject(c.annotations),
      })),
    };
  }

  static parse(data: Uint8Array, warehouse: unknown = null): RemoteTypeDef {
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
