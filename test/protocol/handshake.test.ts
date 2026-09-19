import { describe, it, expect } from "vitest";
import { EpServer } from "../../src/protocol/EpServer.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { WebSocket } from "ws";

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

  it("exchanges parser and encrypted-record budgets in both directions", async () => {
    const serverWarehouse = new Warehouse();
    await serverWarehouse.put("sys", new MemoryStore());
    await serverWarehouse.open();
    serverWarehouse.configuration.parser.maximumPacketSize = 7_100_001;
    serverWarehouse.configuration.parser.maximumAllocationSize = 3_100_002;
    serverWarehouse.configuration.parser.maximumCollectionItems = 51_003;
    serverWarehouse.configuration.parser.maximumTypeMetadataDepth = 54;
    serverWarehouse.configuration.encryption.maximumRecordSize = 7_101_004;

    const clientWarehouse = new Warehouse();
    await clientWarehouse.put("sys", new MemoryStore());
    await clientWarehouse.open();
    clientWarehouse.configuration.parser.maximumPacketSize = 6_200_001;
    clientWarehouse.configuration.parser.maximumAllocationSize = 2_200_002;
    clientWarehouse.configuration.parser.maximumCollectionItems = 42_003;
    clientWarehouse.configuration.parser.maximumTypeMetadataDepth = 45;
    clientWarehouse.configuration.encryption.maximumRecordSize = 6_201_004;

    const server = await EpServer.listen({
      port: 0,
      warehouse: serverWarehouse,
      allowUnauthorized: true,
    });
    const client = await EpConnection.connect(
      `ws://127.0.0.1:${server.port}`,
      clientWarehouse,
    );
    const serverConnection = [...server.connections][0];

    expect(client.session.remoteMaximumPacketSize).toBe(7_100_001);
    expect(client.session.remoteMaximumAllocationSize).toBe(3_100_002);
    expect(client.session.remoteMaximumCollectionItems).toBe(51_003);
    expect(client.session.remoteMaximumTypeMetadataDepth).toBe(54);
    expect(client.session.remoteMaximumEncryptedRecordSize).toBe(7_101_004);

    expect(serverConnection.session.remoteMaximumPacketSize).toBe(6_200_001);
    expect(serverConnection.session.remoteMaximumAllocationSize).toBe(2_200_002);
    expect(serverConnection.session.remoteMaximumCollectionItems).toBe(42_003);
    expect(serverConnection.session.remoteMaximumTypeMetadataDepth).toBe(45);
    expect(serverConnection.session.remoteMaximumEncryptedRecordSize).toBe(6_201_004);

    client.close();
    await server.close();
    await clientWarehouse.close();
    await serverWarehouse.close();
  });

  it("closes peers that do not finish authentication before the deadline", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    await wh.open();
    const server = await EpServer.listen({
      port: 0,
      warehouse: wh,
      authenticationTimeoutMs: 40,
    });
    const raw = new WebSocket(`ws://127.0.0.1:${server.port}`, "EP");

    await new Promise<void>((resolve, reject) => {
      raw.once("open", () => resolve());
      raw.once("error", reject);
    });
    await new Promise<void>((resolve) => raw.once("close", () => resolve()));

    expect(server.connections.size).toBe(0);
    await server.close();
    await wh.close();
  });

  it("rejects oversized WebSocket messages before packet parsing", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    await wh.open();
    wh.configuration.parser.maximumPacketSize = 128;
    wh.configuration.encryption.maximumRecordSize = 128;
    const server = await EpServer.listen({
      port: 0,
      warehouse: wh,
      authenticationTimeoutMs: 1_000,
    });
    const raw = new WebSocket(`ws://127.0.0.1:${server.port}`, "EP");

    await new Promise<void>((resolve, reject) => {
      raw.once("open", () => resolve());
      raw.once("error", reject);
    });
    raw.on("error", () => {});
    raw.send(new Uint8Array(129));
    const closeCode = await new Promise<number>((resolve) =>
      raw.once("close", (code) => resolve(code)),
    );

    expect(closeCode).toBe(1009);
    await server.close();
    await wh.close();
  });
});
