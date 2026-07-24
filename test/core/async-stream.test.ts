import { describe, it, expect, vi } from "vitest";
import { AsyncReply } from "../../src/core/AsyncReply.js";
import { AsyncStreamReply } from "../../src/core/AsyncStreamReply.js";
import { AsyncException } from "../../src/core/AsyncException.js";
import { ErrorType } from "../../src/core/ErrorType.js";
import { ExceptionCode } from "../../src/core/ExceptionCode.js";
import { StreamMode } from "../../src/data/types/StreamMode.js";

function makeStream<T = unknown>(streamMode: StreamMode, pull?: () => AsyncReply) {
  const terminate = vi.fn(() => AsyncReply.fromResult(null));
  const halt = vi.fn(() => AsyncReply.fromResult(null));
  const resume = vi.fn(() => AsyncReply.fromResult(null));
  const pullFn = pull ?? vi.fn(() => AsyncReply.fromResult(null));
  const stream = new AsyncStreamReply<T>(streamMode, pullFn, terminate, halt, resume);
  return { stream, pullFn, terminate, halt, resume };
}

describe("AsyncStreamReply", () => {
  it("push mode: delivers chunks pushed before iteration starts, in order", async () => {
    const { stream } = makeStream<number>(StreamMode.Push);

    stream.triggerStreamStarted();
    stream.triggerChunk(1);
    stream.triggerChunk(2);
    stream.triggerStreamCompleted();

    const received: number[] = [];
    for await (const item of stream) received.push(item);
    expect(received).toEqual([1, 2]);
  });

  it("push mode: delivers chunks arriving while a consumer is awaiting", async () => {
    const { stream } = makeStream<string>(StreamMode.Push);
    stream.triggerStreamStarted();

    const received: string[] = [];
    const consume = (async () => {
      for await (const item of stream) received.push(item);
    })();

    await Promise.resolve();
    stream.triggerChunk("a");
    await Promise.resolve();
    stream.triggerChunk("b");
    stream.triggerStreamCompleted();

    await consume;
    expect(received).toEqual(["a", "b"]);
  });

  it("pull mode: requests one item per iteration step", async () => {
    let n = 0;
    const terminate = vi.fn(() => AsyncReply.fromResult(null));
    const halt = vi.fn(() => AsyncReply.fromResult(null));
    const resume = vi.fn(() => AsyncReply.fromResult(null));
    const pullFn = vi.fn((): AsyncReply => {
      n++;
      // Simulate the server replying with a chunk shortly after each pull.
      // `pullFn` is only ever invoked once `stream` is fully constructed
      // (the constructor never calls it synchronously), so the closure
      // reference below is safe despite `stream` being declared after it.
      queueMicrotask(() => {
        if (n <= 2) stream.triggerChunk(n);
        else stream.triggerStreamCompleted();
      });
      return AsyncReply.fromResult(null);
    });
    const stream = new AsyncStreamReply<number>(StreamMode.Pull, pullFn, terminate, halt, resume);
    stream.triggerStreamStarted();

    const received: number[] = [];
    for await (const item of stream) received.push(item);

    expect(received).toEqual([1, 2]);
    expect(pullFn).toHaveBeenCalledTimes(3);
  });

  it("pull() throws for a push-mode stream", () => {
    const { stream } = makeStream(StreamMode.Push);
    expect(() => stream.pull()).toThrow(/Pull is only valid/);
  });

  it("terminate() calls the terminate callback once and marks the stream completed", async () => {
    const { stream, terminate } = makeStream(StreamMode.Push);
    stream.triggerStreamStarted();

    await stream.terminate();
    expect(stream.completed).toBe(true);
    expect(terminate).toHaveBeenCalledTimes(1);

    // A second call is a no-op (already terminated).
    await stream.terminate();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("breaking out of a `for await` loop early terminates the stream", async () => {
    const { stream, terminate } = makeStream<number>(StreamMode.Push);
    stream.triggerStreamStarted();
    stream.triggerChunk(1);
    stream.triggerChunk(2);

    for await (const item of stream) {
      expect(item).toBe(1);
      break;
    }

    expect(terminate).toHaveBeenCalledTimes(1);
    expect(stream.completed).toBe(true);
  });

  it("propagates a stream error to iteration and to the outer AsyncReply", async () => {
    const { stream } = makeStream<number>(StreamMode.Push);
    stream.triggerStreamStarted();

    const err = new AsyncException(ErrorType.Exception, ExceptionCode.RuntimeException, "boom");
    stream.triggerStreamError(err);

    expect(stream.failed).toBe(true);
    expect(stream.exception).toBe(err);

    await expect(
      (async () => {
        const received: number[] = [];
        for await (const item of stream) received.push(item);
      })(),
    ).rejects.toBe(err);
  });

  it("a `Completed` reply resolves the outer AsyncReply independently of stream state", async () => {
    const { stream } = makeStream<number>(StreamMode.Push);
    stream.triggerStreamStarted();
    stream.trigger(42);
    expect(stream.ready).toBe(true);
    expect(stream.result).toBe(42);
  });

  it("rejects enumerating the same stream twice", () => {
    const { stream } = makeStream<number>(StreamMode.Push);
    void stream[Symbol.asyncIterator]();
    expect(() => stream[Symbol.asyncIterator]()).toThrow(/only be enumerated once/);
  });
});
