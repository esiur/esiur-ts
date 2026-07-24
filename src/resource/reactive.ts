/**
 * Framework-agnostic adapter over the property/event-change notifications
 * already fired by {@link Instance} (local resources) and {@link EpResource}
 * (remote resource proxies from `EpConnection.attach()`/`.get()`). Depends
 * on neither — it duck-types over whatever `EventHandler`-shaped
 * `propertyModified`/`eventOccurred` it finds, so it works for both without
 * importing either class (avoiding a dependency on the protocol layer from
 * here, and keeping this file usable as the basis for *any* UI binding, not
 * just the `esiur/react` one built on top of it).
 */

interface EventHandlerLike {
  add(handler: (value: unknown) => void): unknown;
  remove(handler: (value: unknown) => void): unknown;
}

function isEventHandlerLike(value: unknown): value is EventHandlerLike {
  const v = value as EventHandlerLike | undefined;
  return !!v && typeof v.add === "function" && typeof v.remove === "function";
}

/** A normalized property-change notification, regardless of source shape. */
export interface PropertyChangeEvent {
  name: string;
  value: unknown;
}

function normalizePropertyChange(raw: unknown): PropertyChangeEvent | undefined {
  // `EpResource.propertyModified` fires `{ name, index, value, age?, date? }`;
  // `Instance.propertyModified` fires `{ resource, property: { name }, value, age }`.
  const r = raw as { name?: unknown; property?: { name?: unknown }; value?: unknown } | undefined;
  const name = typeof r?.name === "string" ? r.name : r?.property?.name;
  return typeof name === "string" ? { name, value: r?.value } : undefined;
}

function findPropertyModifiedHandler(resource: unknown): EventHandlerLike | undefined {
  const r = resource as Record<string, unknown> | undefined;
  if (!r) return undefined;
  // Remote proxy (or a raw EpResource): `propertyModified` is a real own
  // property on the underlying instance, so `Proxy`'s `get` trap in
  // `EpResource.createProxy` passes it through unchanged.
  if (isEventHandlerLike(r.propertyModified)) return r.propertyModified as EventHandlerLike;
  // Local resource: the notifier lives on `.instance`, not the resource itself.
  const instance = r.instance as Record<string, unknown> | undefined;
  if (instance && isEventHandlerLike(instance.propertyModified))
    return instance.propertyModified as EventHandlerLike;
  return undefined;
}

/**
 * Subscribe to every property change on `resource` (local or remote).
 * Returns an unsubscribe function; a no-op if `resource` exposes no
 * recognizable change notifier.
 */
export function subscribeToResource(
  resource: unknown,
  onChange: (event: PropertyChangeEvent) => void,
): () => void {
  const handler = findPropertyModifiedHandler(resource);
  if (!handler) return () => {};

  const wrapped = (raw: unknown): void => {
    const event = normalizePropertyChange(raw);
    if (event) onChange(event);
  };
  handler.add(wrapped);
  return () => handler.remove(wrapped);
}

/** Subscribe to a single named property's changes. */
export function subscribeToProperty(
  resource: unknown,
  propertyName: string,
  onChange: (value: unknown) => void,
): () => void {
  return subscribeToResource(resource, (event) => {
    if (event.name === propertyName) onChange(event.value);
  });
}

/** Read a property's current value directly off a resource/proxy. */
export function readProperty<T = unknown>(resource: unknown, propertyName: string): T | undefined {
  if (resource == null) return undefined;
  return (resource as Record<string, unknown>)[propertyName] as T | undefined;
}

interface PropertyLike {
  name: string;
}
interface TypeDefLike {
  properties: readonly PropertyLike[];
}

function isTypeDefLike(value: unknown): value is TypeDefLike {
  return !!value && Array.isArray((value as TypeDefLike).properties);
}

function findTypeDef(resource: unknown): TypeDefLike | undefined {
  const r = resource as Record<string, unknown> | undefined;
  if (!r) return undefined;
  // Remote proxy: `typeDef` is a real own property (same pass-through as above).
  if (isTypeDefLike(r.typeDef)) return r.typeDef as TypeDefLike;
  // Local resource: the TypeDef lives on `.instance.definition`.
  const instance = r.instance as Record<string, unknown> | undefined;
  if (instance && isTypeDefLike(instance.definition)) return instance.definition as TypeDefLike;
  return undefined;
}

/** Build a plain snapshot object of every exported property's current value. */
export function snapshotProperties<T extends Record<string, unknown> = Record<string, unknown>>(
  resource: unknown,
): T {
  const typeDef = findTypeDef(resource);
  const out: Record<string, unknown> = {};
  if (typeDef) for (const p of typeDef.properties) out[p.name] = readProperty(resource, p.name);
  return out as T;
}

function findEventOccurredHandler(resource: unknown): EventHandlerLike | undefined {
  const r = resource as Record<string, unknown> | undefined;
  return r && isEventHandlerLike(r.eventOccurred) ? (r.eventOccurred as EventHandlerLike) : undefined;
}

interface ListenerLike {
  listen(handler: (value: unknown) => void): unknown;
  unlisten(handler: (value: unknown) => void): unknown;
}

function isListenerLike(value: unknown): value is ListenerLike {
  const v = value as ListenerLike | undefined;
  return !!v && typeof v.listen === "function" && typeof v.unlisten === "function";
}

/**
 * Subscribe to one named exported event, local or remote. Remote proxies
 * fire everything through the single `eventOccurred` notifier (filtered
 * here by name); local resources expose each event as its own
 * {@link EventSource} field with `listen`/`unlisten`.
 */
export function subscribeToResourceEvent(
  resource: unknown,
  eventName: string,
  onEvent: (value: unknown) => void,
): () => void {
  const remoteHandler = findEventOccurredHandler(resource);
  if (remoteHandler) {
    const wrapped = (raw: unknown): void => {
      const event = normalizePropertyChange(raw);
      if (event && event.name === eventName) onEvent(event.value);
    };
    remoteHandler.add(wrapped);
    return () => remoteHandler.remove(wrapped);
  }

  const source = (resource as Record<string, unknown> | undefined)?.[eventName];
  if (isListenerLike(source)) {
    const wrapped = (value: unknown): void => onEvent(value);
    source.listen(wrapped);
    return () => source.unlisten(wrapped);
  }

  return () => {};
}
