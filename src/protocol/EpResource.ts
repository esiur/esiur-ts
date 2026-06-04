import { EventHandler } from "../core/EventHandler.js";
import type { AsyncReply } from "../core/AsyncReply.js";
import type { TypeTemplate } from "../resource/template.js";
import type { EpConnection } from "./EpConnection.js";

/** Notification payload for a remote property change. */
export interface RemotePropertyChange {
  name: string;
  index: number;
  value: unknown;
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
  /** Property index → last known value. */
  readonly cache = new Map<number, unknown>();
  /** Fires when a property is updated by a notification. */
  readonly propertyModified = new EventHandler<RemotePropertyChange>();
  /** Fires when a remote event occurs. */
  readonly eventOccurred = new EventHandler<RemotePropertyChange>();

  constructor(
    readonly connection: EpConnection,
    readonly instanceId: number,
    readonly template: TypeTemplate,
  ) {}

  /** @internal Apply a property value pushed by the server. */
  updateProperty(index: number, value: unknown): void {
    this.cache.set(index, value);
    const pt = this.template.getPropertyByIndex(index);
    if (pt) this.propertyModified.emit({ name: pt.name, index, value });
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
