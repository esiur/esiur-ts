import { describe, it, expect, vi } from "vitest";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import { Ruling } from "../../src/security/permissions/Ruling.js";
import type { IPermissionsManager } from "../../src/security/permissions/IPermissionsManager.js";
import { AsyncException } from "../../src/core/AsyncException.js";
import { ExceptionCode } from "../../src/core/ExceptionCode.js";

class MathUtil extends Resource {
  @Export(t.i32) accessor lastCall = 0;

  @Export(t.i32, [t.i32, t.i32])
  static add(a: number, b: number): number {
    return a + b;
  }

  // Not static — must be rejected by StaticCall even though its index is valid.
  @Export(t.i32, [t.i32])
  instanceOnly(a: number): number {
    return a;
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

describe("StaticCall", () => {
  it("invokes a static function by TypeDef id + index with no resource instance", async () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager(), true);
    await wh.put("sys", new MemoryStore());
    await wh.open();
    const local = wh.getLocalTypeDefByType(MathUtil);
    const addIndex = wh.getTypeDef(MathUtil).getFunctionByName("add")!.index;

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    const result = await client.staticCall(local.id, addIndex, 3, 4);
    expect(result).toBe(7);

    client.close();
    await server.close();
  });

  it("rejects a StaticCall against a non-static function", async () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager(), true);
    await wh.put("sys", new MemoryStore());
    await wh.open();
    const local = wh.getLocalTypeDefByType(MathUtil);
    const instanceOnlyIndex = wh.getTypeDef(MathUtil).getFunctionByName("instanceOnly")!.index;

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    await expect(client.staticCall(local.id, instanceOnlyIndex, 1)).rejects.toMatchObject({
      code: ExceptionCode.MethodNotFound,
    } as Partial<AsyncException>);

    client.close();
    await server.close();
  });
});
