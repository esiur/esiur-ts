import "../internal/metadata.js";
import type { Tru } from "../data/Tru.js";
import {
  ArgumentTemplate,
  EventTemplate,
  FunctionTemplate,
  MemberType,
  PropertyTemplate,
  TypeTemplate,
  type MemberTemplate,
} from "./template.js";

const MEMBERS = Symbol.for("esiur.members");
const TEMPLATE = Symbol.for("esiur.template");

interface PendingMember {
  kind: MemberType;
  name: string;
  type?: Tru;
  args?: Tru[];
}

type MetaBag = Record<symbol, unknown>;

/**
 * Marks a class member as exported over Esiur (port of C#'s `[Export]`).
 *
 * - On an `accessor` property → a notifying property; the setter reports changes
 *   to the resource's {@link Instance}. Pass the wire type, e.g. `@Export(t.i32)`.
 * - On a `method` → an exported function. Pass return type and argument types,
 *   e.g. `@Export(t.string, [t.string])`.
 * - On a `field` initialized with {@link event} → an exported event. Pass the
 *   event argument type, e.g. `@Export(t.string)`.
 */
export function Export(type?: Tru, args?: Tru[]) {
  // Returns `any`: one decorator serves accessor/method/field positions, each of
  // which expects a different result type.
  return function (value: unknown, context: ClassMemberDecoratorContext): any {
    const meta = context.metadata as MetaBag;
    const members = (meta[MEMBERS] ??= []) as PendingMember[];
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
        members.push({ kind: MemberType.Function, name, type, args });
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

/** Build (and cache) the {@link TypeTemplate} for a resource class from its decorator metadata. */
export function getTemplate(ctor: Function): TypeTemplate {
  const meta = (ctor as { [Symbol.metadata]?: MetaBag })[Symbol.metadata];
  if (!meta) return new TypeTemplate(ctor.name, []);

  const cached = meta[TEMPLATE] as TypeTemplate | undefined;
  if (cached && cached.className === ctor.name) return cached;

  const pending = (meta[MEMBERS] as PendingMember[] | undefined) ?? [];
  let propertyIndex = 0;
  let functionIndex = 0;
  let eventIndex = 0;

  const members: MemberTemplate[] = pending.map((m) => {
    if (m.kind === MemberType.Property)
      return new PropertyTemplate(m.name, propertyIndex++, m.type);
    if (m.kind === MemberType.Function)
      return new FunctionTemplate(
        m.name,
        functionIndex++,
        m.type,
        (m.args ?? []).map((a, i) => new ArgumentTemplate(`arg${i}`, a)),
      );
    return new EventTemplate(m.name, eventIndex++, m.type);
  });

  const template = new TypeTemplate(ctor.name, members);
  meta[TEMPLATE] = template;
  return template;
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
