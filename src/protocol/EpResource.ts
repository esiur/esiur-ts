import { EventHandler } from "../core/EventHandler.js";
import { AsyncReply } from "../core/AsyncReply.js";
import { TypeDef } from "../resource/template.js";
import type { EpConnection } from "./EpConnection.js";

/** Notification payload for a remote property change. */
export interface RemotePropertyChange {
  name: string;
  index: number;
  value: unknown;
  age?: number;
  date?: Date;
}

/** Snapshot metadata for one remote property value. */
export interface RemotePropertyValue {
  index: number;
  age: number;
  date?: Date;
  value: unknown;
}

export interface EpResourceOptions {
  typeDefId?: number;
  age?: number;
  link?: string;
  hops?: number;
}

/** Constructor shape emitted by generated TypeScript remote resource stubs. */
export type EpResourceConstructor<T extends EpResource = EpResource> = new (
  connection: EpConnection,
  instanceId: number,
  age: number,
  link: string,
) => T;

/**
 * A remote resource proxy (port of C# `EpResource`). Wraps a connection +
 * instance id + TypeDef; exported functions invoke remotely, exported
 * properties read from a locally-cached value (kept fresh by PropertyModified
 * notifications), and exported events surface via {@link eventOccurred}.
 *
 * Use {@link createProxy} to get an ergonomic object where `res.sayHi(x)` and
 * `res.counts` work directly.
 */
export class EpResource {
  /** Property index to last known value. */
  readonly cache = new Map<number, unknown>();
  /** Property index to last known property age. */
  readonly propertyAges = new Map<number, number>();
  /** Property index to last known modification date. */
  readonly propertyModificationDates = new Map<number, Date | undefined>();
  /** Fires when a property is updated by a notification. */
  readonly propertyModified = new EventHandler<RemotePropertyChange>();
  /** Fires when a remote event occurs. */
  readonly eventOccurred = new EventHandler<RemotePropertyChange>();

  typeDefId?: number;
  age = 0;
  link = "";
  hops = 0;

  connection!: EpConnection;
  instanceId = 0;
  typeDef: TypeDef = new TypeDef("", []);

  /** Array alias used by generated stubs (`this.properties[index]`). */
  protected readonly properties: unknown[] = [];
  /** .NET-name alias used by generated stubs (`this._properties[index]`). */
  protected readonly _properties = this.properties;

  constructor();
  constructor(
    connection: EpConnection,
    instanceId: number,
    typeDef: TypeDef,
    options?: EpResourceOptions,
  );
  constructor(connection: EpConnection, instanceId: number, age: number, link?: string);
  constructor(
    connection?: EpConnection,
    instanceId = 0,
    typeDefOrAge?: TypeDef | number,
    optionsOrLink: EpResourceOptions | string = {},
  ) {
    if (connection) this.connection = connection;
    this.instanceId = instanceId;

    if (isTypeDef(typeDefOrAge)) {
      this.typeDef = typeDefOrAge;
      const options = typeof optionsOrLink === "string" ? { link: optionsOrLink } : optionsOrLink;
      this.setRemoteIdentity(options);
    } else {
      this.age = typeDefOrAge ?? 0;
      this.link = typeof optionsOrLink === "string" ? optionsOrLink : (optionsOrLink.link ?? "");
      if (typeof optionsOrLink !== "string") this.setRemoteIdentity(optionsOrLink);
    }
  }

  /** @deprecated Use {@link typeDef}. */
  get template(): TypeDef {
    return this.typeDef;
  }

  /** .NET-compatible alias for {@link connection}. */
  get ResourceConnection(): EpConnection {
    return this.connection;
  }

  /** .NET-compatible alias for {@link link}. */
  get ResourceLink(): string {
    return this.link;
  }

  /** .NET-compatible alias for {@link instanceId}. */
  get ResourceInstanceId(): number {
    return this.instanceId;
  }

  set ResourceInstanceId(value: number) {
    this.instanceId = value;
  }

  /** .NET-compatible alias for {@link typeDef}. */
  get ResourceDefinition(): TypeDef {
    return this.typeDef;
  }

  set ResourceDefinition(value: TypeDef) {
    this.typeDef = value;
  }

  /** @internal Initialize an instance created from a generated subclass. */
  initializeRemote(
    connection: EpConnection,
    instanceId: number,
    typeDef: TypeDef,
    options: EpResourceOptions = {},
  ): void {
    this.connection = connection;
    this.instanceId = instanceId;
    this.typeDef = typeDef;
    this.setRemoteIdentity(options);
  }

  /** @internal Update resource-level metadata returned by attach/reattach. */
  setRemoteIdentity(options: EpResourceOptions & { instanceId?: number }): void {
    if (options.instanceId != null) this.instanceId = options.instanceId;
    if (options.typeDefId != null) this.typeDefId = options.typeDefId;
    if (options.age != null) this.age = options.age;
    if (options.link != null) this.link = options.link;
    if (options.hops != null) this.hops = options.hops;
  }

  /** @internal Seed or merge a property snapshot without implying a notification. */
  setPropertySnapshot(index: number, age: number, date: Date | undefined, value: unknown): void {
    this.properties[index] = value;
    this.cache.set(index, value);
    this.propertyAges.set(index, age);
    this.propertyModificationDates.set(index, date);
    if (age > this.age) this.age = age;
  }

