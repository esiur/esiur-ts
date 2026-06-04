import { AsyncReply } from "./AsyncReply.js";

/**
 * Collects a set of values and/or {@link AsyncReply}s and resolves to an array
 * once every member is ready (port of C# `AsyncBag<T>`).
 *
 * Add members with {@link add}, then {@link seal}; the bag triggers with the
 * results in insertion order. Any member error fails the whole bag.
 */
export class AsyncBag<T = any> extends AsyncReply<T[]> {
  protected replies: Array<AsyncReply<T> | T> = [];
  private count = 0;
  private sealedBag = false;

  /** Optional cast applied to plain (non-reply) members before storing. */
  arrayCast?: (value: unknown) => T;

  constructor(results?: T[]) {
    if (results !== undefined) super(results);
    else super();
  }

  /** Add a value or a pending reply to the bag (ignored once sealed). */
  add(valueOrReply: AsyncReply<T> | T): void {
    if (!this.sealedBag) this.replies.push(valueOrReply);
  }

  /** Merge all members of another bag into this one. */
  addBag(bag: AsyncBag<T>): void {
    for (const r of bag.replies) this.add(r);
  }

  /** Freeze the bag and arrange to trigger once all members are ready. */
  seal(): void {
    if (this.sealedBag) return;
    this.sealedBag = true;

    const results: T[] = new Array<T>(this.replies.length);

    if (this.replies.length === 0) {
      this.trigger(results);
      return;
    }

    for (let i = 0; i < this.replies.length; i++) {
      const k = this.replies[i];
      const index = i;

      if (k instanceof AsyncReply) {
        k.onReady((r) => {
          results[index] = r;
          if (++this.count === this.replies.length) this.trigger(results);
        }).error((e) => this.triggerError(e));
      } else {
        results[index] = this.arrayCast ? this.arrayCast(k) : (k as T);
        if (++this.count === this.replies.length) this.trigger(results);
      }
    }
  }
}
