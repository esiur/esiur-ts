import { AsyncReply } from "../core/AsyncReply.js";
import { AsyncException } from "../core/AsyncException.js";
import { ErrorType } from "../core/ErrorType.js";
import { ExceptionCode } from "../core/ExceptionCode.js";
import { ProgressType } from "../core/ProgressType.js";
import { NetworkConnection } from "../net/NetworkConnection.js";
import type { NetworkBuffer } from "../net/NetworkBuffer.js";
import { EpPacket } from "../net/packets/EpPacket.js";
import { EpPacketMethod } from "../net/packets/EpPacketMethod.js";
import { EpPacketRequest } from "../net/packets/EpPacketRequest.js";
import { EpPacketReply } from "../net/packets/EpPacketReply.js";
import { EpPacketNotification } from "../net/packets/EpPacketNotification.js";
import type { PlainTdu } from "../data/PlainTdu.js";
import { compose, parse } from "../data/Codec.js";
import type { Warehouse } from "../resource/Warehouse.js";

/** Handles an inbound request packet (server-side dispatch). */
export type RequestHandler = (
  connection: EpConnection,
  action: EpPacketRequest,
  callbackId: number,
  tdu: PlainTdu | null,
) => void;

/** Handles an inbound notification packet. */
export type NotificationHandler = (
  connection: EpConnection,
  action: EpPacketNotification,
  tdu: PlainTdu | null,
) => void;

/**
 * IIP/Ep connection — request/reply correlation and packet dispatch
 * (the backbone of C# `EpConnection`/`EpConnectionProtocol`).
 *
 * This build implements the request/reply engine and reply decoding. The full
 * resource operations (attach/get/set/invoke handlers), the authentication
 * handshake, and the remote-resource proxy are layered on next; for now incoming
 * requests/notifications are surfaced via {@link onRequest}/{@link onNotification}
 * so the engine can be driven and tested end-to-end.
 */
export class EpConnection extends NetworkConnection {
  /** Warehouse used to resolve types/resources during (de)serialization. */
  warehouse?: Warehouse;

  /** Invoked for inbound Request packets. */
  onRequest?: RequestHandler;
  /** Invoked for inbound Notification packets. */
  onNotification?: NotificationHandler;

  private readonly requests = new Map<number, AsyncReply>();
  private callbackCounter = 0;
  private readonly packet = new EpPacket();

  // ---- outbound ---------------------------------------------------------------

  /** Send a request and return a reply that settles when the peer responds. */
  sendRequest(action: EpPacketRequest, ...args: unknown[]): AsyncReply {
    const reply = new AsyncReply();
    const callbackId = ++this.callbackCounter;
    this.requests.set(callbackId, reply);
    this.send(EpPacket.composeRequest(action, callbackId, this.composeArgs(args)));
    return reply;
  }

  /** Invoke function `index` on the resource with `instanceId`, resolving its result. */
  invoke(instanceId: number, index: number, ...args: unknown[]): AsyncReply {
    return this.sendRequest(EpPacketRequest.InvokeFunction, instanceId, index, args);
  }

  /** Set property `index` on the resource with `instanceId`. */
  set(instanceId: number, index: number, value: unknown): AsyncReply {
    return this.sendRequest(EpPacketRequest.SetProperty, instanceId, index, value);
  }

  /** Send a reply to a peer request. */
  sendReply(action: EpPacketReply, callbackId: number, ...args: unknown[]): void {
    this.send(EpPacket.composeReply(action, callbackId, this.composeArgs(args)));
  }

  /** Send a notification (no reply expected). */
  sendNotification(action: EpPacketNotification, ...args: unknown[]): void {
    this.send(EpPacket.composeNotification(action, this.composeArgs(args)));
  }

  /** Send an error/warning reply. */
  sendError(type: ErrorType, callbackId: number, code: number, message = ""): void {
    if (type === ErrorType.Management)
      this.sendReply(EpPacketReply.PermissionError, callbackId, code, message);
    else if (type === ErrorType.Exception)
      this.sendReply(EpPacketReply.ExecutionError, callbackId, code, message);
    else this.sendReply(EpPacketReply.Warning, callbackId, code, message);
  }

  sendProgress(callbackId: number, value: number, max: number): void {
    this.sendReply(EpPacketReply.Progress, callbackId, value, max);
  }

  /** Encode request/reply arguments: one value as-is, multiple as a list, none → no TDU. */
  private composeArgs(args: unknown[]): Uint8Array | undefined {
    if (args.length === 0) return undefined;
    if (args.length === 1) return compose(args[0], this.warehouse, this);
    return compose(args, this.warehouse, this);
  }

  // ---- inbound ----------------------------------------------------------------

  protected override dataReceived(buffer: NetworkBuffer): void {
    const msg = buffer.read();
    if (!msg) return;

    let offset = 0;
    const ends = msg.length;
    while (offset < ends) {
      const consumed = this.packet.parse(msg, offset, ends);
      if (consumed <= 0) {
        const size = ends - offset;
        buffer.holdFor(msg, offset, size, size + -consumed);
        return;
      }
      offset += consumed;
      this.dispatch(this.packet);
    }
  }

