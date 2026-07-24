import "../internal/metadata.js";
import type { Tru } from "../data/Tru.js";
import { StreamMode } from "../data/types/StreamMode.js";
import type { IPermissionsManager } from "../security/permissions/IPermissionsManager.js";
import type { IRateControlManager } from "../security/management/IRateControlManager.js";
import type { IAuditingManager } from "../security/management/IAuditingManager.js";
import {
  ArgumentTemplate,
  EventTemplate,
  FunctionTemplate,
  MemberType,
  PropertyTemplate,
  TypeDef,
  type MemberTemplate,
} from "./template.js";

const MEMBERS = Symbol.for("esiur.members");
const TEMPLATE = Symbol.for("esiur.template");
const RATE_CONTROL_POLICIES = Symbol.for("esiur.ratePolicies");
const RESOURCE_MANAGER_TYPES = Symbol.for("esiur.resourceManagerTypes");
const AUTO_DELIVERED_EVENTS = Symbol.for("esiur.autoDeliveredEvents");

interface PendingMember {
  kind: MemberType;
  name: string;
  type?: Tru;
  args?: Tru[];
  isStatic?: boolean;
  streamMode?: StreamMode;
  pausable?: boolean;
}

/** Function-only options for {@link Export} — a streaming call's mode and whether it can be halted/resumed mid-flight. */
export interface ExportFunctionOptions {
  streamMode?: StreamMode;
  pausable?: boolean;
}

type MetaBag = Record<symbol, unknown>;

/**
 * Get (creating if absent) `meta`'s OWN array/map at `key`, seeded with a
 * copy of whatever was inherited. `meta[key] ??= ...` alone isn't enough: the
 * TC39 decorator-metadata proposal chains a subclass's `[Symbol.metadata]`
 * off its base class's via the prototype, so a plain `??=` would read the
 * *inherited* collection through that chain and mutate it in place —
 * silently leaking a subclass's own decorated members/associations into
 * (and across siblings of) its base class.
 */
function ownArray<T>(meta: MetaBag, key: symbol): T[] {
  if (!Object.hasOwn(meta, key)) meta[key] = [...((meta[key] as T[] | undefined) ?? [])];
  return meta[key] as T[];
}

function ownMap<K, V>(meta: MetaBag, key: symbol): Map<K, V> {
  if (!Object.hasOwn(meta, key)) meta[key] = new Map(meta[key] as Map<K, V> | undefined);
  return meta[key] as Map<K, V>;
}

/**
 * Marks a class member as exported over Esiur (port of C#'s `[Export]`).
 *
 * - On an `accessor` property → a notifying property; the setter reports changes
 *   to the resource's {@link Instance}. Pass the wire type, e.g. `@Export(t.i32)`.
 * - On a `method` → an exported function. Pass return type and argument types,
 *   e.g. `@Export(t.string, [t.string])`. Pass {@link ExportFunctionOptions} as a
 *   4th argument to mark it streaming, e.g. `@Export(t.i32, [], { streamMode: StreamMode.Pull })`
 *   — the method should then return an `AsyncIterable`/`Iterable` rather than a plain value.
 * - On a `field` initialized with {@link event} → an exported event. Pass the
 *   event argument type, e.g. `@Export(t.string)`.
 */
export function Export(type?: Tru, args?: Tru[], functionOptions?: ExportFunctionOptions) {
  // Returns `any`: one decorator serves accessor/method/field positions, each of
  // which expects a different result type.
  return function (value: unknown, context: ClassMemberDecoratorContext): any {
    const meta = context.metadata as MetaBag;
    const members = ownArray<PendingMember>(meta, MEMBERS);
    const name = String(context.name);

    switch (context.kind) {
      case "accessor": {
        members.push({ kind: MemberType.Property, name, type });
        const target = value as ClassAccessorDecoratorTarget<unknown, unknown>;
        return {
          get(this: { instance?: { modified(n: string, v: unknown): void } }) {
            return target.get.call(this);
          },
          set(
            this: { instance?: { modified(n: string, v: unknown): void } },
            v: unknown,
          ) {
            target.set.call(this, v);
            this.instance?.modified(name, v);
          },
        } satisfies ClassAccessorDecoratorResult<unknown, unknown>;
      }
      case "method":
        // `context.static` is auto-detected from the `static` keyword — no
        // separate decorator option needed, mirroring how dotnet derives
        // `FunctionDef.IsStatic` from reflection rather than an attribute flag.
        members.push({
          kind: MemberType.Function,
          name,
          type,
          args,
          isStatic: context.static,
          streamMode: functionOptions?.streamMode,
          pausable: functionOptions?.pausable,
        });
        return value;
      case "field":
        // Expected to hold an EventSource (an exported event).
        members.push({ kind: MemberType.Event, name, type });
        return value;
      default:
        throw new Error(`@Export cannot be applied to a ${context.kind} ('${name}').`);
    }
  };
}

/**
 * Applies a named Warehouse rate policy to an exported function or property
 * setter (port of C#'s `[RateControl(policyName)]`). The name is resolved
 * against `Warehouse.tryGetRatePolicy` by {@link NamedRateControlManager}
 * when the member is invoked/set.
 */
export function RateControl(policyName: string) {
  if (!policyName?.trim()) throw new Error("A rate policy name is required.");
  return function (_value: unknown, context: ClassMemberDecoratorContext): void {
    if (context.kind !== "accessor" && context.kind !== "method")
      throw new Error(
        `@RateControl cannot be applied to a ${context.kind} ('${String(context.name)}').`,
      );
    const meta = context.metadata as MetaBag;
    ownMap<string, string>(meta, RATE_CONTROL_POLICIES).set(String(context.name), policyName);
  };
}

