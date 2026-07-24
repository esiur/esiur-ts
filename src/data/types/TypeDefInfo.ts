import { IndexedStructure } from "../IndexedStructure.js";
import { Index } from "../IndexAttribute.js";
import { TypeDefKind } from "./ITypeDef.js";
import type { PropertyDefInfo } from "./PropertyDefInfo.js";
import type { FunctionDefInfo } from "./FunctionDefInfo.js";
import type { EventDefInfo } from "./EventDefInfo.js";
import type { ConstantDefInfo } from "./ConstantDefInfo.js";

/**
 * Wire-format shape of a type definition (port of C# `TypeDefInfo`), the
 * payload carried by a `TduIdentifier.TypeDef` (0x81) TDU. Decode-only in
 * this port: the compose-direction helpers (`FromTypeDef`/`CopyMember`/etc.
 * in C#) only matter for hosting local resources and answering `TypeDefById`
 * as a server, which is out of today's client-focused scope.
 */
export class TypeDefInfo extends IndexedStructure {
  @Index(0x00) version = 0;
  @Index(0x01) id = 0;
  @Index(0x02) name = "";
  @Index(0x03) namespace: string | undefined;
  @Index(0x04) kind: TypeDefKind = TypeDefKind.Resource;
  @Index(0x05) parent: number | undefined;
  @Index(0x06) properties: PropertyDefInfo[] | undefined;
  @Index(0x07) functions: FunctionDefInfo[] | undefined;
  @Index(0x08) events: EventDefInfo[] | undefined;
  @Index(0x09) constants: ConstantDefInfo[] | undefined;

  @Index(0x20) usage: string | undefined;
  @Index(0x21) description: string | undefined;
  @Index(0x22) example: unknown;
  @Index(0x23) category: string | undefined;
  @Index(0x24) since: string | undefined;
  @Index(0x25) annotations: Map<string, string> | undefined;
}