  private dispatch(packet: EpPacket): void {
    switch (packet.method) {
      case EpPacketMethod.Reply:
        this.dispatchReply(packet);
        break;
      case EpPacketMethod.Request:
        this.processRequest(packet.request, packet.callbackId, packet.tdu);
        break;
      case EpPacketMethod.Notification:
        this.onNotification?.(this, packet.notification, packet.tdu);
        break;
      case EpPacketMethod.Extension:
        break;
    }
  }

  /** Route an inbound request to a built-in handler, or fall back to {@link onRequest}. */
  private processRequest(action: EpPacketRequest, callbackId: number, tdu: PlainTdu | null): void {
    if (this.warehouse) {
      switch (action) {
        case EpPacketRequest.InvokeFunction:
          this.epRequestInvokeFunction(callbackId, tdu);
          return;
        case EpPacketRequest.SetProperty:
          this.epRequestSetProperty(callbackId, tdu);
          return;
      }
    }
    this.onRequest?.(this, action, callbackId, tdu);
  }

  /** Server handler: resolve the resource, invoke the function by index, reply with its result. */
  private epRequestInvokeFunction(callbackId: number, tdu: PlainTdu | null): void {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    let parsed: unknown[];
    try {
      parsed = this.decode(tdu) as unknown[];
    } catch {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const resourceId = Number(parsed[0]);
    const index = Number(parsed[1]);
    const args = (parsed[2] as unknown[]) ?? [];

    const resource = this.warehouse.getById(resourceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    const ft = resource.instance.definition.getFunctionByIndex(index);
    if (!ft) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.MethodNotFound);
      return;
    }

    let result: unknown;
    try {
      result = (resource as unknown as Record<string, (...a: unknown[]) => unknown>)[ft.name](
        ...args,
      );
    } catch (e) {
      this.sendError(ErrorType.Exception, callbackId, ExceptionCode.RuntimeException, String(e));
      return;
    }

    if (isThenable(result)) {
      result.then(
        (r) => this.sendReply(EpPacketReply.Completed, callbackId, r),
        (e) =>
          this.sendError(ErrorType.Exception, callbackId, ExceptionCode.RuntimeException, String(e)),
      );
    } else {
      this.sendReply(EpPacketReply.Completed, callbackId, result);
    }
  }

  /** Server handler: resolve the resource and set a property by index. */
  private epRequestSetProperty(callbackId: number, tdu: PlainTdu | null): void {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const parsed = this.decode(tdu) as unknown[];
    const resourceId = Number(parsed[0]);
    const index = Number(parsed[1]);
    const value = parsed[2];

    const resource = this.warehouse.getById(resourceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    const pt = resource.instance.definition.getPropertyByIndex(index);
    if (!pt) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.PropertyNotFound);
      return;
    }

    (resource as unknown as Record<string, unknown>)[pt.name] = value;
    this.sendReply(EpPacketReply.Completed, callbackId);
  }

  private dispatchReply(packet: EpPacket): void {
    const { callbackId, tdu } = packet;
    switch (packet.reply) {
      case EpPacketReply.Completed:
        this.replyCompleted(callbackId, tdu);
        break;
      case EpPacketReply.Propagated:
        this.replyPropagated(callbackId, tdu);
        break;
      case EpPacketReply.PermissionError:
        this.replyError(callbackId, tdu, ErrorType.Management);
        break;
      case EpPacketReply.ExecutionError:
        this.replyError(callbackId, tdu, ErrorType.Exception);
        break;
      case EpPacketReply.Progress:
        this.replyProgress(callbackId, tdu);
        break;
    }
  }

  private decode(tdu: PlainTdu | null): unknown {
    return tdu ? parse(tdu.data, tdu.tduOffset, this.warehouse) : undefined;
  }

  private replyCompleted(callbackId: number, tdu: PlainTdu | null): void {
    const req = this.requests.get(callbackId);
    if (!req) return;
    this.requests.delete(callbackId);
    req.trigger(this.decode(tdu));
  }

  private replyPropagated(callbackId: number, tdu: PlainTdu | null): void {
    this.requests.get(callbackId)?.triggerPropagation(this.decode(tdu));
  }

  private replyError(callbackId: number, tdu: PlainTdu | null, type: ErrorType): void {
    const req = this.requests.get(callbackId);
    if (!req) return;
    this.requests.delete(callbackId);
    const args = (this.decode(tdu) as unknown[]) ?? [];
    req.triggerError(new AsyncException(type, Number(args[0] ?? 0), String(args[1] ?? "")));
  }

  private replyProgress(callbackId: number, tdu: PlainTdu | null): void {
    const args = (this.decode(tdu) as unknown[]) ?? [];
    this.requests
      .get(callbackId)
      ?.triggerProgress(ProgressType.Execution, Number(args[0] ?? 0), Number(args[1] ?? 0));
  }

  protected override connected(): void {}
  protected override disconnected(): void {
    // Fail any in-flight requests when the connection drops.
    const pending = [...this.requests.values()];
    this.requests.clear();
    for (const req of pending)
      req.triggerError(
        new AsyncException(ErrorType.Management, 1, "Connection closed."),
      );
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
