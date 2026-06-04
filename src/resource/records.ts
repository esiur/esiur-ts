import { Tdu } from "../data/Tdu.js";
import { TduClass } from "../data/TduClass.js";
import { TduIdentifier } from "../data/TduIdentifier.js";
import { TruTypeDef, type Tru, registerTypeDefResolver } from "../data/Tru.js";
import { composeInternal, registerComposer } from "../data/Codec.js";
import { merge } from "../data/DC.js";
import type { ITypeDef } from "../data/types/ITypeDef.js";
import type { LocalTypeDef } from "./typedef.js";
import type { Warehouse } from "./Warehouse.js";

/**
 * Marker base class for record (data-transfer) types. A record exposes
 * `@Export`ed properties and serializes as a Typed TDU referencing its
 * {@link LocalTypeDef} (port of C# `Record`/`IRecord`).
 */
export class Record {}

/** True if a value is a record instance. */
export function isRecord(value: unknown): value is Record {
  return value instanceof Record;
}

/** Compose a record as a Typed TDU: `TruTypeDef` metadata + each property value. */
export function recordCompose(value: object, warehouse: Warehouse, connection: unknown): Tdu {
  const typeDef = warehouse.getLocalTypeDefByType(value.constructor) as LocalTypeDef;
  const metadata = new TruTypeDef(false, typeDef);

  const bag = value as { [key: string]: unknown };
  const parts: Uint8Array[] = [];

  for (const pt of typeDef.template.properties) {
    const tdu = composeInternal(bag[pt.name], warehouse, connection);
    if (
      tdu.tduClass === TduClass.Typed &&
      pt.valueType &&
      tdu.metadata &&
      pt.valueType.match(tdu.metadata as Tru)
    ) {
      const d = tdu.composed.subarray(tdu.contentOffset);
      parts.push(new Tdu(TduIdentifier.TypeOfTarget, d, d.length).composed);
    } else {
      parts.push(tdu.composed);
    }
  }

  const payload = merge(...parts);
  return new Tdu(TduIdentifier.Typed, payload, payload.length, metadata, connection);
}

// Wire records into the serializer:
//  - compose: recognize record instances and produce their Typed TDU.
//  - decode: resolve a TypeDef id to its definition via the warehouse.
registerComposer((value, warehouse, connection) =>
  isRecord(value) ? recordCompose(value, warehouse as Warehouse, connection) : undefined,
);
registerTypeDefResolver((warehouse, id): ITypeDef =>
  (warehouse as Warehouse).getLocalTypeDefById(id),
);
