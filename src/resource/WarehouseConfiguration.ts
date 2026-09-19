/** Parser budgets applied while decoding untrusted Esiur protocol data. */
export class ParserConfiguration {
  static readonly defaultMaximumPacketSize = 8 * 1024 * 1024;
  static readonly defaultMaximumAllocationSize = 4 * 1024 * 1024;
  static readonly defaultMaximumCollectionItems = 65_536;
  static readonly defaultMaximumTypeMetadataDepth = 64;

  /** Maximum declared TDU payload in bytes. Set to `0` to disable the limit. */
  maximumPacketSize = ParserConfiguration.defaultMaximumPacketSize;

  /** Maximum allocation produced by one decoded value. Set to `0` to disable. */
  maximumAllocationSize = ParserConfiguration.defaultMaximumAllocationSize;

  /** Maximum values decoded into one collection. Set to `0` to disable. */
  maximumCollectionItems = ParserConfiguration.defaultMaximumCollectionItems;

  /** Maximum recursive TRU metadata depth. Set to `0` to disable the limit. */
  maximumTypeMetadataDepth = ParserConfiguration.defaultMaximumTypeMetadataDepth;
}

/** Limits resources imported from, or attached by, one remote connection. */
export class ResourceAttachmentConfiguration {
  /** Maximum live remote resources tracked by one connection. `0` disables. */
  maximumAttachedResourcesPerConnection = 4_096;

  /** Maximum concurrent resource attachment operations. `0` disables. */
  maximumPendingAttachmentsPerConnection = 128;

  /** Reject a peer that attaches the same resource more than once. */
  rejectDuplicateAttachments = true;
}

/** Network admission controls applied by each EP server. */
export class ConnectionConfiguration {
  /** Maximum concurrent connections admitted by one server. `0` disables. */
  maximumConnections = 1_024;

  /** Maximum concurrent connections from one IP address. `0` disables. */
  maximumConnectionsPerIpAddress = 64;

  /** Maximum connection attempts during one window. `0` disables. */
  maximumConnectionAttempts = 4_096;

  /** Maximum attempts from one IP during one window. `0` disables. */
  maximumConnectionAttemptsPerIpAddress = 120;

  /** Length of the attempt window in milliseconds. `0` disables rate limits. */
  connectionAttemptWindowMs = 60_000;
}

/** Bounds encrypted transport records before peer-controlled allocation. */
export class EncryptionConfiguration {
  /** Maximum protected record size in bytes. `0` disables. */
  maximumRecordSize = 8 * 1024 * 1024 + 1_024;
}

/** Runtime configuration owned by a Warehouse. */
export class WarehouseConfiguration {
  readonly parser = new ParserConfiguration();
  readonly resourceAttachments = new ResourceAttachmentConfiguration();
  readonly connections = new ConnectionConfiguration();
  readonly encryption = new EncryptionConfiguration();
}
