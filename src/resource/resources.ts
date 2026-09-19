import { composeInternal, registerComposer } from "../data/Codec.js";
import * as DC from "../data/DC.js";
import { Tdu } from "../data/Tdu.js";
import { TduIdentifier } from "../data/TduIdentifier.js";
import type { IResource } from "./IResource.js";
import type { Warehouse } from "./Warehouse.js";

interface RemoteResourceLike extends IResource {
  connection?: unknown;
  instanceId?: number;
}

/** True for objects implementing Esiur's resource lifecycle surface. */
export function isResource(value: unknown): value is IResource {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as Partial<IResource>;
  return (
    typeof candidate.handle === "function" &&
    typeof candidate.destroy === "function" &&
    typeof candidate.addDestroyHandler === "function" &&
    typeof candidate.removeDestroyHandler === "function"
  );
}

/**
 * Compose an IResource reference using the same ownership direction as dotnet:
 * a proxy owned by the destination connection is LocalResource; a resource
 * hosted by this Warehouse is RemoteResource.
 */
export function resourceCompose(
  value: IResource,
  _warehouse: Warehouse,
  connection: unknown,
): Tdu {
  const remote = value as RemoteResourceLike;
  const isLocalToPeer = remote.connection != null && remote.connection === connection;
  const instanceId = isLocalToPeer ? remote.instanceId : value.instance?.id;

  if (
    instanceId == null ||
    !Number.isInteger(instanceId) ||
    instanceId < 0 ||
    instanceId > 0xffff_ffff ||
    (!isLocalToPeer && value.instance?.isDestroyed)
  ) return composeInternal(null);

  return resourceReference(instanceId, isLocalToPeer);
}

function resourceReference(instanceId: number, local: boolean): Tdu {
  if (instanceId <= 0xff)
    return new Tdu(
      local ? TduIdentifier.LocalResource8 : TduIdentifier.RemoteResource8,
      Uint8Array.of(instanceId),
      1,
    );

  if (instanceId <= 0xffff)
    return new Tdu(
      local ? TduIdentifier.LocalResource16 : TduIdentifier.RemoteResource16,
      DC.uint16ToBytes(instanceId),
      2,
    );

  return new Tdu(
    local ? TduIdentifier.LocalResource32 : TduIdentifier.RemoteResource32,
    DC.uint32ToBytes(instanceId),
    4,
  );
}

/** Compose a homogeneous resource collection with the protocol ResourceList tag. */
export function resourceListCompose(
  values: readonly IResource[],
  warehouse: Warehouse,
  connection: unknown,
): Tdu {
  const content = DC.merge(
    ...values.map((value) => resourceCompose(value, warehouse, connection).composed),
  );
  return new Tdu(TduIdentifier.ResourceList, content, content.length);
}

registerComposer((value, warehouse, connection) => {
  if (isResource(value))
    return resourceCompose(value, warehouse as Warehouse, connection);
  if (Array.isArray(value) && value.length > 0 && value.every(isResource))
    return resourceListCompose(value, warehouse as Warehouse, connection);
  return undefined;
});
