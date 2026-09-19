/**
 * Raised when untrusted input declares a length that exceeds a configured
 * parser budget (port of C# `ParserLimitException`).
 */
export class ParserLimitException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParserLimitException";
    Object.setPrototypeOf(this, ParserLimitException.prototype);
  }
}

/**
 * Default cap on a TDU's declared payload length, matching esiur-dotnet's
 * `ParserConfiguration.MaximumPacketSize` default (8 MiB). The Dynamic/Typed/
 * Extension length prefix can be up to 7 bytes (declaring up to 2^56), so
 * leaving it unchecked lets a peer force a huge allocation — or a long wait
 * for bytes that may never arrive — from a single header.
 */
export const DEFAULT_MAXIMUM_PAYLOAD_LENGTH = 8 * 1024 * 1024;

/** Matches esiur-dotnet's maximum allocation produced by one decoded value. */
export const DEFAULT_MAXIMUM_ALLOCATION_SIZE = 4 * 1024 * 1024;

/** Matches esiur-dotnet's maximum number of values in one decoded collection. */
export const DEFAULT_MAXIMUM_COLLECTION_ITEMS = 65_536;

/** Matches esiur-dotnet's default recursive TRU metadata budget. */
export const DEFAULT_MAXIMUM_TYPE_METADATA_DEPTH = 64;

interface ParserConfigurationLike {
  parser?: {
    maximumPacketSize?: number;
    maximumAllocationSize?: number;
    maximumCollectionItems?: number;
    maximumTypeMetadataDepth?: number;
  };
  configuration?: {
    parser?: {
      maximumPacketSize?: number;
      maximumAllocationSize?: number;
      maximumCollectionItems?: number;
      maximumTypeMetadataDepth?: number;
    };
  };
}

/** Raised locally when composition would exceed a budget advertised by the peer. */
export class RemoteParserLimitException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteParserLimitException";
    Object.setPrototypeOf(this, RemoteParserLimitException.prototype);
  }
}

function parserConfiguration(warehouse: unknown): ParserConfigurationLike["parser"] | undefined {
  const candidate = warehouse as ParserConfigurationLike | null | undefined;
  return candidate?.configuration?.parser ?? candidate?.parser;
}

/** Resolve a Warehouse's packet budget while preserving explicit call-site overrides. */
export function maximumPacketSize(warehouse: unknown, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  return parserConfiguration(warehouse)?.maximumPacketSize ?? DEFAULT_MAXIMUM_PAYLOAD_LENGTH;
}

/**
 * Throws {@link ParserLimitException} when `declaredLength` exceeds
 * `maximumPayloadLength` (port of C# `ParserGuard.EnsurePacketSize`). Callers
 * must invoke this immediately after decoding the length prefix, before it is
 * used to size an allocation or decide how many more bytes to wait for. A
 * `maximumPayloadLength` of `0` disables the check.
 */
export function ensurePacketSize(declaredLength: number, maximumPayloadLength: number): void {
  if (maximumPayloadLength > 0 && declaredLength > maximumPayloadLength)
    throw new ParserLimitException(
      `Declared packet payload of ${declaredLength} bytes exceeds the ${maximumPayloadLength}-byte limit.`,
    );
}

/** Port of C# `ParserGuard.EnsureAllocation`. */
export function ensureAllocation(warehouse: unknown, size: number, kind: string): void {
  const limit = parserConfiguration(warehouse)?.maximumAllocationSize ?? 0;
  if (limit > 0 && size > limit)
    throw new ParserLimitException(
      `Decoded ${kind} allocation of ${size} bytes exceeds the ${limit}-byte limit.`,
    );
}

