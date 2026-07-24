import { useRef, useSyncExternalStore } from "react";
import { snapshotProperties, subscribeToResource } from "../resource/reactive.js";

/**
 * A cached, reference-stable snapshot of a resource's exported properties,
 * rebuilt only when a change notification actually fires — required for
 * `useSyncExternalStore`, whose `getSnapshot` must return the same
 * reference between renders unless the store actually changed, or React
 * will treat every render as a change and loop.
 */
class ResourceSnapshotStore<T extends Record<string, unknown>> {
  private value: T;

  constructor(private readonly resource: unknown) {
    this.value = snapshotProperties<T>(resource);
  }

  subscribe = (onStoreChange: () => void): (() => void) => {
    return subscribeToResource(this.resource, () => {
      this.value = snapshotProperties<T>(this.resource);
      onStoreChange();
    });
  };

  getSnapshot = (): T => this.value;
}

/**
 * Subscribe to *every* exported property on a local or remote resource at
 * once, re-rendering on any change and returning a plain snapshot object
 * (`{ [propertyName]: value }`) — handy for spreading/destructuring several
 * properties without a `useProperty` call each.
 *
 * @example
 * ```tsx
 * function DeviceCard({ device }: { device: unknown }) {
 *   const { status, level } = useResource<{ status: string; level: number }>(device);
 *   return <div>{status} — {level}%</div>;
 * }
 * ```
 */
export function useResource<T extends Record<string, unknown> = Record<string, unknown>>(
  resource: unknown,
): T {
  const ref = useRef<{ resource: unknown; store: ResourceSnapshotStore<T> } | null>(null);
  if (!ref.current || ref.current.resource !== resource)
    ref.current = { resource, store: new ResourceSnapshotStore<T>(resource) };

  const { store } = ref.current;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
