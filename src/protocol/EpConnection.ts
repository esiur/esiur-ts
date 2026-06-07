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
import { compose, parse, parseSync } from "../data/Codec.js";
import { merge } from "../data/DC.js";
import { typedMap } from "../data/descriptors.js";
import { t } from "../data/descriptors.js";
import { u8 } from "../data/widths.js";
import { ResourceId } from "../data/ResourceId.js";
import { WSocket } from "../net/sockets/WSocket.js";
import { EpAuthPacket } from "../net/packets/EpAuthPacket.js";
import { EpAuthPacketCommand } from "../net/packets/EpAuthPacketCommand.js";
import { EpAuthPacketMethod } from "../net/packets/EpAuthPacketMethod.js";
import { EpAuthPacketHeader } from "../net/packets/EpAuthPacketHeader.js";
import { AuthenticationMode } from "../security/AuthenticationMode.js";
import { EncryptionMode } from "../security/EncryptionMode.js";
import type { Warehouse } from "../resource/Warehouse.js";
import type { TypeTemplate } from "../resource/template.js";
import { EpResource, type RemotePropertyValue } from "./EpResource.js";
import { RemoteTypeDef } from "./RemoteTypeDef.js";

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

export interface EpConnectionOptions {
  /** Reconnect automatically after an unexpected client-side disconnect. */
  autoReconnect?: boolean;
  /** Delay between reconnect attempts, in milliseconds. */
  reconnectInterval?: number;
}

