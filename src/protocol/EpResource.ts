import { EventHandler } from "../core/EventHandler.js";
import { AsyncReply } from "../core/AsyncReply.js";
import type { DestroyedEvent } from "../core/IDestructible.js";
import { TypeDef } from "../resource/template.js";
import type { Instance } from "../resource/Instance.js";
import type { IResource, IResourceContext } from "../resource/IResource.js";
import type { IDynamicResource } from "../resource/IDynamicResource.js";
import { ResourceOperation } from "../resource/ResourceOperation.js";
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
 *
 * Implements {@link IResource}/{@link IDynamicResource} so it can be
 * `warehouse.put()` into this node's own warehouse — every proxy is itself a
 * resource with a life cycle, and once put, a third node connecting to this
 * one can attach to it too, relaying reads/writes/invokes/events through to
 * the original connection transparently.
 */
export class EpResource implements IResource, IDynamicResource {
  /** Assigned by the {@link Warehouse} on `put()` — absent until relayed. */
  instance?: Instance;

  private readonly destroyHandlers: DestroyedEvent[] = [];

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

  /** `.on(":name", cb)` listeners, keyed by property index. */
  private readonly propertyListeners = new Map<number, Set<(value: unknown) => void>>();
  /** `.on("name", cb)` listeners, keyed by event index. */
  private readonly eventListeners = new Map<number, Set<(value: unknown) => void>>();
  /** Events we believe the server currently has us subscribed to — checked
   * before sending a Subscribe/Unsubscribe request, since the server errors
   * (`AlreadyListened`/`AlreadyUnsubscribed`) on a redundant one. */
  private readonly subscribedEvents = new Set<number>();
  /** Event indices with a subscription-reconciliation loop currently running. */
  private readonly reconciling = new Set<number>();

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
      const options =
        typeof optionsOrLink === "string" ? { link: optionsOrLink } : optionsOrLink;
      this.setRemoteIdentity(options);
    } else {
      this.age = typeDefOrAge ?? 0;
      this.link =
        typeof optionsOrLink === "string" ? optionsOrLink : (optionsOrLink.link ?? "");
      if (typeof optionsOrLink !== "string") this.setRemoteIdentity(optionsOrLink);
    }

    this.propertyModified.add((change) => {
      for (const cb of this.propertyListeners.get(change.index) ?? []) cb(change.value);
    });
    this.eventOccurred.add((change) => {
      for (const cb of this.eventListeners.get(change.index) ?? []) cb(change.value);
    });
  }

  /**
   * Listen for a property change (`.on(":propName", cb)`) or an exported
   * event (`.on("eventName", cb)`). For events where the TypeDef marks
   * `subscribable` (i.e. not `autoDelivered`), the first listener triggers a
   * `Subscribe` request and the last {@link off} triggers `Unsubscribe` —
   * ref-counted by listener count, so redundant wire requests aren't sent
   * for a second/third listener on the same already-subscribed event.
   */
  on(name: string, callback: (value: unknown) => void): this {
    if (name.startsWith(":")) {
      const propertyName = name.slice(1);
      const property = this.typeDef.getPropertyByName(propertyName);
      if (!property) throw new Error(`Unknown property "${propertyName}".`);
      getOrCreate(this.propertyListeners, property.index).add(callback);
      return this;
    }
    const event = this.typeDef.getEventByName(name);
    if (!event) throw new Error(`Unknown event "${name}".`);
    getOrCreate(this.eventListeners, event.index).add(callback);
    if (event.subscribable) this.reconcileSubscription(event.index);
    return this;
  }

  /** Remove a listener registered with {@link on}. */
  off(name: string, callback: (value: unknown) => void): this {
    if (name.startsWith(":")) {
      const property = this.typeDef.getPropertyByName(name.slice(1));
      if (property) this.propertyListeners.get(property.index)?.delete(callback);
      return this;
    }
    const event = this.typeDef.getEventByName(name);
    if (!event) return this;
    this.eventListeners.get(event.index)?.delete(callback);
    if (event.subscribable) this.reconcileSubscription(event.index);
    return this;
  }

  /**
   * Settle the wire subscription state for event `index` toward whatever the
   * current listener count implies, retrying against the *current* desired
   * state on each step — so a burst of `on()`/`off()` calls while a request
   * is in flight is coalesced into whatever the state actually is once the
   * in-flight request settles, rather than replaying every transition.
   */
  private reconcileSubscription(index: number): void {
    if (this.reconciling.has(index)) return;
    this.reconciling.add(index);
    (async () => {
      for (;;) {
        const desired = (this.eventListeners.get(index)?.size ?? 0) > 0;
        const actual = this.subscribedEvents.has(index);
        if (desired === actual) return;
        try {
          if (desired) {
            await this.connection.subscribe(this.instanceId, index);
            this.subscribedEvents.add(index);
          } else {
            await this.connection.unsubscribe(this.instanceId, index);
            this.subscribedEvents.delete(index);
          }
        } catch {
          // Leave `subscribedEvents` as-is; the next on()/off() call that
          // changes the listener count re-triggers reconciliation, so a
          // transient failure here just needs another transition to retry.
          return;
        }
      }
    })().finally(() => this.reconciling.delete(index));
  }

  /**
   * @internal After a reattach on a fresh connection (post-reconnect), our
   * belief about server-side subscription state is stale — a brand-new
   * connection starts with no subscriptions of its own, even for events we
   * were subscribed to before the disconnect. Clear that belief and re-run
   * reconciliation for every event that still has active listeners (from
   * `.on()` or, on the .NET side's equivalent, `+=`), so subscriptions
   * survive a reconnect transparently.
   */
  resubscribeAfterReconnect(): void {
    this.subscribedEvents.clear();
    this.reconciling.clear();
    for (const index of this.eventListeners.keys()) {
      if ((this.eventListeners.get(index)?.size ?? 0) === 0) continue;
      const event = this.typeDef.getEventByIndex(index);
      if (event?.subscribable) this.reconcileSubscription(index);
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
    // Mirror into `instance` (silently — no propertyModified emit) when this
    // proxy has been relayed into a warehouse: this is a merge/seed, not a
    // live change, matching how attach/reattach never fire a notification.
    if (this.instance) {
      this.instance.setAge(index, age);
      this.instance.setModificationDate(index, date);
    }
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
    if (pt) {
      this.propertyModified.emit({ name: pt.name, index, value, age, date });
      // Relay: if this proxy has been put() into a warehouse, forward the
      // change through its Instance so a third node attached to it (via
      // subscribeToInstance) gets notified too. Live PropertyModified
      // notifications don't carry the origin's age/date on the wire, so
      // this self-increments the Instance's own age like any local write
      // would (matching how a relayed EmitModification loses origin-age
      // fidelity in dotnet too).
      this.instance?.modified(pt.name, value);
    }
  }

  /** @internal Apply an event occurrence pushed by the server. */
  applyEvent(index: number, value: unknown): void {
    const et = this.typeDef.getEventByIndex(index);
    if (et) {
      this.eventOccurred.emit({ name: et.name, index, value });
      this.instance?.emitEventByIndex(index, value);
    }
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

  // ---- IResource / IDestructible -----------------------------------------

  handle(_operation: ResourceOperation, _context?: IResourceContext): AsyncReply<boolean> {
    return AsyncReply.fromResult(true);
  }

  addDestroyHandler(handler: DestroyedEvent): void {
    this.destroyHandlers.push(handler);
  }

  removeDestroyHandler(handler: DestroyedEvent): void {
    const i = this.destroyHandlers.indexOf(handler);
    if (i >= 0) this.destroyHandlers.splice(i, 1);
  }

  destroy(): void {
    for (const h of this.destroyHandlers.slice()) h(this);
  }

  // ---- IDynamicResource ---------------------------------------------------

  get resourceDefinition(): TypeDef {
    return this.typeDef;
  }

  getResourceProperty<T = unknown>(index: number): T {
    return this.cache.get(index) as T;
  }

  /** Forward a write to the upstream connection this proxy is relaying — the same path the ergonomic proxy's `set` trap uses. */
  setResourceProperty(index: number, value: unknown): AsyncReply<void> {
    return this.SetResourceProperty(index, value);
  }

  getResourcePropertyAge(index: number): number {
    return this.getAge(index);
  }

  getResourcePropertyDate(index: number): Date | undefined {
    return this.getModificationDate(index);
  }

  /** Invoke a remote function by index — the same path the ergonomic proxy's function-call trap uses. */
  invoke(index: number, args: unknown[]): AsyncReply {
    return this.connection.invoke(this.instanceId, index, ...args);
  }
}

function getOrCreate<K>(map: Map<K, Set<(value: unknown) => void>>, key: K): Set<(value: unknown) => void> {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

const proxyHandler: ProxyHandler<EpResource> = {
  get(target, prop, receiver) {
    if (typeof prop === "string" && !(prop in target)) {
      const fn = target.typeDef.getFunctionByName(prop);
      if (fn) {
        return (...args: unknown[]): AsyncReply => target.invoke(fn.index, args);
      }
      const pt = target.typeDef.getPropertyByName(prop);
      if (pt) return target.getResourceProperty(pt.index);
    }
    return Reflect.get(target, prop, receiver);
  },

  set(target, prop, value, receiver) {
    if (typeof prop === "string") {
      const pt = target.typeDef.getPropertyByName(prop);
      if (pt) {
        target.setResourceProperty(pt.index, value);
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
