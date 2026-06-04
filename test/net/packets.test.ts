import { describe, it, expect } from "vitest";
import { EpPacket } from "../../src/net/packets/EpPacket.js";
import { EpPacketMethod } from "../../src/net/packets/EpPacketMethod.js";
import { EpPacketRequest } from "../../src/net/packets/EpPacketRequest.js";
import { EpPacketReply } from "../../src/net/packets/EpPacketReply.js";
import { EpPacketNotification } from "../../src/net/packets/EpPacketNotification.js";
import { compose, parse } from "../../src/data/Codec.js";
import * as DC from "../../src/data/DC.js";

function decodeTdu(pkt: EpPacket): unknown {
  return pkt.tdu ? parse(pkt.tdu.data, pkt.tdu.tduOffset) : undefined;
}

describe("EpPacket framing", () => {
  it("round-trips a Request with a TDU payload", () => {
    const bytes = EpPacket.composeRequest(EpPacketRequest.InvokeFunction, 5, compose(42));
    // header 0x60 = method Request(1)<<6 | hasTDU(0x20) | action 0; callbackId 5 LE; TDU "092a"
    expect(DC.toHex(bytes)).toBe("6005000000092a");

    const pkt = new EpPacket();
    const consumed = pkt.parse(bytes, 0, bytes.length);
    expect(consumed).toBe(bytes.length);
    expect(pkt.method).toBe(EpPacketMethod.Request);
    expect(pkt.request).toBe(EpPacketRequest.InvokeFunction);
    expect(pkt.callbackId).toBe(5);
    expect(pkt.hasTdu).toBe(true);
    expect(decodeTdu(pkt)).toBe(42);
  });

  it("round-trips a Reply with a string TDU", () => {
    const bytes = EpPacket.composeReply(EpPacketReply.Completed, 7, compose("hi"));
    const pkt = new EpPacket();
    expect(pkt.parse(bytes, 0, bytes.length)).toBe(bytes.length);
    expect(pkt.method).toBe(EpPacketMethod.Reply);
    expect(pkt.reply).toBe(EpPacketReply.Completed);
    expect(pkt.callbackId).toBe(7);
    expect(decodeTdu(pkt)).toBe("hi");
  });

  it("round-trips a Notification without a callback id", () => {
    const bytes = EpPacket.composeNotification(EpPacketNotification.PropertyModified, compose(true));
    const pkt = new EpPacket();
    expect(pkt.parse(bytes, 0, bytes.length)).toBe(bytes.length);
    expect(pkt.method).toBe(EpPacketMethod.Notification);
    expect(pkt.notification).toBe(EpPacketNotification.PropertyModified);
    expect(decodeTdu(pkt)).toBe(true);
  });

  it("composes a Request without a TDU (hasTDU bit clear)", () => {
    const bytes = EpPacket.composeRequest(EpPacketRequest.KeepAlive, 1);
    expect((bytes[0] & 0x20) === 0).toBe(true);
    const pkt = new EpPacket();
    pkt.parse(bytes, 0, bytes.length);
    expect(pkt.hasTdu).toBe(false);
    expect(pkt.tdu).toBe(null);
  });

  it("reports how many more bytes are needed for a truncated packet", () => {
    const bytes = EpPacket.composeRequest(EpPacketRequest.InvokeFunction, 5, compose(42));
    const pkt = new EpPacket();
    // Only 3 of the 5 header+callback bytes are present.
    expect(pkt.parse(bytes, 0, 3)).toBeLessThan(0);
  });

  it("parses consecutive packets from one buffer", () => {
    const a = EpPacket.composeNotification(EpPacketNotification.EventOccurred, compose(1));
    const b = EpPacket.composeReply(EpPacketReply.Completed, 9, compose("x"));
    const buf = DC.merge(a, b);

    const p1 = new EpPacket();
    const n1 = p1.parse(buf, 0, buf.length);
    expect(decodeTdu(p1)).toBe(1);

    const p2 = new EpPacket();
    const n2 = p2.parse(buf, n1, buf.length);
    expect(p2.callbackId).toBe(9);
    expect(decodeTdu(p2)).toBe("x");
    expect(n1 + n2).toBe(buf.length);
  });
});
