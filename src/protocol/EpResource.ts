import { EventHandler } from "../core/EventHandler.js";
import type { AsyncReply } from "../core/AsyncReply.js";
import type { TypeTemplate } from "../resource/template.js";
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

/**
 * A remote resource proxy (port of C# `EpResource`). Wraps a connection +
 * instance id + type template; exported functions invoke remotely, exported
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

  constructor(
    readonly connection: EpConnection,
    public instanceId: number,
    readonly template: TypeTemplate,
    options: EpResourceOptions = {},
  ) {
    this.typeDefId = options.typeDefId;
    this.age = options.age ?? 0;
    this.link = options.link ?? "";
    this.hops = options.hops ?? 0;
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
    this.cache.set(index, value);
    if (age != null) {
      this.propertyAges.set(index, age);
      if (age > this.age) this.age = age;
    }
    if (date != null) this.propertyModificationDates.set(index, date);
    const pt = this.template.getPropertyByIndex(index);
    if (pt) this.propertyModified.emit({ name: pt.name, index, value, age, date });
  }

  /** @internal Apply an event occurrence pushed by the server. */
  applyEvent(index: number, value: unknown): void {
    const et = this.template.getEventByIndex(index);
    if (et) this.eventOccurred.emit({ name: et.name, index, value });
  }

  /** Wrap an {@link EpResource} in an ergonomic dynamic proxy. */
  static createProxy(resource: EpResource): EpResource & Record<string, unknown> {
    return new Proxy(resource, proxyHandler) as EpResource & Record<string, unknown>;
  }
}

const proxyHandler: ProxyHandler<EpResource> = {
  get(target, prop, receiver) {
    if (typeof prop === "string" && !(prop in target)) {
      const fn = target.template.getFunctionByName(prop);
      if (fn) {
        return (...args: unknown[]): AsyncReply =>
          target.connection.invoke(target.instanceId, fn.index, ...args);
      }
      const pt = target.template.getPropertyByName(prop);
      if (pt) return target.cache.get(pt.index);
    }
    return Reflect.get(target, prop, receiver);
  },

  set(target, prop, value, receiver) {
    if (typeof prop === "string") {
      const pt = target.template.getPropertyByName(prop);
      if (pt) {
        target.connection.set(target.instanceId, pt.index, value);
        target.cache.set(pt.index, value);
        return true;
      }
    }
    return Reflect.set(target, prop, value, receiver);
  },
};
