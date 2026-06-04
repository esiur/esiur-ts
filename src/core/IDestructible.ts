/** Callback fired when an {@link IDestructible} is destroyed. */
export type DestroyedEvent = (sender: unknown) => void;

/**
 * An object whose lifetime is explicitly managed; raises {@link DestroyedEvent}
 * when it is torn down (port of C# `IDestructible`).
 */
export interface IDestructible {
  /** Register/unregister a handler invoked when this object is destroyed. */
  addDestroyHandler(handler: DestroyedEvent): void;
  removeDestroyHandler(handler: DestroyedEvent): void;
  /** Tear down the object and notify destroy handlers. */
  destroy(): void;
}
