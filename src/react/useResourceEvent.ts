import { useEffect } from "react";
import { subscribeToResourceEvent } from "../resource/reactive.js";

/**
 * Run `handler` whenever a named exported event occurs on a local or remote
 * resource — e.g. a server-pushed toast/log line rather than a stored
 * property. Unlike {@link useProperty}/{@link useResource} this doesn't
 * cause a re-render by itself; call `setState` (or similar) inside
 * `handler` if the event should update the UI.
 *
 * @example
 * ```tsx
 * function Log({ device }: { device: unknown }) {
 *   const [lines, setLines] = useState<string[]>([]);
 *   useResourceEvent<string>(device, "message", (line) =>
 *     setLines((prev) => [...prev, line]),
 *   );
 *   return <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>;
 * }
 * ```
 */
export function useResourceEvent<T = unknown>(
  resource: unknown,
  eventName: string,
  handler: (value: T) => void,
): void {
  useEffect(
    () => subscribeToResourceEvent(resource, eventName, handler as (value: unknown) => void),
    [resource, eventName, handler],
  );
}
