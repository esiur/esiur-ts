import { PlainTdu } from "../../data/PlainTdu.js";
import { TduClass } from "../../data/TduClass.js";
import { merge, uint32ToBytes, getUint32 } from "../../data/DC.js";
import { EpPacketMethod } from "./EpPacketMethod.js";
import type { EpPacketRequest } from "./EpPacketRequest.js";
import type { EpPacketReply } from "./EpPacketReply.js";
import type { EpPacketNotification } from "./EpPacketNotification.js";

/**
 * An IIP/Ep protocol packet (port of C# `EpPacket`).
 *
 * Wire layout — header byte `[method:2][hasTDU:1][action:5]`, then a 4-byte
 * little-endian callback id for Request/Reply, then an optional self-describing
 * TDU (measured via {@link PlainTdu}, decoded later with connection context).
 */
export class EpPacket {
  method: EpPacketMethod = EpPacketMethod.Notification;
  /** The action in the low 5 bits (an EpPacketRequest/Reply/Notification or extension byte). */
  action = 0;
  callbackId = 0;
  hasTdu = false;
  tdu: PlainTdu | null = null;

  private dataLengthNeeded = 0;

  get request(): EpPacketRequest {
    return this.action;
  }
  get reply(): EpPacketReply {
    return this.action;
  }
  get notification(): EpPacketNotification {
    return this.action;
  }

  private notEnough(offset: number, ends: number, needed: number): boolean {
    if (offset + needed > ends) {
      this.dataLengthNeeded = needed - (ends - offset);
      return true;
    }
    return false;
  }

  /**
   * Parse a packet from `data[offset..ends]`. Returns the number of bytes
   * consumed, or a negative value (`-bytesStillNeeded`) if the buffer is short.
   */
  parse(data: Uint8Array, offset: number, ends: number): number {
    const start = offset;

    if (this.notEnough(offset, ends, 1)) return -this.dataLengthNeeded;

    const header = data[offset++];
    this.hasTdu = (header & 0x20) === 0x20;
    this.method = (header >> 6) as EpPacketMethod;
    this.action = header & 0x1f;

    if (this.method === EpPacketMethod.Request || this.method === EpPacketMethod.Reply) {
      if (this.notEnough(offset, ends, 4)) return -this.dataLengthNeeded;
      this.callbackId = getUint32(data, offset);
      offset += 4;
    }

    if (this.hasTdu) {
      if (this.notEnough(offset, ends, 1)) return -this.dataLengthNeeded;
      this.tdu = PlainTdu.parse(data, offset, ends);
      if (this.tdu.tduClass === TduClass.Invalid) return -this.tdu.totalLength;
      offset += this.tdu.totalLength;
    } else {
      this.tdu = null;
    }

    return offset - start;
  }

  // ---- compose helpers --------------------------------------------------------

  private static header(method: EpPacketMethod, action: number, hasTdu: boolean): number {
    return ((method << 6) | (hasTdu ? 0x20 : 0) | (action & 0x1f)) & 0xff;
  }

  /** Build a Request packet. */
  static composeRequest(action: EpPacketRequest, callbackId: number, tdu?: Uint8Array): Uint8Array {
    return merge(
      Uint8Array.of(EpPacket.header(EpPacketMethod.Request, action, tdu != null)),
      uint32ToBytes(callbackId),
      tdu ?? new Uint8Array(0),
    );
  }

  /** Build a Reply packet. */
  static composeReply(action: EpPacketReply, callbackId: number, tdu?: Uint8Array): Uint8Array {
    return merge(
      Uint8Array.of(EpPacket.header(EpPacketMethod.Reply, action, tdu != null)),
      uint32ToBytes(callbackId),
      tdu ?? new Uint8Array(0),
    );
  }

  /** Build a Notification packet. */
  static composeNotification(action: EpPacketNotification, tdu?: Uint8Array): Uint8Array {
    return merge(
      Uint8Array.of(EpPacket.header(EpPacketMethod.Notification, action, tdu != null)),
      tdu ?? new Uint8Array(0),
    );
  }
}
