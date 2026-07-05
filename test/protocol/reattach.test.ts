import { describe, it, expect } from "vitest";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";

class CounterResource extends Resource {
  @Export(t.i32) accessor counts = 0;
}

describe("EpConnection reattach + auto reconnect", () => {
  it("restores attached resources by age after an unexpected disconnect", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    const counter = await wh.put("sys/counter", new CounterResource());
    await wh.open();

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const typeDef = wh.getTypeDef(CounterResource);
    const counterId = counter.instance!.id;

    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`, {
      autoReconnect: true,
      reconnectInterval: 20,
    });
    const res = (await client.attach(counterId, typeDef)) as {
      counts: number;
      age: number;
      getAge(index: number): number;
    };

    expect(res.counts).toBe(0);

    for (const connection of [...server.connections]) connection.close();
    await waitFor(() => !client.isConnected);
    await waitFor(() => server.connections.size === 0);

    counter.counts = 5;

    await waitFor(() => client.isConnected && res.counts === 5);
    expect(res.age).toBe(counter.instance!.age);
    expect(res.getAge(0)).toBe(counter.instance!.getAge(0));

    client.close();
    await server.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}
