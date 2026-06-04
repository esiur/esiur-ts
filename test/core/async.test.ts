import { describe, it, expect } from "vitest";
import {
  AsyncReply,
  AsyncBag,
  AsyncQueue,
  AsyncException,
  ErrorType,
  ExceptionCode,
} from "../../src/core/index.js";

describe("AsyncReply", () => {
  it("resolves via await after trigger", async () => {
    const r = new AsyncReply<number>();
    queueMicrotask(() => r.trigger(42));
    expect(await r).toBe(42);
  });

  it("is pre-resolved with fromResult", async () => {
    expect(await AsyncReply.fromResult("hi")).toBe("hi");
  });

  it("fires onReady synchronously when already ready", () => {
    let seen: number | undefined;
    AsyncReply.fromResult(7).onReady((v) => (seen = v));
    expect(seen).toBe(7);
  });

  it("rejects via await on triggerError", async () => {
    const r = new AsyncReply<number>();
    r.triggerError(
      new AsyncException(ErrorType.Management, ExceptionCode.Timeout, "boom"),
    );
    await expect(r as PromiseLike<number>).rejects.toMatchObject({
      code: ExceptionCode.Timeout,
      message: "boom",
    });
  });

  it("chains then() like a promise and maps the value", async () => {
    const r = new AsyncReply<number>();
    const mapped = r.then((v) => v + 1).then((v) => v * 2);
    r.trigger(10);
    expect(await mapped).toBe(22);
  });

  it("propagates errors down a then() chain to catch()", async () => {
    const r = new AsyncReply<number>();
    let caught: AsyncException | undefined;
    r.then((v) => v + 1).catch((e) => {
      caught = e;
      return 0;
    });
    r.triggerError(new Error("fail"));
    await Promise.resolve();
    expect(caught?.message).toBe("fail");
  });

  it("only settles once", () => {
    const r = new AsyncReply<number>();
    r.trigger(1);
    r.trigger(2);
    expect(r.result).toBe(1);
  });

  it("delivers progress on the side channel", () => {
    const r = new AsyncReply<number>();
    const seen: number[] = [];
    r.progress((_t, v) => seen.push(v));
    r.triggerProgress(0, 5, 10);
    r.triggerProgress(0, 9, 10);
    expect(seen).toEqual([5, 9]);
  });
});

describe("AsyncBag", () => {
  it("collects mixed values and replies into an ordered array", async () => {
    const bag = new AsyncBag<number>();
    const a = new AsyncReply<number>();
    bag.add(a);
    bag.add(2);
    const c = new AsyncReply<number>();
    bag.add(c);
    bag.seal();

    c.trigger(3);
    a.trigger(1);

    expect(await bag).toEqual([1, 2, 3]);
  });

  it("resolves to empty array when sealed empty", async () => {
    const bag = new AsyncBag<number>();
    bag.seal();
    expect(await bag).toEqual([]);
  });
});

describe("AsyncQueue", () => {
  it("delivers in insertion order even when ready out of order", () => {
    const q = new AsyncQueue<number>();
    const seen: number[] = [];
    q.onReady((v) => seen.push(v));

    const r1 = new AsyncReply<number>();
    const r2 = new AsyncReply<number>();
    const r3 = new AsyncReply<number>();
    q.add(r1);
    q.add(r2);
    q.add(r3);

    r2.trigger(2); // ready out of order — must wait for r1
    expect(seen).toEqual([]);
    r1.trigger(1); // now r1 then r2 flush
    expect(seen).toEqual([1, 2]);
    r3.trigger(3);
    expect(seen).toEqual([1, 2, 3]);
  });
});
