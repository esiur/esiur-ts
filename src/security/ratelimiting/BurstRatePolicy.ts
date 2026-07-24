import type { EpConnection } from "../../protocol/EpConnection.js";
import { Ruling } from "../permissions/Ruling.js";
import { RateControlContext, RatePolicy } from "./RatePolicy.js";

interface Bucket {
  tokens: number;
  lastTimestamp: number;
  queued: number;
}

/**
 * Per-connection, per-member token-bucket policy with bounded delayed
 * reservations (port of C# `BurstRatePolicy`).
 *
 * Buckets are scoped per `EpConnection` via a `WeakMap` (the GC-friendly
 * analogue of C#'s `ConditionalWeakTable<object, ConnectionBuckets>` —
 * entries are dropped automatically once a connection is no longer
 * referenced elsewhere). Timestamps use `performance.now()` (monotonic,
 * sub-millisecond, available in both Node and browsers) in place of
 * `Stopwatch.GetTimestamp()`; all durations are in milliseconds rather than
 * `TimeSpan`. JS's single-threaded event loop makes C#'s per-bucket `lock`
 * unnecessary — nothing here awaits mid-mutation.
 */
export class BurstRatePolicy extends RatePolicy {
  /** Number of permits replenished during each {@link period}. */
  permitLimit = 100;
  /** Replenishment period, in milliseconds. */
  period = 1000;
  /** Additional permits available for an immediate burst. */
  burstLimit = 0;
  /**
   * Maximum number of delayed reservations per connection and member.
   * Further requests are denied until queue positions become available.
   */
  queueLimit = 0;

  private readonly connections = new WeakMap<EpConnection, Map<string, Bucket>>();

  constructor(name: string = "") {
    super(name);
  }

  override applicable(context?: RateControlContext): Ruling {
    if (!context) return Ruling.DontCare;
    this.validate();

    const capacity = this.permitLimit + this.burstLimit;
    const now = performance.now();
    const key = `${context.action}:${memberKey(context)}`;

    let buckets = this.connections.get(context.connection);
    if (!buckets) {
      buckets = new Map();
      this.connections.set(context.connection, buckets);
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastTimestamp: now, queued: 0 };
      buckets.set(key, bucket);
    }

    this.replenish(bucket, now, capacity);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return Ruling.Allowed;
    }

    if (this.queueLimit === 0 || bucket.queued >= this.queueLimit) return Ruling.Denied;

    bucket.tokens -= 1;
    bucket.queued++;

    const seconds = (-bucket.tokens * (this.period / 1000)) / this.permitLimit;
    const delayMs = Math.max(0, seconds * 1000);
    context.delay = delayMs;

    void this.releaseQueuePosition(bucket, delayMs);
    return Ruling.Allowed;
  }

  private validate(): void {
    if (this.permitLimit <= 0) throw new Error("permitLimit must be greater than zero.");
    if (this.period <= 0) throw new Error("period must be greater than zero.");
    if (this.burstLimit < 0) throw new Error("burstLimit cannot be negative.");
    if (this.queueLimit < 0) throw new Error("queueLimit cannot be negative.");
  }

  private replenish(bucket: Bucket, now: number, capacity: number): void {
    const elapsedMs = now - bucket.lastTimestamp;
    if (elapsedMs <= 0) return;
    const replenished = (elapsedMs / this.period) * this.permitLimit;
    bucket.tokens = Math.min(capacity, bucket.tokens + replenished);
    bucket.lastTimestamp = now;
  }

  private async releaseQueuePosition(bucket: Bucket, delayMs: number): Promise<void> {
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    if (bucket.queued > 0) bucket.queued--;
  }
}

function memberKey(context: RateControlContext): string {
  const typeName = (context.resource?.constructor as { name?: string } | undefined)?.name ?? "";
  return `${typeName}.${context.member.name}`;
}
