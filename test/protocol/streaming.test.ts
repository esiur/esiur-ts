import { describe, it, expect, vi } from "vitest";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import { StreamMode } from "../../src/data/types/StreamMode.js";
import { Ruling } from "../../src/security/permissions/Ruling.js";
import type { IPermissionsManager } from "../../src/security/permissions/IPermissionsManager.js";

class Counter extends Resource {
  cleanedUp = false;

  @Export(t.i32, [t.i32], { streamMode: StreamMode.Pull, pausable: true })
  async *countTo(n: number): AsyncGenerator<number> {
    try {
      for (let i = 1; i <= n; i++) yield i;
    } finally {
      this.cleanedUp = true;
    }
  }
}

class AllowManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  readonly settings = undefined;
  applicable = vi.fn((): Ruling => Ruling.Allowed);
  initialize(): boolean {
    return true;
  }
}

async function setup(): Promise<{
  wh: Warehouse;
  counter: Counter;
  server: EpServer;
  client: EpConnection;
  instanceId: number;
  index: number;
}> {
  const wh = new Warehouse();
  wh.registerManager(new AllowManager(), true);
  await wh.put("sys", new MemoryStore());
  const counter = await wh.put("sys/counter", new Counter());
  await wh.open();
  const server = await EpServer.listen({ port: 0, warehouse: wh });
  const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);
  const index = wh.getTypeDef(Counter).getFunctionByName("countTo")!.index;
  return { wh, counter, server, client, instanceId: counter.instance!.id, index };
}

describe("Streaming (PullStream / TerminateExecution / HaltExecution / ResumeExecution)", () => {
  it("delivers a pull-mode async generator chunk by chunk", async () => {
    const { counter, server, client, instanceId, index } = await setup();

    const stream = client.invokeStream<number>(StreamMode.Pull, instanceId, index, 4);
    const received: number[] = [];
    for await (const v of stream) received.push(v);

    expect(received).toEqual([1, 2, 3, 4]);
    expect(counter.cleanedUp).toBe(true); // generator ran to completion naturally

    client.close();
    await server.close();
  });

  it("halt pauses delivery until resume", async () => {
    const { server, client, instanceId, index } = await setup();

    const stream = client.invokeStream<number>(StreamMode.Pull, instanceId, index, 3);
    const it = stream[Symbol.asyncIterator]();

    const first = await it.next();
    expect(first.value).toBe(1);

    await stream.halt();

    let secondSettled = false;
    const secondPromise = it.next().then((r) => {
      secondSettled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(secondSettled).toBe(false); // still halted — next() must not have resolved yet

    await stream.resume();
    const second = await secondPromise;
    expect(second.value).toBe(2);

    const third = await it.next();
    expect(third.value).toBe(3);
    const done = await it.next();
    expect(done.done).toBe(true);

    client.close();
    await server.close();
  });

  it("terminate stops the stream early and runs the generator's cleanup", async () => {
    const { counter, server, client, instanceId, index } = await setup();

    const stream = client.invokeStream<number>(StreamMode.Pull, instanceId, index, 10);
    const received: number[] = [];
    for await (const v of stream) {
      received.push(v);
      if (v === 2) break; // triggers AsyncStreamReply's iterator .return() -> terminate()
    }

    expect(received).toEqual([1, 2]);
    await new Promise((r) => setTimeout(r, 100)); // let the TerminateExecution round trip land
    expect(counter.cleanedUp).toBe(true); // generator's `finally` ran via iterator.return()

    client.close();
    await server.close();
  });
});
