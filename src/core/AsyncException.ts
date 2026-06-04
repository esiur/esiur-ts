import { ErrorType } from "./ErrorType.js";
import { ExceptionCode } from "./ExceptionCode.js";

/**
 * Error type used throughout Esiur (port of C# `AsyncException`).
 *
 * Carries an {@link ErrorType} category and an {@link ExceptionCode}. Wrapping a
 * plain error produces a `Type = Exception` instance with `Code = RuntimeException`.
 */
export class AsyncException extends Error {
  readonly type: ErrorType;
  readonly code: ExceptionCode;
  /** The original error, when this wraps a thrown exception. */
  readonly inner?: Error;

  constructor(inner: Error);
  constructor(type: ErrorType, code: number, message: string);
  constructor(
    typeOrInner: ErrorType | Error,
    code?: number,
    message?: string,
  ) {
    if (typeOrInner instanceof Error) {
      super(typeOrInner.message);
      this.type = ErrorType.Exception;
      this.code = ExceptionCode.RuntimeException;
      this.inner = typeOrInner;
      if (typeOrInner.stack) this.stack = typeOrInner.stack;
    } else {
      super(message ?? "");
      this.type = typeOrInner;
      this.code = (code ?? 0) as ExceptionCode;
    }
    this.name = "AsyncException";
    Object.setPrototypeOf(this, AsyncException.prototype);
  }

  override toString(): string {
    return `${ExceptionCode[this.code] ?? this.code}: ${this.message}`;
  }

  /** Coerce any thrown value into an {@link AsyncException}. */
  static from(value: unknown): AsyncException {
    if (value instanceof AsyncException) return value;
    if (value instanceof Error) return new AsyncException(value);
    return new AsyncException(new Error(String(value)));
  }
}