  /** Last known age for a property index. */
  getAge(index: number): number {
    return this.propertyAges.get(index) ?? 0;
  }

  /** Last known modification date for a property index. */
  getModificationDate(index: number): Date | undefined {
    return this.propertyModificationDates.get(index);
  }

  /** @internal Merge a sparse reattach delta. */
  applyDelta(delta: readonly RemotePropertyValue[]): void {
    for (const pv of delta)
      this.setPropertySnapshot(pv.index, pv.age, pv.date, pv.value);
  }

  /** @internal Apply a property value pushed by the server. */
  updateProperty(index: number, value: unknown, age?: number, date?: Date): void {
    this.properties[index] = value;
    this.cache.set(index, value);
    if (age != null) {
      this.propertyAges.set(index, age);
      if (age > this.age) this.age = age;
    }
    if (date != null) this.propertyModificationDates.set(index, date);
    const pt = this.typeDef.getPropertyByIndex(index);
    if (pt) this.propertyModified.emit({ name: pt.name, index, value, age, date });
  }

  /** @internal Apply an event occurrence pushed by the server. */
  applyEvent(index: number, value: unknown): void {
    const et = this.typeDef.getEventByIndex(index);
    if (et) this.eventOccurred.emit({ name: et.name, index, value });
    this._EmitEventByIndex(index, value);
  }

  /** Invoke a remote function by index. Used by generated EpResource stubs. */
  protected _Invoke(index: number, args: unknown = []): AsyncReply {
    return this.requireConnection().invokeWithArguments(this.instanceId, index, normalizeArguments(args));
  }

  /** Older generated-stub alias for invoking by positional argument array. */
  protected _InvokeByArrayArguments(index: number, args: readonly unknown[] = []): AsyncReply {
    return this._Invoke(index, args);
  }

  /** Read a cached remote property by index. Used by generated EpResource stubs. */
  protected GetResourceProperty<T = unknown>(index: number): T {
    return this.properties[index] as T;
  }

  /** camelCase alias for {@link GetResourceProperty}. */
  protected getResourceProperty<T = unknown>(index: number): T {
    return this.GetResourceProperty<T>(index);
  }

  /** Set a remote property asynchronously by index. */
  protected SetResourcePropertyAsync(index: number, value: unknown): AsyncReply<void> {
    return this.requireConnection().set(this.instanceId, index, value).then(() => {
      this.setLocalProperty(index, value);
    }) as AsyncReply<void>;
  }

  /** camelCase alias for {@link SetResourcePropertyAsync}. */
  protected setResourcePropertyAsync(index: number, value: unknown): AsyncReply<void> {
    return this.SetResourcePropertyAsync(index, value);
  }

  /** Set a remote property by index and update the local cache optimistically. */
  protected SetResourceProperty(index: number, value: unknown): AsyncReply<void> {
    const reply = this.requireConnection().set(this.instanceId, index, value).then(() => undefined);
    this.setLocalProperty(index, value);
    return reply as AsyncReply<void>;
  }

  /** camelCase alias for {@link SetResourceProperty}. */
  protected setResourceProperty(index: number, value: unknown): AsyncReply<void> {
    return this.SetResourceProperty(index, value);
  }

  /** Override point for generated typed event dispatch. */
  protected _EmitEventByIndex(_index: number, _value: unknown): void {
    /* generated subclasses may override */
  }

  private setLocalProperty(index: number, value: unknown): void {
    this.properties[index] = value;
    this.cache.set(index, value);
  }

  private requireConnection(): EpConnection {
    if (!this.connection) throw new Error("Remote resource is not attached to a connection.");
    return this.connection;
  }

  /** Wrap an {@link EpResource} in an ergonomic dynamic proxy. */
  static createProxy(resource: EpResource): EpResource & Record<string, any> {
    return new Proxy(resource, proxyHandler) as EpResource & Record<string, any>;
  }
}

const proxyHandler: ProxyHandler<EpResource> = {
  get(target, prop, receiver) {
    if (typeof prop === "string" && !(prop in target)) {
      const fn = target.typeDef.getFunctionByName(prop);
      if (fn) {
        return (...args: unknown[]): AsyncReply =>
          target.connection.invoke(target.instanceId, fn.index, ...args);
      }
      const pt = target.typeDef.getPropertyByName(prop);
      if (pt) return target.cache.get(pt.index);
    }
    return Reflect.get(target, prop, receiver);
  },

  set(target, prop, value, receiver) {
    if (typeof prop === "string") {
      const pt = target.typeDef.getPropertyByName(prop);
      if (pt) {
        target.connection.set(target.instanceId, pt.index, value);
        target.cache.set(pt.index, value);
        return true;
      }
    }
    return Reflect.set(target, prop, value, receiver);
  },
};

function isTypeDef(value: unknown): value is TypeDef {
  return value instanceof TypeDef ||
    (
      value != null &&
      typeof value === "object" &&
      Array.isArray((value as { members?: unknown }).members) &&
      typeof (value as { getPropertyByIndex?: unknown }).getPropertyByIndex === "function"
    );
}

function normalizeArguments(args: unknown): unknown {
  return args == null ? [] : args;
}
