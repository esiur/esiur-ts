/**
 * A minimal multicast event (the TypeScript stand-in for a C# `event`).
 * Handlers are invoked synchronously in registration order.
 */
export class EventHandler<T = void> {
  private readonly handlers: Array<(arg: T) => void> = [];

  /** Subscribe; returns this for chaining. */
  add(handler: (arg: T) => void): this {
    this.handlers.push(handler);
    return this;
  }

  /** Unsubscribe a previously-added handler. */
  remove(handler: (arg: T) => void): void {
    const i = this.handlers.indexOf(handler);
    if (i >= 0) this.handlers.splice(i, 1);
  }

  /** Invoke all handlers with `arg`. */
  emit(arg: T): void {
    for (const h of this.handlers.slice()) h(arg);
  }

  /** Number of subscribed handlers. */
  get count(): number {
    return this.handlers.length;
  }
}
