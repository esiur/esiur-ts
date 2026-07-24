import { AsyncReply } from "./AsyncReply.js";
import { AsyncException } from "./AsyncException.js";
import { StreamMode } from "../data/types/StreamMode.js";

/** A minimal deferred promise (stands in for C#'s `TaskCompletionSource`). */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  settled: boolean;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const d: Deferred<T> = { promise, resolve: () => {}, reject: () => {}, settled: false };
  d.resolve = (value: T) => {
    if (d.settled) return;
    d.settled = true;
    resolve(value);
  };
  d.reject = (error: unknown) => {
    if (d.settled) return;
    d.settled = true;
    reject(error);
  };
  return d;
}

/**
 * Represents a remotely executing stream and exposes its lifecycle controls
 * (port of C# `AsyncStreamReply`/`AsyncStreamReply<T>`, collapsed into one
 * generic class — TS has no need for C#'s non-generic/generic split, which
 * exists only because `IAsyncEnumerable<T>` needs a concrete `T`).
 *
 * All of C#'s `lock (_streamLock)`/`lock (_itemsLock)` blocks are dropped:
 * they're pure mutual-exclusion guards around synchronous state mutation,
 * with no JS equivalent needed since none of these methods yield to the
 * event loop mid-mutation.
 */
export class AsyncStreamReply<T = unknown> extends AsyncReply<T> implements AsyncIterable<T> {
  private streamStarted = false;
  private streamCompleted = false;
  private terminationSent = false;
  private streamException: AsyncException | undefined;
  private readonly startedDeferred = createDeferred<void>();

  private readonly items: T[] = [];
  private itemAvailable: Deferred<void> | undefined;
  private enumeratorCreated = false;
  private movePending = false;

  constructor(
    readonly streamMode: StreamMode,
    private readonly pullFn: () => AsyncReply,
    private readonly terminateFn: () => AsyncReply,
    private readonly haltFn: () => AsyncReply,
    private readonly resumeFn: () => AsyncReply,
  ) {
    super();
    this.chunk((value) => this.receiveItem(value as T));
  }

  /** Whether the peer acknowledged that the stream has started. */
  get started(): boolean {
    return this.streamStarted;
  }

  /** Whether the stream completed or was terminated. */
  get completed(): boolean {
    return this.streamCompleted;
  }

  /** Request the next item of a pull stream. */
  pull(): AsyncReply {
    if (this.streamMode !== StreamMode.Pull)
      throw new Error("Pull is only valid for a pull stream.");
    if (this.streamCompleted) return AsyncReply.fromResult(null);
    return this.pullFn();
  }

  /** Terminate the remote stream execution and release its enumerator. */
  terminate(): AsyncReply {
    if (this.terminationSent || this.streamCompleted) return AsyncReply.fromResult(null);

    this.terminationSent = true;
    this.streamCompleted = true;
    this.startedDeferred.resolve();
    this.onStreamCompleted();

    const reply = this.terminateFn();
    reply.error((e) => this.triggerStreamError(e));
    return reply;
  }

  /** Halt a pausable remote stream execution. */
  halt(): AsyncReply {
    if (this.streamCompleted) return AsyncReply.fromResult(null);
    const reply = this.haltFn();
    reply.error((e) => this.triggerStreamError(e));
    return reply;
  }

  /** Resume a halted remote stream execution. */
  resume(): AsyncReply {
    if (this.streamCompleted) return AsyncReply.fromResult(null);
    const reply = this.resumeFn();
    reply.error((e) => this.triggerStreamError(e));
    return reply;
  }

  /** @internal Called by `EpConnection` when the peer's `Stream` reply arrives. */
  triggerStreamStarted(): void {
    if (this.streamCompleted || this.streamException != null) return;
    this.streamStarted = true;
    this.startedDeferred.resolve();
    this.onStreamStarted();
  }

  /** @internal Called by `EpConnection` when the stream's `Completed` reply arrives. */
  triggerStreamCompleted(): void {
    if (this.streamCompleted) return;
    this.streamCompleted = true;
    this.startedDeferred.resolve();
    this.onStreamCompleted();
  }

  /** @internal Called by `EpConnection` on an `ExecutionError`/`PermissionError` reply. */
  triggerStreamError(exception: AsyncException): void {
    if (this.streamCompleted || this.streamException != null) return;
    this.streamException = exception;
    this.streamCompleted = true;
    this.startedDeferred.reject(exception);
    this.onStreamError(exception);
    super.triggerError(exception);
  }

  override triggerError(exception: Error | AsyncException): void {
    this.triggerStreamError(AsyncException.from(exception));
  }

  protected onStreamStarted(): void {}

  protected onStreamCompleted(): void {
    this.itemAvailable?.resolve();
    this.itemAvailable = undefined;
  }

  protected onStreamError(exception: AsyncException): void {
    this.itemAvailable?.reject(exception);
    this.itemAvailable = undefined;
  }

  private receiveItem(item: T): void {
    if (this.streamCompleted || this.streamException != null) return;
    this.items.push(item);
    this.itemAvailable?.resolve();
    this.itemAvailable = undefined;
  }

  private async moveNextAsync(): Promise<{ hasValue: boolean; value?: T }> {
    if (this.movePending) throw new Error("Concurrent iteration calls are not supported.");
    this.movePending = true;
    try {
      await this.startedDeferred.promise;

      for (;;) {
        if (this.streamException != null) throw this.streamException;
        if (this.items.length > 0) return { hasValue: true, value: this.items.shift() };
        if (this.streamCompleted) return { hasValue: false };

        const deferred = createDeferred<void>();
        this.itemAvailable = deferred;

        if (this.streamMode === StreamMode.Pull) this.pull().error((e) => this.triggerStreamError(e));

        await deferred.promise;
      }
    } finally {
      this.movePending = false;
    }
  }

  /** Consume with `for await (const item of stream)`. A stream can only be enumerated once. */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.enumeratorCreated) throw new Error("A remote stream can only be enumerated once.");
    this.enumeratorCreated = true;

    return {
      next: async (): Promise<IteratorResult<T>> => {
        const r = await this.moveNextAsync();
        return r.hasValue ? { done: false, value: r.value as T } : { done: true, value: undefined };
      },
      return: async (): Promise<IteratorResult<T>> => {
        if (!this.streamCompleted) await this.terminate();
        return { done: true, value: undefined };
      },
    };
  }
}
