import { useCallback, useSyncExternalStore } from "react";
import { readProperty, subscribeToProperty } from "../resource/reactive.js";

/**
 * Subscribe to one exported property on a local or remote resource. The
 * component re-renders whenever the property changes — locally via
 * `Instance.propertyModified`, or remotely via a `PropertyModified`
 * notification pushed by the peer and applied to the `EpResource` proxy.
 *
 * `resource` may be `undefined` (e.g. while a remote attach is still in
 * flight); the hook simply returns `undefined` until it's supplied.
 *
 * @example
 * ```tsx
 * function StatusBadge({ device }: { device: unknown }) {
 *   const status = useProperty<string>(device, "status");
 *   return <span>{status ?? "…"}</span>;
 * }
 * ```
 */
export function useProperty<T = unknown>(resource: unknown, propertyName: string): T | undefined {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToProperty(resource, propertyName, onStoreChange),
    [resource, propertyName],
  );
  const getSnapshot = useCallback(
    () => readProperty<T>(resource, propertyName),
    [resource, propertyName],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
