import { describe, it, expect } from "vitest";
import { EpServer } from "../../src/protocol/EpServer.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";

/**
 * The anonymous (None-mode) handshake: the client's `connect` only resolves
 * after the server replies SessionEstablished. When the server refuses
 * unauthenticated peers it sends ErrorTerminate and closes, so `connect` fails.
 */
describe("anonymous handshake", () => {
  async function makeServer(allowUnauthorized: boolean): Promise<EpServer> {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    await wh.open();
    return EpServer.listen({ port: 0, warehouse: wh, allowUnauthorized });
  }

  it("completes when the server allows anonymous access", async () => {
    const server = await makeServer(true);
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);
    expect(client.isConnected).toBe(true);
    client.close();
    await server.close();
  });

  it("rejects connect when the server denies anonymous access", async () => {
    const server = await makeServer(false);
    await expect(
      EpConnection.connect(`ws://127.0.0.1:${server.port}`),
    ).rejects.toBeTruthy();
    await server.close();
  });
});
