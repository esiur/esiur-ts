import { AsyncException } from "./AsyncException.js";
import { ErrorType } from "./ErrorType.js";
import { ExceptionCode } from "./ExceptionCode.js";
import { ProgressType } from "./ProgressType.js";

type Awaitable<R> = R | AsyncReply<R> | PromiseLike<R>;
type FulfilledFn<T, R> = (value: T) => Awaitable<R>;
type RejectedFn<R> = (reason: AsyncException) => Awaitable<R>;

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (
    v != null &&
    (typeof v === "object" || typeof v === "function") &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

/**
 * Esiur's universal asynchronous result (port of C# `AsyncReply<T>`).
 *
 * It is a {@link PromiseLike} — `await reply` works and `then`/`catch`/`finally`
 * behave like a Promise — while additionally exposing Esiur's side channels:
 * `progress`, `chunk`, `propagation` and `warning`. Unlike a native Promise,
 * callbacks registered after the result is ready are invoked **synchronously**,
 * matching the C# implementation.
 *
 * The blocking `Wait()` of the C# version is intentionally omitted (JS has no
 * synchronous blocking); use `await` instead.
 */
export class AsyncReply<T = any> implements PromiseLike<T> {
  protected _ready = false;
  protected _result: T | undefined = undefined;
  protected _exception: AsyncException | undefined = undefined;

  protected readonly _callbacks: Array<(value: T) => void> = [];
  private _errorCallbacks: Array<(ex: AsyncException) => void> | null = null;
  private _progressCallbacks:
    | Array<(type: ProgressType, value: number, max: number) => void>
    | null = null;
  private _chunkCallbacks: Array<(value: unknown) => void> | null = null;
  private _propagationCallbacks: Array<(value: unknown) => void> | null = null;
  private _warningCallbacks: Array<(level: number, message: string) => void> | null =
    null;

  /** Wall-clock time the result became ready. */
  readyTime: number | undefined;

  constructor(result?: T) {
    if (arguments.length > 0) {
      this._ready = true;
      this._result = result;
      this.readyTime = Date.now();
    }
  }

  /** True once a result has been delivered. */
  get ready(): boolean {
    return this._ready;
  }

  /** True if the reply completed with an error. */
  get failed(): boolean {
    return this._exception != null;
  }

  /** The exception, if {@link failed}. */
  get exception(): AsyncException | undefined {
    return this._exception;
  }

  /** The result value, or `undefined` if not ready. */
  get result(): T | undefined {
    return this._result;
  }

  /** A pre-resolved reply. */
  static fromResult<U>(result: U): AsyncReply<U> {
    return new AsyncReply<U>(result);
  }

  // ---- PromiseLike / chaining -------------------------------------------------

  then<R1 = T, R2 = never>(
    onFulfilled?: FulfilledFn<T, R1> | null,
    onRejected?: RejectedFn<R2> | null,
  ): AsyncReply<R1 | R2> {
    const derived = new AsyncReply<R1 | R2>();

    const handleValue = (value: T): void => {
      if (!onFulfilled) {
        derived.trigger(value as unknown as R1);
        return;
      }
      try {
        chain(derived, onFulfilled(value));
      } catch (e) {
        derived.triggerError(AsyncException.from(e));
      }
    };

    const handleError = (ex: AsyncException): void => {
      if (!onRejected) {
        derived.triggerError(ex);
        return;
      }
      try {
        chain(derived, onRejected(ex));
      } catch (e) {
        derived.triggerError(AsyncException.from(e));
      }
    };

    if (this._ready) {
      handleValue(this._result as T);
    } else if (this._exception != null) {
      handleError(this._exception);
    } else {
      this._callbacks.push(handleValue);
      this.addErrorHandler(handleError);
    }

    return derived;
  }

  /** Promise-style rejection handler. */
  catch<R = never>(onRejected: RejectedFn<R>): AsyncReply<T | R> {
    return this.then(null, onRejected);
  }

  /** Promise-style settle handler. */
  finally(onFinally: () => void): AsyncReply<T> {
    return this.then(
      (v) => {
        onFinally();
        return v;
      },
      (e) => {
        onFinally();
        throw e;
      },
    ) as AsyncReply<T>;
  }

  // ---- Esiur fluent side-channels (return `this`) -----------------------------

  /** Register a result handler (C# `Then`); returns `this` for chaining channels. */
  onReady(callback: (value: T) => void): this {
    if (this._ready) {
      callback(this._result as T);
    } else {
      this._callbacks.push(callback);
    }
    return this;
  }

  /** Register an error handler (C# `Error`). */
  error(callback: (ex: AsyncException) => void): this {
    this.addErrorHandler(callback);
    if (this._exception != null) callback(this._exception);
    return this;
  }

  /** Register a progress handler. */
  progress(
    callback: (type: ProgressType, value: number, max: number) => void,
  ): this {
    (this._progressCallbacks ??= []).push(callback);
    return this;
  }

  /** Register a chunk handler (streamed partial values). */
  chunk(callback: (value: unknown) => void): this {
    (this._chunkCallbacks ??= []).push(callback);
    return this;
  }

  /** Register a propagation handler. */
  propagation(callback: (value: unknown) => void): this {
    (this._propagationCallbacks ??= []).push(callback);
    return this;
  }

  /** Register a warning handler. */
  warning(callback: (level: number, message: string) => void): this {
    (this._warningCallbacks ??= []).push(callback);
    return this;
  }

  private addErrorHandler(callback: (ex: AsyncException) => void): void {
    (this._errorCallbacks ??= []).push(callback);
  }

  // ---- Triggers ---------------------------------------------------------------

  /** Deliver the result. No-op if already settled. */
  trigger(result: T): void {
    if (this._exception != null || this._ready) return;

    this.readyTime = Date.now();
    this._result = result;
    this._ready = true;

    for (const cb of this._callbacks.slice()) cb(result);
  }

  /** Fail the reply. No-op if a result was already delivered. */
  triggerError(exception: Error | AsyncException): void {
    if (this._ready || this._exception != null) return;

    this._exception = AsyncException.from(exception);

    if (this._errorCallbacks != null) {
      for (const cb of this._errorCallbacks.slice()) cb(this._exception);
    }
  }

  triggerProgress(type: ProgressType, value: number, max: number): void {
    if (this._progressCallbacks != null)
      for (const cb of this._progressCallbacks.slice()) cb(type, value, max);
  }

  triggerWarning(level: number, message: string): void {
    if (this._warningCallbacks != null)
      for (const cb of this._warningCallbacks.slice()) cb(level, message);
  }

  triggerChunk(value: unknown): void {
    if (this._chunkCallbacks != null)
      for (const cb of this._chunkCallbacks.slice()) cb(value);
  }

  triggerPropagation(value: unknown): void {
    if (this._propagationCallbacks != null)
      for (const cb of this._propagationCallbacks.slice()) cb(value);
  }

  /** Fail the reply with a Timeout error after `ms` if it has not settled. */
  timeout(ms: number, callback?: () => void): this {
    setTimeout(() => {
      if (!this._ready && this._exception == null) {
        this.triggerError(
          new AsyncException(
            ErrorType.Management,
            ExceptionCode.Timeout,
            "Execution timeout expired.",
          ),
        );
        callback?.();
      }
    }, ms);
    return this;
  }
}

/** Resolve `derived` with `value`, following the value if it is itself thenable. */
function chain<R>(derived: AsyncReply<R>, value: Awaitable<R>): void {
  if (value instanceof AsyncReply) {
    value.onReady((v) => derived.trigger(v));
    value.error((e) => derived.triggerError(e));
  } else if (isThenable(value)) {
    value.then(
      (v) => derived.trigger(v as R),
      (e) => derived.triggerError(AsyncException.from(e)),
    );
  } else {
    derived.trigger(value);
  }
}
