/**
 * Point-in-time diagnostics for one EP connection. Collection is deliberately
 * opt-in: EpConnection does not allocate a collector or increment counters
 * until monitoring is enabled by its owner.
 */
export interface EpConnectionRuntimeMetricsSnapshot {
  enabled: boolean;
  startedAt: Date | null;
  sampledAt: Date;
  monitoringDurationMilliseconds: number;
  connected: boolean;
  authenticated: boolean;
  encrypted: boolean;
  sentBytes: number;
  receivedBytes: number;
  sentPackets: number;
  receivedPackets: number;
  sentRequests: number;
  receivedRequests: number;
  sentReplies: number;
  receivedReplies: number;
  sentNotifications: number;
  receivedNotifications: number;
  sentPropertyModifications: number;
  receivedPropertyModifications: number;
  sentEvents: number;
  receivedEvents: number;
  sentErrors: number;
  receivedErrors: number;
  bytesPerSecond: number;
  packetsPerSecond: number;
  notificationsPerSecond: number;
  propertyModificationsPerSecond: number;
  eventsPerSecond: number;
  attachedResources: number;
  localResourceSubscriptions: number;
  eventSubscriptions: number;
  pendingRequests: number;
  pendingResourceAttachments: number;
  pendingTypeDefinitions: number;
  cachedTypeDefinitions: number;
  neededResources: number;
  neededTypeDefinitions: number;
  activeInvocations: number;
  queuedNotificationWork: number;
  remoteMaximumPacketSize: number;
  remoteMaximumAllocationSize: number;
  remoteMaximumCollectionItems: number;
  remoteMaximumTypeMetadataDepth: number;
  remoteMaximumEncryptedRecordSize: number;
}

export type EpConnectionRuntimeState = Omit<
  EpConnectionRuntimeMetricsSnapshot,
  | "enabled" | "startedAt" | "sampledAt" | "monitoringDurationMilliseconds"
  | "sentBytes" | "receivedBytes" | "sentPackets" | "receivedPackets"
  | "sentRequests" | "receivedRequests" | "sentReplies" | "receivedReplies"
  | "sentNotifications" | "receivedNotifications"
  | "sentPropertyModifications" | "receivedPropertyModifications"
  | "sentEvents" | "receivedEvents" | "sentErrors" | "receivedErrors"
  | "bytesPerSecond" | "packetsPerSecond" | "notificationsPerSecond"
  | "propertyModificationsPerSecond" | "eventsPerSecond"
>;

type Counters = {
  sentBytes: number; receivedBytes: number; sentPackets: number; receivedPackets: number;
  sentRequests: number; receivedRequests: number; sentReplies: number; receivedReplies: number;
  sentNotifications: number; receivedNotifications: number;
  sentPropertyModifications: number; receivedPropertyModifications: number;
  sentEvents: number; receivedEvents: number; sentErrors: number; receivedErrors: number;
};

const emptyCounters = (): Counters => ({
  sentBytes: 0, receivedBytes: 0, sentPackets: 0, receivedPackets: 0,
  sentRequests: 0, receivedRequests: 0, sentReplies: 0, receivedReplies: 0,
  sentNotifications: 0, receivedNotifications: 0,
  sentPropertyModifications: 0, receivedPropertyModifications: 0,
  sentEvents: 0, receivedEvents: 0, sentErrors: 0, receivedErrors: 0,
});

/** Internal counter store used only while connection monitoring is enabled. */
export class EpConnectionMetricsCollector {
  readonly startedAt = new Date();
  private readonly counters = emptyCounters();
  private previous = emptyCounters();
  private previousSampledAt = this.startedAt.getTime();

  sent(bytes: number): void { this.counters.sentBytes += bytes; this.counters.sentPackets++; }
  received(bytes: number): void { this.counters.receivedBytes += bytes; }
  sentRequest(): void { this.counters.sentRequests++; }
  sentReply(error: boolean): void {
    this.counters.sentReplies++;
    if (error) this.counters.sentErrors++;
  }
  sentNotification(propertyModified: boolean, eventOccurred: boolean): void {
    this.counters.sentNotifications++;
    if (propertyModified) this.counters.sentPropertyModifications++;
    if (eventOccurred) this.counters.sentEvents++;
  }
  receivedPacket(method: "request" | "reply" | "notification", detail?: "property" | "event" | "error"): void {
    this.counters.receivedPackets++;
    if (method === "request") this.counters.receivedRequests++;
    else if (method === "reply") {
      this.counters.receivedReplies++;
      if (detail === "error") this.counters.receivedErrors++;
    } else {
      this.counters.receivedNotifications++;
      if (detail === "property") this.counters.receivedPropertyModifications++;
      if (detail === "event") this.counters.receivedEvents++;
    }
  }

  snapshot(state: EpConnectionRuntimeState): EpConnectionRuntimeMetricsSnapshot {
    const sampledAt = new Date();
    const now = sampledAt.getTime();
    const elapsedSeconds = Math.max((now - this.previousSampledAt) / 1000, 0.001);
    const delta = (key: keyof Counters) => (this.counters[key] - this.previous[key]) / elapsedSeconds;
    const snapshot: EpConnectionRuntimeMetricsSnapshot = {
      enabled: true,
      startedAt: this.startedAt,
      sampledAt,
      monitoringDurationMilliseconds: now - this.startedAt.getTime(),
      ...this.counters,
      bytesPerSecond: delta("sentBytes") + delta("receivedBytes"),
      packetsPerSecond: delta("sentPackets") + delta("receivedPackets"),
      notificationsPerSecond: delta("sentNotifications") + delta("receivedNotifications"),
      propertyModificationsPerSecond: delta("sentPropertyModifications") + delta("receivedPropertyModifications"),
      eventsPerSecond: delta("sentEvents") + delta("receivedEvents"),
      ...state,
    };
    this.previous = { ...this.counters };
    this.previousSampledAt = now;
    return snapshot;
  }
}

export function disabledEpConnectionMetrics(state: EpConnectionRuntimeState): EpConnectionRuntimeMetricsSnapshot {
  return {
    enabled: false, startedAt: null, sampledAt: new Date(), monitoringDurationMilliseconds: 0,
    ...emptyCounters(), bytesPerSecond: 0, packetsPerSecond: 0, notificationsPerSecond: 0,
    propertyModificationsPerSecond: 0, eventsPerSecond: 0, ...state,
  };
}