/**
 * Marks an exported event as delivered to every attached connection
 * unconditionally, with no explicit `Subscribe` request needed (port of
 * C#'s `[AutoDelivery]`/`EventDefFlags.AutoDelivered`). Without this, an
 * exported event requires an explicit Subscribe before it starts flowing
 * (`EventDef.Subscribable` is true by default in dotnet) — reach for
 * `@AutoDelivered()` for low-frequency events every listener wants anyway;
 * leave it off for high-frequency/expensive-to-compute events clients
 * should opt into explicitly.
 */
export function AutoDelivered() {
  return function (_value: unknown, context: ClassMemberDecoratorContext): void {
    if (context.kind !== "field")
      throw new Error(
        `@AutoDelivered cannot be applied to a ${context.kind} ('${String(context.name)}').`,
      );
    const meta = context.metadata as MetaBag;
    const names = ownArray<string>(meta, AUTO_DELIVERED_EVENTS);
    names.push(String(context.name));
  };
}

/**
 * Associates a registered manager implementation with a resource type (port
 * of C#'s `[PermissionsManager<T>]`/`[RateControlManager<T>]`/
 * `[AuditingManager<T>]`). The manager type itself must be registered with
 * the Warehouse via `registerManager` before the resource is created — this
 * decorator only records the association, mirroring dotnet's own
 * "attributes never create instances directly" design.
 */
function ResourceManager(managerCtor: Function) {
  return function (_value: Function, context: ClassDecoratorContext): void {
    const meta = context.metadata as MetaBag;
    const types = ownArray<Function>(meta, RESOURCE_MANAGER_TYPES);
    if (!types.includes(managerCtor)) types.push(managerCtor);
  };
}

/** Associates a registered {@link IPermissionsManager} implementation with a resource class. */
export function PermissionsManager(managerCtor: new (...args: never[]) => IPermissionsManager) {
  return ResourceManager(managerCtor);
}

/** Associates a registered {@link IRateControlManager} implementation with a resource class. */
export function RateControlManager(managerCtor: new (...args: never[]) => IRateControlManager) {
  return ResourceManager(managerCtor);
}

/** Associates a registered {@link IAuditingManager} implementation with a resource class. */
export function AuditingManager(managerCtor: new (...args: never[]) => IAuditingManager) {
  return ResourceManager(managerCtor);
}

/** Read the manager constructor types declared (including inherited) on `ctor`. */
export function getResourceManagerTypes(ctor: Function): Function[] {
  const meta = (ctor as { [Symbol.metadata]?: MetaBag })[Symbol.metadata];
  if (!meta) return [];
  return (meta[RESOURCE_MANAGER_TYPES] as Function[] | undefined) ?? [];
}

/** Build (and cache) the decorated {@link TypeDef} surface for a resource class. */
export function getTypeDef(ctor: Function): TypeDef {
  const meta = (ctor as { [Symbol.metadata]?: MetaBag })[Symbol.metadata];
  if (!meta) return new TypeDef(ctor.name, []);

  const cached = meta[TEMPLATE] as TypeDef | undefined;
  if (cached && cached.className === ctor.name) return cached;

  const pending = (meta[MEMBERS] as PendingMember[] | undefined) ?? [];
  const ratePolicies = meta[RATE_CONTROL_POLICIES] as Map<string, string> | undefined;
  const autoDeliveredEvents = new Set((meta[AUTO_DELIVERED_EVENTS] as string[] | undefined) ?? []);
  let propertyIndex = 0;
  let functionIndex = 0;
  let eventIndex = 0;

  const members: MemberTemplate[] = pending.map((m) => {
    if (m.kind === MemberType.Property) {
      const t = new PropertyTemplate(m.name, propertyIndex++, m.type);
      t.ratePolicyName = ratePolicies?.get(m.name);
      return t;
    }
    if (m.kind === MemberType.Function) {
      const t = new FunctionTemplate(
        m.name,
        functionIndex++,
        m.type,
        (m.args ?? []).map((a, i) => new ArgumentTemplate(`arg${i}`, a)),
        m.isStatic ?? false,
        undefined,
        m.streamMode ?? StreamMode.None,
        m.pausable ?? false,
      );
      t.ratePolicyName = ratePolicies?.get(m.name);
      return t;
    }
    return new EventTemplate(
      m.name,
      eventIndex++,
      m.type,
      undefined,
      !autoDeliveredEvents.has(m.name),
    );
  });

  const template = new TypeDef(ctor.name, members);
  meta[TEMPLATE] = template;
  return template;
}

/** @deprecated Use {@link getTypeDef}. */
export function getTemplate(ctor: Function): TypeDef {
  return getTypeDef(ctor);
}

/**
 * A raised-event channel held by a resource (the TypeScript analogue of C#'s
 * `ResourceEventHandler<T>` delegate field). The resource raises it with
 * {@link emit}; the {@link Instance} attaches a {@link sink} to forward
 * occurrences across the network.
 */
export class EventSource<T = unknown> {
  private readonly listeners: Array<(arg: T) => void> = [];
  /** @internal Forwarder installed by the owning Instance. */
  sink?: (value: T) => void;

  /** Subscribe a local listener. */
  listen(handler: (arg: T) => void): this {
    this.listeners.push(handler);
    return this;
  }

  /** Unsubscribe a local listener. */
  unlisten(handler: (arg: T) => void): void {
    const i = this.listeners.indexOf(handler);
    if (i >= 0) this.listeners.splice(i, 1);
  }

  /** Raise the event: notify local listeners and the network sink. */
  emit(value: T): void {
    for (const l of this.listeners.slice()) l(value);
    this.sink?.(value);
  }
}

/** Create an {@link EventSource} for an exported event field. */
export function event<T = unknown>(): EventSource<T> {
  return new EventSource<T>();
}
