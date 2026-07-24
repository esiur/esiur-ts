import { StreamMode } from "../data/types/StreamMode.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Result of {@link ServerInvocationContext.pullAsync}. */
export interface PullResult {
  done: boolean;
  value?: unknown;
}

/**
 * Server-side tracking for one in-flight streamed function call (port of C#
 * `InvocationContext`, scoped to what `PullStream`/`TerminateExecution`/
 * `HaltExecution`/`ResumeExecution` need). Wraps whatever iterator a
 * streaming function returned — `AsyncIterable`/`Iterable` is JS's native
 * equivalent of dotnet's `IAsyncEnumerable<T>`/`IEnumerable<T>` split, so
 * unlike dotnet there's no separate Push/Pull source-shape branch needed
 * here: both are driven the same way, just on a different schedule
 * (immediately, pumped, vs. only on an explicit `PullStream`).
 */
export class ServerInvocationContext {
  private readonly iterator: AsyncIterator<unknown> | Iterator<unknown>;
  private readonly abort = new AbortController();
  private ended = false;
  private halted = false;
  private resumeDeferred: Deferred<void> | undefined;

  constructor(
    source: AsyncIterable<unknown> | Iterable<unknown>,
    readonly streamMode: StreamMode,
    readonly pausable: boolean,
  ) {
    this.iterator =
      Symbol.asyncIterator in source
        ? (source as AsyncIterable<unknown>)[Symbol.asyncIterator]()
        : (source as Iterable<unknown>)[Symbol.iterator]();
  }

  /** Aborted when {@link terminate} runs — a source can observe this to stop early work of its own. */
  get signal(): AbortSignal {
    return this.abort.signal;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /** Advance the iterator by one item, waiting out any active halt first. */
  async pullAsync(): Promise<PullResult> {
    if (this.ended) return { done: true };
    await this.waitWhileHalted();
    if (this.ended) return { done: true };

    const r = await this.iterator.next();
    if (r.done) this.ended = true;
    return { done: !!r.done, value: r.value };
  }

  /** Stop the stream: aborts {@link signal}, releases any halt wait, and closes the iterator. */
  async terminate(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.abort.abort();
    this.resumeDeferred?.resolve();
    this.resumeDeferred = undefined;
    await this.iterator.return?.();
  }

  halt(): void {
    if (this.ended) throw new Error("Cannot halt an execution that has already ended.");
    if (!this.pausable) throw new Error("This stream is not pausable.");
    if (this.halted) throw new Error("This stream is already halted.");
    this.halted = true;
    this.resumeDeferred = createDeferred<void>();
  }

  resume(): void {
    if (this.ended) throw new Error("Cannot resume an execution that has already ended.");
    if (!this.pausable) throw new Error("This stream is not pausable.");
    if (!this.halted) throw new Error("This stream is not halted.");
    this.halted = false;
    this.resumeDeferred?.resolve();
    this.resumeDeferred = undefined;
  }

  private async waitWhileHalted(): Promise<void> {
    while (this.halted && !this.ended) await this.resumeDeferred?.promise;
  }
}

/** Duck-type check for a value with `Symbol.asyncIterator` or `Symbol.iterator`. */
export function isIterableResult(value: unknown): value is AsyncIterable<unknown> | Iterable<unknown> {
  if (value == null || typeof value !== "object") return false;
  return Symbol.asyncIterator in value || Symbol.iterator in value;
}
