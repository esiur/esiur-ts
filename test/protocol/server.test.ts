import { describe, it, expect } from "vitest";
import { EpServer } from "../../src/protocol/EpServer.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";

class Greeter extends Resource {
  @Export(t.i32) accessor visits = 0;

  @Export(t.string, [t.string])
  greet(name: string): string {
    this.visits++;
    return `Hi ${name}`;
  }
}

describe("EpServer + EpConnection.connect (end-to-end API)", () => {
  it("hosts a warehouse and serves a remote client", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    const greeter = await wh.put("sys/greeter", new Greeter());
    await wh.open();

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const typeDef = wh.getTypeDef(Greeter);
    const greeterId = greeter.instance!.id;

    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);
    const res = (await client.attach(greeterId, typeDef)) as Record<string, unknown> & {
      visits: number;
      greet: (n: string) => PromiseLike<string>;
    };

    expect(res.visits).toBe(0);
    expect(await res.greet("Sam")).toBe("Hi Sam");
    expect(res.visits).toBe(1);
    expect(greeter.visits).toBe(1);
    expect(server.connections.size).toBe(1);

    client.close();
    await server.close();
  });
});