export interface EpReconnectMetrics {
  connectMs: number;
  reattachMs: number;
  recoveryMs: number;
  restoredResources: number;
  failedResources: number;
}

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

  /** Remote resources attached through this connection (instance id → proxy state). */
  private readonly attachedResources = new Map<number, EpResource>();
  /** Server-side notification subscriptions (instance id → unsubscribe). */
  private readonly subscriptions = new Map<number, () => void>();

  // ---- handshake --------------------------------------------------------------

  /**
   * True once the connection is past the auth phase. Defaults to true so a
   * directly-`assign`ed connection processes packets immediately; `connect` and
   * `EpServer` switch it off to run the (anonymous) handshake first.
   */
  private authenticated = true;
  private direction: "initiator" | "responder" | null = null;
  private readonly authPacket = new EpAuthPacket();
  private readyReply?: AsyncReply;
  private domain = "";
  /** Responder: accept unauthenticated (anonymous, None-mode) peers. */
  allowUnauthorized = true;
  /** Reconnect automatically after an unexpected client-side disconnect. */
  autoReconnect = false;
  /** Delay between reconnect attempts, in milliseconds. */
  reconnectInterval = 5000;
  /** Metrics from the most recent reconnect attempt. */
  lastReconnectMetrics?: EpReconnectMetrics;

  private reconnectUrl?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectReply?: AsyncReply<boolean>;
  private manualClose = false;
  private lastRestoreStats = { restored: 0, failed: 0 };

  /** Begin the client-side handshake; resolves via {@link whenReady}. */
  startInitiatorHandshake(domain = ""): void {
    this.authenticated = false;
    this.direction = "initiator";
    this.domain = domain;
    this.readyReply = new AsyncReply();
  }

  /** Begin the server-side handshake (waits for the peer's Initialize). */
  startResponderHandshake(): void {
    this.authenticated = false;
    this.direction = "responder";
  }

  /** Resolves when the handshake completes (initiator side). */
  whenReady(): AsyncReply {
    return this.readyReply ?? AsyncReply.fromResult(true);
  }

  /**
   * Open a client connection to `url` over WebSocket, run the anonymous
   * handshake, and resolve once the session is established.
   */
  static async connect(
    url: string,
    warehouseOrOptions?: Warehouse | EpConnectionOptions,
    options?: EpConnectionOptions,
  ): Promise<EpConnection> {
    const connection = new EpConnection();
    const config = isConnectionOptions(warehouseOrOptions) ? warehouseOrOptions : options;
    if (!isConnectionOptions(warehouseOrOptions) && warehouseOrOptions)
      connection.warehouse = warehouseOrOptions;
    connection.applyOptions(config);
    await connection.openClientSocket(url);
    return connection;
  }

  private applyOptions(options?: EpConnectionOptions): void {
    if (!options) return;
    if (options.autoReconnect != null) this.autoReconnect = options.autoReconnect;
    if (options.reconnectInterval != null) this.reconnectInterval = options.reconnectInterval;
  }

  private async openClientSocket(url: string): Promise<void> {
    this.reconnectUrl = url;
    this.manualClose = false;
    try {
      this.domain = new URL(url).hostname;
    } catch {
      /* leave domain empty */
    }
    this.startInitiatorHandshake(this.domain);

    const socket = new WSocket();
    this.assign(socket);
    await socket.connect(url);
    await this.whenReady();
  }

  /** Send the initiator's Initialize packet (anonymous, None auth/encryption). */
  private declare(): void {
    const headers = compose(
      typedMap(t.u8, t.dynamic, [[u8(EpAuthPacketHeader.Domain), this.domain]]),
      this.warehouse,
      this,
    );
    this.send(
      EpAuthPacket.composeInitialize(AuthenticationMode.None, EncryptionMode.None, headers),
    );
  }

  /** Handle an auth-phase packet (anonymous handshake only). */
  private handleAuthPacket(packet: EpAuthPacket): void {
    if (packet.command === EpAuthPacketCommand.Initialize) {
      // Responder: accept an anonymous peer and establish the session.
      if (packet.authMode === AuthenticationMode.None && this.allowUnauthorized) {
        const headers = compose(typedMap(t.u8, t.dynamic, []), this.warehouse, this);
        this.send(EpAuthPacket.composeMethod(EpAuthPacketMethod.SessionEstablished, headers));
        this.authenticated = true;
      } else {
        this.send(EpAuthPacket.composeMethod(EpAuthPacketMethod.ErrorTerminate));
        this.close();
      }
    } else if (
      packet.command === EpAuthPacketCommand.Acknowledge &&
      packet.method === EpAuthPacketMethod.SessionEstablished
    ) {
      // Initiator: the session is established.
      this.authenticated = true;
      this.readyReply?.trigger(true);
    }
  }

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
    // The member index is a byte (UInt8) on the wire — C# casts it as `(byte)`.
    return this.sendRequest(EpPacketRequest.InvokeFunction, instanceId, u8(index), args);
  }

  /** Set property `index` on the resource with `instanceId`. */
  set(instanceId: number, index: number, value: unknown): AsyncReply {
    return this.sendRequest(EpPacketRequest.SetProperty, instanceId, u8(index), value);
  }

  /** Resolve a resource path to a {@link ResourceId} reference. */
  getResourceIdByLink(link: string): AsyncReply {
    return this.sendRequest(EpPacketRequest.GetResourceIdByLink, link);
  }

  /** Fetch and parse the runtime TypeDef for a remote resource id. */
  fetchTypeDefByResourceId(instanceId: number): AsyncReply<RemoteTypeDef> {
    return this.sendRequest(EpPacketRequest.TypeDefByResourceId, instanceId).then((reply) => {
      if (!(reply instanceof Uint8Array))
        throw new AsyncException(
          ErrorType.Management,
          ExceptionCode.ParseError,
          "TypeDefByResourceId did not return a raw TypeDef payload.",
        );
      return RemoteTypeDef.parse(reply, this.warehouse);
    });
  }

  /** Fetch and parse a runtime TypeDef by its remote TypeDef id. */
  fetchTypeDefById(typeDefId: number): AsyncReply<RemoteTypeDef> {
    return this.sendRequest(EpPacketRequest.TypeDefById, typeDefId).then((reply) => {
      if (!(reply instanceof Uint8Array))
        throw new AsyncException(
          ErrorType.Management,
          ExceptionCode.ParseError,
          "TypeDefById did not return a raw TypeDef payload.",
        );
      return RemoteTypeDef.parse(reply, this.warehouse);
    });
  }

  /** Resolve and attach a remote resource by its path on this connection. */
  get(path: string, template?: TypeTemplate): AsyncReply {
    return this.getResourceIdByLink(path).then((resourceRef) => {
      const instanceId = toInstanceId(resourceRef);
      if (instanceId == null)
        throw new AsyncException(
          ErrorType.Management,
          ExceptionCode.ResourceNotFound,
          `Remote resource '${path}' was not found.`,
        );
      if (!template) return resourceRef;
      return this.attach(instanceId, template);
    });
  }

  /** Reopen the WebSocket session and reattach all known remote resources. */
  reconnect(): AsyncReply<boolean> {
    if (!this.reconnectUrl) {
      const reply = new AsyncReply<boolean>();
      reply.triggerError(
        new AsyncException(ErrorType.Management, ExceptionCode.HostNotReachable, "No reconnect URL."),
      );
      return reply;
    }
    if (this.reconnectReply) return this.reconnectReply;

    const reply = new AsyncReply<boolean>();
    this.reconnectReply = reply;
    (async () => {
      const started = nowMs();
      try {
        await this.openClientSocket(this.reconnectUrl!);
        const connected = nowMs();
        await this.restoreAttachedResources();
        const finished = nowMs();
        this.lastReconnectMetrics = {
          connectMs: connected - started,
          reattachMs: finished - connected,
          recoveryMs: finished - started,
          restoredResources: this.lastRestoreStats.restored,
          failedResources: this.lastRestoreStats.failed,
        };
        reply.trigger(true);
      } catch (e) {
        reply.triggerError(AsyncException.from(e));
      } finally {
        if (this.reconnectReply === reply) this.reconnectReply = undefined;
      }
    })();
    return reply;
  }

  /**
   * Attach to a remote resource, returning a dynamic {@link EpResource} proxy
   * primed with current property values and kept fresh by notifications. The
   * caller supplies the resource's {@link TypeTemplate} (e.g. from generated
   * stubs); a server build resolves it from the warehouse.
   */
  attach(instanceId: number, template: TypeTemplate): AsyncReply {
    return this.sendRequest(EpPacketRequest.AttachResource, instanceId).then((reply) => {
      // Reply: [typeDefId, age, link, hops, propertyValues] (matches C#). The
      // 5th element is a RawData blob of (age, date, value) self-describing TDUs,
      // one triple per property in index order.
      const list = reply as unknown[];
      const typeDefId = asNumber(list[0]);
      const age = asNumber(list[1]);
      const link = String(list[2] ?? "");
      const hops = asNumber(list[3]);
      const raw = list[4] as Uint8Array | undefined;

      const resource = new EpResource(this, instanceId, template, {
        typeDefId,
        age,
        link,
        hops,
      });
      if (raw) {
        const snapshots = this.parsePropertyValueArray(raw, template);
        for (const pv of snapshots)
          resource.setPropertySnapshot(pv.index, pv.age, pv.date, pv.value);
      }

      this.attachedResources.set(instanceId, resource);
      return EpResource.createProxy(resource);
    });
  }

  /**
   * Reattach an already-known resource by sending its last-known age. The peer
   * returns only properties modified after that age.
   */
  reattach(instanceId: number, age: number, resource: EpResource): AsyncReply<EpResource> {
    return this.sendRequest(EpPacketRequest.ReattachResource, instanceId, age).then((reply) => {
      const list = reply as unknown[];
      const oldId = resource.instanceId;
      resource.setRemoteIdentity({
        instanceId,
        typeDefId: asNumber(list[0]),
        age: asNumber(list[1]),
        link: String(list[2] ?? ""),
        hops: asNumber(list[3]),
      });

      const raw = list[4] as Uint8Array | undefined;
      if (raw) resource.applyDelta(this.parsePropertyValueMap(raw));

      if (oldId !== instanceId) this.attachedResources.delete(oldId);
      this.attachedResources.set(instanceId, resource);
      return resource;
    });
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

  private parsePropertyValueArray(raw: Uint8Array, template: TypeTemplate): RemotePropertyValue[] {
    const values: RemotePropertyValue[] = [];
    let offset = 0;
    for (const p of template.properties) {
      const age = parseSync(raw, offset, this.warehouse);
      offset += age.length;
      const date = parseSync(raw, offset, this.warehouse);
      offset += date.length;
      const value = parseSync(raw, offset, this.warehouse);
      offset += value.length;
      values.push({
        index: p.index,
        age: asNumber(age.value),
        date: asDate(date.value),
        value: value.value,
      });
    }
    return values;
  }

  private parsePropertyValueMap(raw: Uint8Array): RemotePropertyValue[] {
    const values: RemotePropertyValue[] = [];
    let offset = 0;
    while (offset < raw.length) {
      const index = parseSync(raw, offset, this.warehouse);
      offset += index.length;
      const age = parseSync(raw, offset, this.warehouse);
      offset += age.length;
      const date = parseSync(raw, offset, this.warehouse);
      offset += date.length;
      const value = parseSync(raw, offset, this.warehouse);
      offset += value.length;
      values.push({
        index: asNumber(index.value),
        age: asNumber(age.value),
        date: asDate(date.value),
        value: value.value,
      });
    }
    return values;
  }

  private composePropertyValueArray(instanceId: number): Uint8Array {
    const resource = this.warehouse?.getById(instanceId);
    if (!resource?.instance) return new Uint8Array(0);

    const instance = resource.instance;
    const bag = resource as unknown as Record<string, unknown>;
    const parts: Uint8Array[] = [];
    for (const p of instance.definition.properties) {
      parts.push(compose(instance.getAge(p.index) ?? 0, this.warehouse, this));
      parts.push(compose(instance.getModificationDate(p.index) ?? new Date(0), this.warehouse, this));
      parts.push(compose(bag[p.name], this.warehouse, this));
    }
    return merge(...parts);
  }

  private composePropertyValueMap(instanceId: number, sinceAge: number): Uint8Array {
    const resource = this.warehouse?.getById(instanceId);
    if (!resource?.instance) return new Uint8Array(0);

    const instance = resource.instance;
    const bag = resource as unknown as Record<string, unknown>;
    const parts: Uint8Array[] = [];
    for (const p of instance.definition.properties) {
      const propertyAge = instance.getAge(p.index) ?? 0;
      if (propertyAge <= sinceAge) continue;
      parts.push(compose(u8(p.index), this.warehouse, this));
      parts.push(compose(propertyAge, this.warehouse, this));
      parts.push(compose(instance.getModificationDate(p.index) ?? new Date(0), this.warehouse, this));
      parts.push(compose(bag[p.name], this.warehouse, this));
    }
    return merge(...parts);
  }

  private async restoreAttachedResources(): Promise<void> {
    const resources = [...this.attachedResources.values()];
    const stats = { restored: 0, failed: 0 };
    for (const resource of resources) {
      let instanceId = resource.instanceId;
      if (resource.link) {
        try {
          const resolved = await this.getResourceIdByLink(resource.link);
          instanceId = toInstanceId(resolved) ?? instanceId;
        } catch (e) {
          if (AsyncException.from(e).code === ExceptionCode.ResourceNotFound) {
            stats.failed++;
            continue;
          }
          throw e;
        }
      }

      try {
        if (instanceId !== resource.instanceId) {
          this.attachedResources.delete(resource.instanceId);
          resource.instanceId = instanceId;
        }
        await this.reattach(instanceId, resource.age, resource);
        stats.restored++;
      } catch (e) {
        if (AsyncException.from(e).code === ExceptionCode.ResourceNotFound) {
          stats.failed++;
          continue;
        }
        throw e;
      }
    }
    this.lastRestoreStats = stats;
  }

  // ---- inbound ----------------------------------------------------------------

  protected override dataReceived(buffer: NetworkBuffer): void {
    const msg = buffer.read();
    if (!msg) return;

    let offset = 0;
    const ends = msg.length;
    while (offset < ends) {
      // Auth phase: consume auth packets until the session is established; the
      // handshake may finish mid-buffer and the rest continues as Ep packets.
      if (!this.authenticated) {
        const consumed = this.authPacket.parse(msg, offset, ends);
        if (consumed <= 0) {
          const size = ends - offset;
          buffer.holdFor(msg, offset, size, size + -consumed);
          return;
        }
        offset += consumed;
        this.handleAuthPacket(this.authPacket);
        continue;
      }

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
        this.processNotification(packet.notification, packet.tdu);
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
        case EpPacketRequest.AttachResource:
          this.epRequestAttachResource(callbackId, tdu);
          return;
        case EpPacketRequest.ReattachResource:
          this.epRequestReattachResource(callbackId, tdu);
          return;
        case EpPacketRequest.GetResourceIdByLink:
          this.epRequestGetResourceIdByLink(callbackId, tdu);
          return;
      }
    }
    this.onRequest?.(this, action, callbackId, tdu);
  }

  /** Server handler: send current property values and subscribe the peer to changes. */
  private epRequestAttachResource(callbackId: number, tdu: PlainTdu | null): void {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const instanceId = Number(this.decode(tdu));
    const resource = this.warehouse.getById(instanceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    const instance = resource.instance;
    const propertyValues = this.composePropertyValueArray(instanceId);

    const typeDef = this.warehouse.getLocalTypeDefByType(resource.constructor);

    this.subscribeToInstance(instanceId);

    this.sendReply(
      EpPacketReply.Completed,
      callbackId,
      typeDef.id,
      instance.age,
      instance.link ?? "",
      0, // hops
      propertyValues,
    );
  }

  /** Server handler: send only properties modified after the caller's known age. */
  private epRequestReattachResource(callbackId: number, tdu: PlainTdu | null): void {
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

    const instanceId = Number(parsed[0]);
    const sinceAge = asNumber(parsed[1]);
    const resource = this.warehouse.getById(instanceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    const instance = resource.instance;
    const typeDef = this.warehouse.getLocalTypeDefByType(resource.constructor);
    const propertyValues = this.composePropertyValueMap(instanceId, sinceAge);
    this.subscribeToInstance(instanceId);

    this.sendReply(
      EpPacketReply.Completed,
      callbackId,
      typeDef.id,
      instance.age,
      instance.link ?? "",
      0,
      propertyValues,
    );
  }

  /** Server handler: resolve a resource path to an instance id. */
  private epRequestGetResourceIdByLink(callbackId: number, tdu: PlainTdu | null): void {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const link = String(this.decode(tdu) ?? "");
    this.warehouse.query(link).then(
      (resource) => {
        if (!resource?.instance) {
          this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
          return;
        }
        this.sendReply(EpPacketReply.Completed, callbackId, resource.instance.id);
      },
      () => this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound),
    );
  }

  private subscribeToInstance(instanceId: number): void {
    const resource = this.warehouse?.getById(instanceId);
    if (!resource?.instance || this.subscriptions.has(instanceId)) return;

    const instance = resource.instance;
    const onProp = (info: { property: { index: number }; value: unknown }): void =>
      this.sendNotification(
        EpPacketNotification.PropertyModified,
        instanceId,
        info.property.index,
        info.value,
      );
    const onEvent = (info: { event: { index: number }; value: unknown }): void =>
      this.sendNotification(
        EpPacketNotification.EventOccurred,
        instanceId,
        info.event.index,
        info.value,
      );
    instance.propertyModified.add(onProp);
    instance.eventOccurred.add(onEvent);
    this.subscriptions.set(instanceId, () => {
      instance.propertyModified.remove(onProp);
      instance.eventOccurred.remove(onEvent);
    });
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

  /** Route an inbound notification to a built-in handler, or fall back to {@link onNotification}. */
  private processNotification(action: EpPacketNotification, tdu: PlainTdu | null): void {
    switch (action) {
      case EpPacketNotification.PropertyModified: {
        const a = (this.decode(tdu) as unknown[]) ?? [];
        this.attachedResources
          .get(Number(a[0]))
          ?.updateProperty(Number(a[1]), a[2]);
        return;
      }
      case EpPacketNotification.EventOccurred: {
        const a = (this.decode(tdu) as unknown[]) ?? [];
        this.attachedResources.get(Number(a[0]))?.applyEvent(Number(a[1]), a[2]);
        return;
      }
    }
    this.onNotification?.(this, action, tdu);
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

  protected override connected(): void {
    if (this.direction === "initiator" && !this.authenticated) this.declare();
  }

  override close(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    super.close();
  }

  override destroy(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    super.destroy();
  }

  protected override disconnected(): void {
    // Fail a pending handshake.
    this.readyReply?.triggerError(
      new AsyncException(ErrorType.Management, 1, "Connection closed during handshake."),
    );
    // Drop notification subscriptions and fail any in-flight requests.
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();

    const pending = [...this.requests.values()];
    this.requests.clear();
    for (const req of pending)
      req.triggerError(
        new AsyncException(ErrorType.Management, 1, "Connection closed."),
      );

    if (this.shouldAutoReconnect()) this.scheduleReconnect();
  }

  private shouldAutoReconnect(): boolean {
    return (
      this.autoReconnect &&
      !this.manualClose &&
      this.direction === "initiator" &&
      this.reconnectUrl != null
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.reconnectReply || !this.shouldAutoReconnect()) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnect().then(
        () => undefined,
        () => this.scheduleReconnect(),
      );
    }, Math.max(0, this.reconnectInterval));
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function isConnectionOptions(value: unknown): value is EpConnectionOptions {
  if (value == null || typeof value !== "object") return false;
  const keys = value as Record<string, unknown>;
  return "autoReconnect" in keys || "reconnectInterval" in keys;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Number) return Number(value.valueOf());
  return Number(value ?? 0);
}

function asDate(value: unknown): Date | undefined {
  return value instanceof Date ? value : undefined;
}

function toInstanceId(value: unknown): number | undefined {
  if (value instanceof ResourceId) return value.id;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof EpResource) return value.instanceId;

  const maybe = value as
    | { id?: unknown; instanceId?: unknown; instance?: { id?: unknown } }
    | undefined;
  if (!maybe || typeof maybe !== "object") return undefined;
  if (maybe.instanceId != null) return asNumber(maybe.instanceId);
  if (maybe.id != null) return asNumber(maybe.id);
  if (maybe.instance?.id != null) return asNumber(maybe.instance.id);
  return undefined;
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}