/** Port of C# `ParserGuard.EnsureCollectionCount`. */
export function ensureCollectionCount(
  warehouse: unknown,
  count: number,
  estimatedBytesPerItem = 0,
): void {
  const configuration = parserConfiguration(warehouse);
  if (!configuration) return;

  const limit = configuration.maximumCollectionItems ?? 0;
  if (limit > 0 && count > limit)
    throw new ParserLimitException(
      `Decoded collection count of ${count} exceeds the ${limit}-item limit.`,
    );

  if (estimatedBytesPerItem > 0)
    ensureAllocation(warehouse, saturatedMultiply(count, estimatedBytesPerItem), "collection");
}

/** Saturating multiply used before comparing peer-controlled sizes. */
export function saturatedMultiply(value: number, multiplier: number): number {
  const product = value * multiplier;
  return Number.isSafeInteger(product) ? product : Number.MAX_SAFE_INTEGER;
}

/**
 * Reject recursively nested TRU metadata before it can exhaust the JavaScript
 * stack. A null/foreign Warehouse receives the built-in limit, matching
 * esiur-dotnet's compatibility entry points.
 */
export function ensureTypeMetadataDepth(warehouse: unknown, depth: number): void {
  const configured =
    parserConfiguration(warehouse)?.maximumTypeMetadataDepth ?? DEFAULT_MAXIMUM_TYPE_METADATA_DEPTH;

  if (configured > 0 && depth > configured)
    throw new ParserLimitException(
      `TRU type metadata depth of ${depth} exceeds the configured limit of ${configured}.`,
    );
}

interface RemoteLimitConnectionLike {
  session?: {
    remoteMaximumPacketSize?: number;
    remoteMaximumAllocationSize?: number;
    remoteMaximumCollectionItems?: number;
    remoteMaximumTypeMetadataDepth?: number;
    remoteMaximumEncryptedRecordSize?: number;
  };
}

function remoteLimits(connection: unknown): RemoteLimitConnectionLike["session"] | undefined {
  return (connection as RemoteLimitConnectionLike | null | undefined)?.session;
}

export function ensureRemotePacketSize(connection: unknown, size: number): void {
  const limit = remoteLimits(connection)?.remoteMaximumPacketSize ?? 0;
  if (limit > 0 && size > limit)
    throw new RemoteParserLimitException(
      `Composed packet payload of ${size} bytes exceeds the peer's advertised ${limit}-byte limit.`,
    );
}

export function ensureRemoteAllocation(
  connection: unknown,
  size: number,
  kind: string,
): void {
  const limit = remoteLimits(connection)?.remoteMaximumAllocationSize ?? 0;
  if (limit > 0 && size > limit)
    throw new RemoteParserLimitException(
      `Composed ${kind} would allocate ${size} bytes at the peer, exceeding its advertised ${limit}-byte limit.`,
    );
}

export function ensureRemoteCollectionCount(
  connection: unknown,
  count: number,
  estimatedBytesPerItem = 0,
): void {
  const limit = remoteLimits(connection)?.remoteMaximumCollectionItems ?? 0;
  if (limit > 0 && count > limit)
    throw new RemoteParserLimitException(
      `Composed collection has ${count} items, exceeding the peer's advertised ${limit}-item limit.`,
    );
  if (estimatedBytesPerItem > 0)
    ensureRemoteAllocation(
      connection,
      saturatedMultiply(count, estimatedBytesPerItem),
      "collection",
    );
}

export function ensureRemoteTypeMetadataDepth(connection: unknown, tru: unknown): void {
  const limit = remoteLimits(connection)?.remoteMaximumTypeMetadataDepth ?? 0;
  if (limit <= 0 || tru == null) return;

  const depth = typeMetadataDepth(tru);
  if (depth > limit)
    throw new RemoteParserLimitException(
      `Composed TRU type metadata depth of ${depth} exceeds the peer's advertised limit of ${limit}.`,
    );
}

function typeMetadataDepth(tru: unknown): number {
  const subTypes = (tru as { subTypes?: readonly unknown[] } | null)?.subTypes;
  if (!subTypes || subTypes.length === 0) return 1;
  return 1 + Math.max(...subTypes.map(typeMetadataDepth));
}
