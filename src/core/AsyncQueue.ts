import { AsyncReply } from "./AsyncReply.js";

/**
 * Ordered, streaming delivery of {@link AsyncReply}s (port of C# `AsyncQueue<T>`).
 *
 * Replies are delivered to handlers registered via {@link AsyncReply.onReady} in
 * the exact order they were added, even if they become ready out of order — a
 * later reply waits for all earlier ones. Used for in-order event/notification
 * dispatch in the protocol layer.
 */
export class AsyncQueue<T = any> extends AsyncReply<T> {
  private currentId = 0;
  private items: Array<{ reply: AsyncReply<T>; sequence: number }> = [];

  /** Enqueue a reply; it is delivered once it and all earlier ones are ready. */
  add(reply: AsyncReply<T>): void {
    this.currentId++;
    this.items.push({ reply, sequence: this.currentId });
    this._ready = false;

    if (reply.ready) this.processQueue();
    else reply.onReady(() => this.processQueue());
  }

  /** Drop a reply from the queue. */
  remove(reply: AsyncReply<T>): void {
    const idx = this.items.findIndex((i) => i.reply === reply);
    if (idx >= 0) this.items.splice(idx, 1);
    this.processQueue();
  }

  private processQueue(): void {
    while (this.items.length > 0 && this.items[0].reply.ready) {
      const item = this.items.shift()!;
      this.deliver(item.reply.result as T);
    }
    this._ready = this.items.length === 0;
  }

  /** Fire result handlers for a single item without latching the ready state. */
  private deliver(value: T): void {
    this._result = value;
    for (const cb of this._callbacks.slice()) cb(value);
  }
}
