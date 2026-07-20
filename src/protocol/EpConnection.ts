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
import { getUint64, merge } from "../data/DC.js";
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
import { AuthenticationDirection } from "../security/AuthenticationDirection.js";
import { AuthenticationMaterialType } from "../security/AuthenticationMaterialType.js";
import { AuthenticationResult } from "../security/AuthenticationResult.js";
import { AuthenticationRuling } from "../security/AuthenticationRuling.js";
import type { AuthenticationSession } from "../security/AuthenticationSession.js";
import type { IAuthenticationHandler } from "../security/IAuthenticationHandler.js";
import type { IAuthenticationProvider } from "../security/IAuthenticationProvider.js";
import type { Warehouse } from "../resource/Warehouse.js";
import { TypeDef } from "../resource/template.js";
import {
  EpResource,
  type EpResourceConstructor,
  type EpResourceOptions,
  type RemotePropertyValue,
} from "./EpResource.js";
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
  /** .NET-compatible alias for {@link autoReconnect}. */
  AutoReconnect?: boolean;
  /** Delay between reconnect attempts, in milliseconds. */
  reconnectInterval?: number;
  /** .NET-compatible alias for {@link reconnectInterval}. */
  ReconnectInterval?: number;
  /** Authentication mode requested by the initiator. Default `None`. */
  authenticationMode?: AuthenticationMode;
  /** .NET-compatible alias for {@link authenticationMode}. */
  AuthenticationMode?: AuthenticationMode;
  /** Authentication protocol name. Default `"hash"`. */
  authenticationProtocol?: string;
  /** .NET-compatible alias for {@link authenticationProtocol}. */
  AuthenticationProtocol?: string;
  /** Provider used to create the initiator authentication handler. */
  authenticationProvider?: IAuthenticationProvider;
  /** PascalCase alias for {@link authenticationProvider}. */
  AuthenticationProvider?: IAuthenticationProvider;
  /** Initiator identity for protocols that need one. */
  identity?: string;
  /** .NET-compatible alias for {@link identity}. */
  Identity?: string;
  /** Optional responder identity for protocols that need one. */
  responderIdentity?: string;
  /** PascalCase alias for {@link responderIdentity}. */
  ResponderIdentity?: string;
  /** Remote domain. Defaults to the WebSocket host. */
  domain?: string;
  /** .NET-compatible alias for {@link domain}. */
  Domain?: string;
}

/** .NET-compatible connection context accepted by `Warehouse.get` and `EpConnection.connect`. */
export class EpConnectionContext implements EpConnectionOptions {
  AutoReconnect?: boolean;
  ReconnectInterval?: number;
  AuthenticationMode?: AuthenticationMode;
  AuthenticationProtocol?: string;
  AuthenticationProvider?: IAuthenticationProvider;
  Identity?: string;
  ResponderIdentity?: string;
  Domain?: string;

  constructor(options?: EpConnectionOptions) {
    if (options) Object.assign(this, options);
  }
}

export interface EpReconnectMetrics {
  connectMs: number;
  reattachMs: number;
  recoveryMs: number;
  restoredResources: number;
  failedResources: number;
}

export type EpResourceAttachTarget<T extends EpResource = EpResource> =
  | TypeDef
  | EpResourceConstructor<T>;

interface TypeDefFetchRequestInfo {
  reply: AsyncReply<RemoteTypeDef>;
  requestSequence: number[];
}

/**
 * IIP/Ep connection — request/reply correlation and packet dispatch
 * (the backbone of C# `EpConnection`/`EpConnectionProtocol`).
 *
 * This build implements the request/reply engine, SHA3 password-hash
 * authentication, resource operations, and reply decoding. Incoming
 * requests/notifications can still be surfaced via {@link onRequest}/
 * {@link onNotification} for custom protocol handlers.
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
  /** Remote TypeDefs currently needed by an in-flight parse (type id to placeholder). */
  private readonly neededTypeDefs = new Map<number, RemoteTypeDef>();
  /** Fully parsed remote TypeDefs (type id to definition). */
  private readonly cachedTypeDefs = new Map<number, RemoteTypeDef>();
  /** In-flight TypeDef fetches, used to share work and detect recursive cycles. */
  private readonly typeDefRequests = new Map<number, TypeDefFetchRequestInfo>();
  /** Wait-for graph for in-flight remote TypeDef parsing. */
  private readonly typeDefsFetchBlockedOn = new Map<number, Set<number>>();
  /** Server-side notification subscriptions (instance id → unsubscribe). */
  private readonly subscriptions = new Map<number, () => void>();

  // ---- handshake --------------------------------------------------------------

  /**
   * True once the connection is past the auth phase. Defaults to true so a
   * directly-`assign`ed connection processes packets immediately; `connect` and
   * `EpServer` switch it off to run the (anonymous) handshake first.
   */
  private authenticated = true;
  private authSessionEstablished = true;
  private direction: "initiator" | "responder" | null = null;
  private readonly authPacket = new EpAuthPacket();
  private readyReply?: AsyncReply;
  private domain = "";
  private hostName: string | null = null;
  private authenticationMode = AuthenticationMode.None;
  private encryptionMode = EncryptionMode.None;
  private authenticationProtocol = "hash";
  private authenticationProvider?: IAuthenticationProvider;
  private authenticationHandler?: IAuthenticationHandler;
  private localIdentity: string | null = null;
  private remoteIdentity: string | null = null;
  private responderIdentity: string | null = null;
  private sessionKey: Uint8Array | null = null;
  private readonly localHeaders = new Map<EpAuthPacketHeader, unknown>();
  private readonly remoteHeaders = new Map<EpAuthPacketHeader, unknown>();
  private readonly variables = new Map<string, unknown>();
  /** Responder: accept unauthenticated (anonymous, None-mode) peers. */
  allowUnauthorized = true;
  /** Reconnect automatically after an unexpected client-side disconnect. */
  autoReconnect = false;
  /** Delay between reconnect attempts, in milliseconds. */
  reconnectInterval = 5000;
  /** Metrics from the most recent reconnect attempt. */
  lastReconnectMetrics?: EpReconnectMetrics;

  /** True once the authentication phase has completed. */
  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  /** Local identity reported by the authentication handler. */
  get localAuthenticationIdentity(): string | null {
    return this.localIdentity;
  }

  /** Remote identity reported by the authentication handler. */
  get remoteAuthenticationIdentity(): string | null {
    return this.remoteIdentity;
  }

  /** Derived session key, when the selected authentication protocol creates one. */
  get authenticationSessionKey(): Uint8Array | null {
    return this.sessionKey;
  }

  private reconnectUrl?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectReply?: AsyncReply<boolean>;
  private manualClose = false;
  private lastRestoreStats = { restored: 0, failed: 0 };

  /** Begin the client-side handshake; resolves via {@link whenReady}. */
  startInitiatorHandshake(domain = ""): void {
    this.authenticated = false;
    this.authSessionEstablished = false;
    this.direction = "initiator";
    if (domain) this.domain = domain;
    this.authenticationHandler = undefined;
    this.remoteHeaders.clear();
    this.localHeaders.clear();
    if (this.domain) this.localHeaders.set(EpAuthPacketHeader.Domain, this.domain);
    this.readyReply = new AsyncReply();
  }

  /** Begin the server-side handshake (waits for the peer's Initialize). */
  startResponderHandshake(): void {
    this.authenticated = false;
    this.authSessionEstablished = false;
    this.direction = "responder";
    this.authenticationHandler = undefined;
    this.remoteHeaders.clear();
    this.localHeaders.clear();
    this.localIdentity = null;
    this.remoteIdentity = null;
    this.sessionKey = null;
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
    const autoReconnect = options.autoReconnect ?? options.AutoReconnect;
    const reconnectInterval = options.reconnectInterval ?? options.ReconnectInterval;
    const authenticationMode = options.authenticationMode ?? options.AuthenticationMode;
    const authenticationProtocol = options.authenticationProtocol ?? options.AuthenticationProtocol;
    const authenticationProvider = options.authenticationProvider ?? options.AuthenticationProvider;
    const identity = options.identity ?? options.Identity;
    const responderIdentity = options.responderIdentity ?? options.ResponderIdentity;
    const domain = options.domain ?? options.Domain;

    if (autoReconnect != null) this.autoReconnect = autoReconnect;
    if (reconnectInterval != null) this.reconnectInterval = reconnectInterval;
    if (authenticationMode != null) this.authenticationMode = authenticationMode;
    if (authenticationProtocol != null) this.authenticationProtocol = authenticationProtocol;
    if (authenticationProvider != null) this.authenticationProvider = authenticationProvider;
    if (identity != null) this.localIdentity = identity;
    if (responderIdentity != null) this.responderIdentity = responderIdentity;
    if (domain != null) this.domain = domain;
  }

  private async openClientSocket(url: string): Promise<void> {
    this.reconnectUrl = url;
    this.manualClose = false;
    try {
      this.hostName = new URL(url).hostname;
      if (!this.domain) this.domain = this.hostName;
    } catch {
      /* leave domain empty */
    }
    this.startInitiatorHandshake(this.domain);

    const socket = new WSocket();
    this.assign(socket);
    await socket.connect(url);
    await this.whenReady();
  }

  /** Send the initiator's Initialize packet. */
  private declare(): void {
    try {
      const headers = new Map(this.localHeaders);
      if (this.domain) headers.set(EpAuthPacketHeader.Domain, this.domain);

      if (this.authenticationMode !== AuthenticationMode.None) {
        const handler = this.getOrCreateInitiatorAuthenticationHandler();
        const initAuthResult = handler.process(null);
        if (initAuthResult.ruling === AuthenticationRuling.Failed)
          throw new AsyncException(
            ErrorType.Management,
            ExceptionCode.AccessDenied,
            "Authentication failed.",
          );
        headers.set(EpAuthPacketHeader.AuthenticationProtocol, handler.protocol);
        headers.set(EpAuthPacketHeader.AuthenticationData, initAuthResult.authenticationData);
      }

      this.send(
        EpAuthPacket.composeInitialize(
          this.authenticationMode,
          this.encryptionMode,
          this.composeAuthHeaders(headers),
        ),
      );
    } catch (e) {
      this.failAuthentication(e);
    }
  }

  /** Handle an auth-phase packet. */
  private handleAuthPacket(packet: EpAuthPacket): void {
    try {
      if (packet.command === EpAuthPacketCommand.Initialize) {
        this.handleAuthInitialize(packet);
      } else if (packet.command === EpAuthPacketCommand.Acknowledge) {
        this.handleAuthAcknowledge(packet);
      } else if (packet.command === EpAuthPacketCommand.Action) {
        this.handleAuthAction(packet);
      } else if (packet.command === EpAuthPacketCommand.Event) {
        this.handleAuthEvent(packet);
      }
    } catch (e) {
      this.failAuthentication(e);
    }
  }

  private handleAuthInitialize(packet: EpAuthPacket): void {
    const { headers: remoteHeaders, authData: remoteAuthData } = this.parseAuthHeaders(packet);
    this.remoteHeaders.clear();
    for (const [key, value] of remoteHeaders) this.remoteHeaders.set(key, value);

    const localHeaders = new Map(this.localHeaders);

    if (packet.authMode === AuthenticationMode.None) {
      if (!this.allowUnauthorized) {
        this.sendAuthData(EpAuthPacketMethod.ErrorTerminate, "Unauthorized access not allowed.");
        this.failAuthentication("Unauthorized access not allowed.", true);
        return;
      }

      this.sendAuthHeaders(EpAuthPacketMethod.SessionEstablished, localHeaders);
      this.authenticationMode = AuthenticationMode.None;
      this.completeAuthentication(nullResult());
      return;
    }

    const protocol = this.remoteHeaders.get(EpAuthPacketHeader.AuthenticationProtocol);
    if (typeof protocol !== "string") {
      this.sendAuthHeaders(EpAuthPacketMethod.NotSupported, localHeaders);
      this.failAuthentication("Authentication protocol is missing.", true);
      return;
    }

    const provider =
      this.warehouse?.tryGetAuthenticationProvider(protocol) ??
      (this.authenticationProvider?.defaultName === protocol ? this.authenticationProvider : undefined);
    if (!provider) {
      this.sendAuthHeaders(EpAuthPacketMethod.NotSupported, localHeaders);
      this.failAuthentication("Authentication provider not found.", true);
      return;
    }

    this.authenticationMode = packet.authMode;
    this.authenticationProtocol = protocol;
    this.authenticationProvider = provider;
    const handler = provider.createAuthenticationHandler({
      direction: AuthenticationDirection.Responder,
      mode: packet.authMode,
      domain: String(this.remoteHeaders.get(EpAuthPacketHeader.Domain) ?? this.domain ?? ""),
      hostName: this.hostName,
      materials: [{ type: AuthenticationMaterialType.Data, value: remoteAuthData }],
    });
    if (!handler) {
      this.sendAuthHeaders(EpAuthPacketMethod.NotSupported, localHeaders);
      this.failAuthentication("Authentication handler not found.", true);
      return;
    }

    this.authenticationHandler = handler;
    const authResult = handler.process(remoteAuthData);
    localHeaders.set(EpAuthPacketHeader.AuthenticationData, authResult.authenticationData);

    if (authResult.ruling === AuthenticationRuling.Failed) {
      this.sendAuthHeaders(EpAuthPacketMethod.Denied, localHeaders);
      this.failAuthentication("Authentication failed.", true);
    } else if (authResult.ruling === AuthenticationRuling.InProgress) {
      this.sendAuthHeaders(EpAuthPacketMethod.ProceedToHandshake, localHeaders);
    } else {
      this.sendAuthHeaders(EpAuthPacketMethod.SessionEstablished, localHeaders);
      this.completeAuthentication(authResult);
    }
  }

  private handleAuthAcknowledge(packet: EpAuthPacket): void {
    if (this.authenticationMode === AuthenticationMode.None) {
      if (packet.method === EpAuthPacketMethod.SessionEstablished) {
        this.completeAuthentication(nullResult());
      } else {
        this.failAuthentication(this.readAuthErrorMessage(packet), true);
      }
      return;
    }

    if (
      packet.method === EpAuthPacketMethod.Denied ||
      packet.method === EpAuthPacketMethod.NotSupported
    ) {
      this.failAuthentication(this.readAuthErrorMessage(packet), true);
      return;
    }

    if (
      packet.method !== EpAuthPacketMethod.ProceedToHandshake &&
      packet.method !== EpAuthPacketMethod.ProceedToFinalHandshake &&
      packet.method !== EpAuthPacketMethod.SessionEstablished
    ) {
      return;
    }

    const { headers: remoteHeaders, authData: remoteAuthData } = this.parseAuthHeaders(packet);
    this.remoteHeaders.clear();
    for (const [key, value] of remoteHeaders) this.remoteHeaders.set(key, value);

    const authResult = this.requireAuthenticationHandler().process(remoteAuthData);
    if (authResult.ruling === AuthenticationRuling.Failed) {
      this.failAuthentication("Authentication failed.");
    } else if (authResult.ruling === AuthenticationRuling.InProgress) {
      if (packet.method === EpAuthPacketMethod.ProceedToHandshake)
        this.sendAuthData(EpAuthPacketMethod.Handshake, authResult.authenticationData);
      else
        this.failAuthentication("Bad authentication protocol sequence.");
    } else {
      this.storeAuthenticationResult(authResult);
      if (packet.method === EpAuthPacketMethod.SessionEstablished) {
        this.completeAuthentication(authResult);
      } else {
        this.sendAuthData(EpAuthPacketMethod.FinalHandshake, authResult.authenticationData);
      }
    }
  }

  private handleAuthAction(packet: EpAuthPacket): void {
    if (
      packet.method !== EpAuthPacketMethod.Handshake &&
      packet.method !== EpAuthPacketMethod.FinalHandshake
    ) {
      return;
    }

    const authData = this.decodeAuthValue(packet);
    const authResult = this.requireAuthenticationHandler().process(authData);
    if (authResult.ruling === AuthenticationRuling.Failed) {
      this.failAuthentication("Authentication failed.");
    } else if (authResult.ruling === AuthenticationRuling.InProgress) {
      this.sendAuthData(EpAuthPacketMethod.Handshake, authResult.authenticationData);
    } else {
      this.storeAuthenticationResult(authResult);
      if (authResult.authenticationData != null) {
        this.sendAuthData(EpAuthPacketMethod.FinalHandshake, authResult.authenticationData);
      }

      if (packet.method === EpAuthPacketMethod.FinalHandshake || authResult.authenticationData == null) {
        this.sendAuth(EpAuthPacketMethod.Established);
        this.completeAuthentication(authResult);
      }
    }
  }

  private handleAuthEvent(packet: EpAuthPacket): void {
    if (packet.method === EpAuthPacketMethod.Established) {
      if (this.authSessionEstablished) this.completeAuthentication();
      else this.failAuthentication("Authentication error.");
    } else if (
      packet.method === EpAuthPacketMethod.ErrorTerminate ||
      packet.method === EpAuthPacketMethod.ErrorMustEncrypt ||
      packet.method === EpAuthPacketMethod.ErrorRetry
    ) {
      this.failAuthentication(this.readAuthErrorMessage(packet), true);
    }
  }

  private getOrCreateInitiatorAuthenticationHandler(): IAuthenticationHandler {
    if (this.authenticationHandler) return this.authenticationHandler;

    const provider =
      this.authenticationProvider ??
      this.warehouse?.tryGetAuthenticationProvider(this.authenticationProtocol);
    if (!provider)
      throw new AsyncException(
        ErrorType.Management,
        ExceptionCode.AccessDenied,
        "Authentication provider not found.",
      );

    const handler = provider.createAuthenticationHandler({
      direction: AuthenticationDirection.Initiator,
      mode: this.authenticationMode,
      domain: this.domain,
      hostName: this.hostName,
      initiatorIdentity: this.localIdentity,
      responderIdentity: this.responderIdentity,
    });
    if (!handler)
      throw new AsyncException(
        ErrorType.Management,
        ExceptionCode.NotSupported,
        "Authentication handler not found.",
      );

    this.authenticationProvider = provider;
    this.authenticationHandler = handler;
    return handler;
  }

  private requireAuthenticationHandler(): IAuthenticationHandler {
    if (!this.authenticationHandler)
      throw new AsyncException(
        ErrorType.Management,
        ExceptionCode.AccessDenied,
        "Authentication handler is not initialized.",
      );
    return this.authenticationHandler;
  }

  private composeAuthHeaders(headers: Map<EpAuthPacketHeader, unknown>): Uint8Array {
    return compose(
      typedMap(
        t.u8,
        t.dynamic,
        [...headers.entries()].map(([key, value]) => [u8(key), value] as const),
      ),
      this.warehouse,
      this,
    );
  }

  private sendAuth(method: EpAuthPacketMethod): void {
    this.send(EpAuthPacket.composeMethod(method));
  }

  private sendAuthData(method: EpAuthPacketMethod, data: unknown): void {
    const tdu = data == null ? undefined : compose(data, this.warehouse, this);
    this.send(EpAuthPacket.composeMethod(method, tdu));
  }

  private sendAuthHeaders(
    method: EpAuthPacketMethod,
    headers: Map<EpAuthPacketHeader, unknown>,
  ): void {
    this.send(EpAuthPacket.composeMethod(method, this.composeAuthHeaders(headers)));
  }

  private parseAuthHeaders(packet: EpAuthPacket): {
    headers: Map<EpAuthPacketHeader, unknown>;
    authData: unknown;
  } {
    const value = this.decodeAuthValue(packet);
    const headers = new Map<EpAuthPacketHeader, unknown>();
    let authData: unknown = null;
    if (value == null) return { headers, authData };
    if (!(value instanceof Map))
      throw new AsyncException(
        ErrorType.Management,
        ExceptionCode.ParseError,
        "Authentication headers must be a map.",
      );

    for (const [rawKey, headerValue] of value.entries()) {
      const key = Number(rawKey) as EpAuthPacketHeader;
      if (key === EpAuthPacketHeader.AuthenticationData) authData = headerValue;
      else headers.set(key, headerValue);
    }

    return { headers, authData };
  }

  private decodeAuthValue(packet: EpAuthPacket): unknown {
    if (!packet.tdu) return null;
    return parse(packet.tdu.data, packet.tdu.tduOffset, this.warehouse);
  }

  private readAuthErrorMessage(packet: EpAuthPacket): string {
    const fallback = "Authentication error.";
    try {
      const value = this.decodeAuthValue(packet);
      if (typeof value === "string") return value;
      if (value instanceof Map) {
        const msg = value.get(EpAuthPacketHeader.ErrorMessage);
        if (msg != null) return String(msg);
      }
    } catch {
      /* keep fallback */
    }
    return fallback;
  }

  private storeAuthenticationResult(result: AuthenticationResult): void {
    this.authSessionEstablished = true;
    this.localIdentity = result.localIdentity;
    this.remoteIdentity = result.remoteIdentity;
    this.sessionKey = result.sessionKey;
  }

  private completeAuthentication(result?: AuthenticationResult | null): void {
    if (result) this.storeAuthenticationResult(result);
    this.authSessionEstablished = true;
    this.authenticated = true;
    this.readyReply?.trigger(true);
    this.authenticationProvider?.login?.(this.getAuthenticationSession());
  }

  private failAuthentication(error: unknown, suppressSend = false): void {
    const exception =
      error instanceof AsyncException
        ? error
        : new AsyncException(ErrorType.Management, ExceptionCode.AccessDenied, String(error));
    this.readyReply?.triggerError(exception);
    if (!suppressSend) this.sendAuthData(EpAuthPacketMethod.ErrorTerminate, exception.message);
    this.close();
  }

  private getAuthenticationSession(): AuthenticationSession {
    return {
      authenticationMode: this.authenticationMode,
      localHeaders: this.localHeaders,
      remoteHeaders: this.remoteHeaders,
      localIdentity: this.localIdentity,
      remoteIdentity: this.remoteIdentity,
      key: this.sessionKey,
      authenticated: this.authenticated,
      variables: this.variables,
    };
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

  /** Invoke function `index` with an already-shaped argument payload. */
  invokeWithArguments(instanceId: number, index: number, args: unknown): AsyncReply {
    return this.sendRequest(EpPacketRequest.InvokeFunction, instanceId, u8(index), args ?? []);
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
      const data = this.expectTypeDefPayload(
        reply,
        "TypeDefByResourceId did not return a raw TypeDef payload.",
      );
      return this.parseTypeDefPayload(data, null);
    });
  }

  /** Fetch and parse a runtime TypeDef by its remote TypeDef id. */
  fetchTypeDefById(typeDefId: number): AsyncReply<RemoteTypeDef> {
    return this.fetchTypeDef(typeDefId, null);
  }

  /** Fetch and parse a runtime TypeDef by id, resolving cyclic remote TypeDef references. */
  fetchTypeDef(
    typeDefId: number,
    requestSequence: readonly number[] | null = null,
  ): AsyncReply<RemoteTypeDef> {
    const cached = this.cachedTypeDefs.get(typeDefId);
    if (cached) return AsyncReply.fromResult(cached);

    const needed = this.neededTypeDefs.get(typeDefId);
    const requestInfo = this.typeDefRequests.get(typeDefId);
    const parent =
      requestSequence && requestSequence.length > 0
        ? requestSequence[requestSequence.length - 1]
        : undefined;

    if (requestInfo) {
      if (needed && requestSequence?.includes(typeDefId))
        return AsyncReply.fromResult(needed);

      if (needed && this.hasTypeDefWaitForCycle(typeDefId, requestSequence))
        return AsyncReply.fromResult(needed);

      if (parent != null) this.addTypeDefFetchBlock(parent, typeDefId);
      return requestInfo.reply;
    }

    const newSequence = requestSequence ? [...requestSequence, typeDefId] : [typeDefId];
    const reply = new AsyncReply<RemoteTypeDef>();
    this.typeDefRequests.set(typeDefId, { reply, requestSequence: newSequence });

    if (parent != null) this.addTypeDefFetchBlock(parent, typeDefId);

    this.sendRequest(EpPacketRequest.TypeDefById, typeDefId)
      .onReady((result) => {
        void (async () => {
          try {
            const data = this.expectTypeDefPayload(
              result,
              "TypeDefById did not return a raw TypeDef payload.",
            );
            const typeDef = await this.finishTypeDefRequest(typeDefId, data, newSequence);
            reply.trigger(typeDef);
          } catch (e) {
            this.typeDefRequests.delete(typeDefId);
            this.neededTypeDefs.delete(typeDefId);
            this.clearTypeDefFetchNode(typeDefId);
            reply.triggerError(AsyncException.from(e));
          }
        })();
      })
      .error((ex) => {
        this.typeDefRequests.delete(typeDefId);
        this.clearTypeDefFetchNode(typeDefId);
        reply.triggerError(ex);
      });

    return reply;
  }

  private expectTypeDefPayload(value: unknown, message: string): Uint8Array {
    if (value instanceof Uint8Array) return value;
    throw new AsyncException(ErrorType.Management, ExceptionCode.ParseError, message);
  }

  private parseTypeDefPayload(
    data: Uint8Array,
    requestSequence: readonly number[] | null,
  ): AsyncReply<RemoteTypeDef> {
    const typeDefId = readTypeDefPayloadId(data);
    const cached = this.cachedTypeDefs.get(typeDefId);
    if (cached) return AsyncReply.fromResult(cached);

    const pending = this.typeDefRequests.get(typeDefId);
    if (pending) return pending.reply;

    const newSequence = requestSequence ? [...requestSequence, typeDefId] : [typeDefId];
    const reply = new AsyncReply<RemoteTypeDef>();
    this.typeDefRequests.set(typeDefId, { reply, requestSequence: newSequence });

    void (async () => {
      try {
        const typeDef = await this.finishTypeDefRequest(typeDefId, data, newSequence);
        reply.trigger(typeDef);
      } catch (e) {
        reply.triggerError(AsyncException.from(e));
      }
    })();

    return reply;
  }

  private async finishTypeDefRequest(
    typeDefId: number,
    data: Uint8Array,
    requestSequence: readonly number[],
  ): Promise<RemoteTypeDef> {
    const placeholder = this.neededTypeDefs.get(typeDefId) ?? new RemoteTypeDef();
    this.neededTypeDefs.set(typeDefId, placeholder);
    try {
      const typeDef = await RemoteTypeDef.parseAsyncInto(
        placeholder,
        data,
        this.warehouse,
        (id, sequence) => this.fetchTypeDef(id, sequence),
        requestSequence,
      );
      this.cachedTypeDefs.set(typeDefId, typeDef);
      if (typeDef.id !== typeDefId) this.cachedTypeDefs.set(typeDef.id, typeDef);
      return typeDef;
    } finally {
      this.typeDefRequests.delete(typeDefId);
      this.neededTypeDefs.delete(typeDefId);
      this.clearTypeDefFetchNode(typeDefId);
    }
  }

  private addTypeDefFetchBlock(parent: number, child: number): void {
    let children = this.typeDefsFetchBlockedOn.get(parent);
    if (!children) {
      children = new Set<number>();
      this.typeDefsFetchBlockedOn.set(parent, children);
    }
    children.add(child);
  }

  private clearTypeDefFetchNode(typeDefId: number): void {
    this.typeDefsFetchBlockedOn.delete(typeDefId);
    for (const children of this.typeDefsFetchBlockedOn.values())
      children.delete(typeDefId);
  }

  private hasTypeDefWaitForCycle(
    typeDefId: number,
    requestSequence: readonly number[] | null,
  ): boolean {
    if (!requestSequence || requestSequence.length === 0) return false;

    const chain = new Set(requestSequence);
    const visited = new Set<number>();
    const stack = [typeDefId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current == null) continue;
      if (visited.has(current)) continue;
      visited.add(current);

      const children = this.typeDefsFetchBlockedOn.get(current);
      if (!children) continue;

      for (const child of children) {
        if (chain.has(child)) return true;
        stack.push(child);
      }
    }
    return false;
  }

  /** Resolve and attach a remote resource by its path on this connection. */
  get<T extends EpResource = EpResource>(
    path: string,
    target?: EpResourceAttachTarget<T>,
  ): AsyncReply {
    return this.getResourceIdByLink(path).then((resourceRef) => {
      const instanceId = toInstanceId(resourceRef);
      if (instanceId == null)
        throw new AsyncException(
          ErrorType.Management,
          ExceptionCode.ResourceNotFound,
          `Remote resource '${path}' was not found.`,
        );
      if (!target) return resourceRef;
      return this.attach(instanceId, target);
    });
  }

  /** .NET-compatible alias for {@link get}. */
  Get<T extends EpResource = EpResource>(
    path: string,
    target?: EpResourceAttachTarget<T>,
  ): AsyncReply {
    return this.get(path, target);
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
   * Attach to a remote resource, returning a live {@link EpResource}. Passing
   * a generated EpResource subclass instantiates that class; passing a TypeDef
   * keeps the dynamic-proxy behavior.
   */
  attach(instanceId: number): AsyncReply<any>;
  attach(instanceId: number, typeDef: TypeDef): AsyncReply<any>;
  attach<T extends EpResource>(
    instanceId: number,
    ctor: EpResourceConstructor<T>,
  ): AsyncReply<T & Record<string, any>>;
  attach<T extends EpResource>(
    instanceId: number,
    target?: EpResourceAttachTarget<T>,
  ): AsyncReply<any>;
  attach<T extends EpResource>(
    instanceId: number,
    target?: EpResourceAttachTarget<T>,
  ): AsyncReply {
    const resolved = this.resolveAttachTarget(target);
    if (resolved.typeDef)
      return this.attachWithTypeDef(instanceId, resolved.typeDef, resolved.ctor);

    return this.fetchTypeDefByResourceId(instanceId).then((remoteTypeDef) => {
      const ctor = resolved.ctor ?? this.findProxyType(remoteTypeDef);
      return this.attachWithTypeDef(instanceId, remoteTypeDef.template, ctor);
    });
  }

  private attachWithTypeDef<T extends EpResource>(
    instanceId: number,
    typeDef: TypeDef,
    ctor?: EpResourceConstructor<T>,
  ): AsyncReply {
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

      const resource = this.createAttachedResource(instanceId, typeDef, ctor, {
        typeDefId,
        age,
        link,
        hops,
      });
      if (raw) {
        const snapshots = this.parsePropertyValueArray(raw, typeDef);
        for (const pv of snapshots)
          resource.setPropertySnapshot(pv.index, pv.age, pv.date, pv.value);
      }

      this.attachedResources.set(instanceId, resource);
      return EpResource.createProxy(resource);
    });
  }

  private resolveAttachTarget<T extends EpResource>(
    target?: EpResourceAttachTarget<T>,
  ): { typeDef?: TypeDef; ctor?: EpResourceConstructor<T> } {
    if (!target) return {};
    if (isTypeDef(target)) return { typeDef: target };

    return {
      ctor: target,
      typeDef: getGeneratedTypeDef(target, this.warehouse),
    };
  }

  private createAttachedResource<T extends EpResource>(
    instanceId: number,
    typeDef: TypeDef,
    ctor: EpResourceConstructor<T> | undefined,
    options: EpResourceOptions,
  ): EpResource {
    const resource = ctor
      ? new ctor(this, instanceId, options.age ?? 0, options.link ?? "")
      : new EpResource();
    resource.initializeRemote(this, instanceId, typeDef, options);
    return resource;
  }

  private findProxyType(typeDef: RemoteTypeDef): EpResourceConstructor | undefined {
    return this.warehouse?.tryGetProxyType(
      typeDef.kind,
      this.domain || this.hostName || "",
      typeDef.name,
    ) as EpResourceConstructor | undefined;
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

  private parsePropertyValueArray(raw: Uint8Array, typeDef: TypeDef): RemotePropertyValue[] {
    const values: RemotePropertyValue[] = [];
    let offset = 0;
    for (const p of typeDef.properties) {
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

    const args = toIndexedArguments(parsed[2], ft.args.length);

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
    if (this.authSessionEstablished)
      this.authenticationProvider?.logout?.(this.getAuthenticationSession());
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
  return (
    "autoReconnect" in keys ||
    "AutoReconnect" in keys ||
    "reconnectInterval" in keys ||
    "ReconnectInterval" in keys ||
    "authenticationMode" in keys ||
    "AuthenticationMode" in keys ||
    "authenticationProtocol" in keys ||
    "AuthenticationProtocol" in keys ||
    "authenticationProvider" in keys ||
    "AuthenticationProvider" in keys ||
    "identity" in keys ||
    "Identity" in keys ||
    "responderIdentity" in keys ||
    "ResponderIdentity" in keys ||
    "domain" in keys ||
    "Domain" in keys
  );
}

function isTypeDef(value: unknown): value is TypeDef {
  return value instanceof TypeDef ||
    (
      value != null &&
      typeof value === "object" &&
      Array.isArray((value as { members?: unknown }).members) &&
      typeof (value as { getPropertyByIndex?: unknown }).getPropertyByIndex === "function"
    );
}

function getGeneratedTypeDef(
  ctor: Function,
  warehouse: Warehouse | undefined,
): TypeDef | undefined {
  const statics = ctor as {
    typeDef?: unknown;
    TypeDef?: unknown;
    template?: unknown;
    Template?: unknown;
  };
  const explicit =
    statics.typeDef ?? statics.TypeDef ?? statics.template ?? statics.Template;
  if (isTypeDef(explicit)) return explicit;

  const decorated = warehouse?.getTypeDef(ctor);
  return decorated && decorated.members.length > 0 ? decorated : undefined;
}

function nullResult(): AuthenticationResult {
  return new AuthenticationResult(AuthenticationRuling.Succeeded, null, null, null, null);
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

function toIndexedArguments(value: unknown, expectedCount = 0): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (!(value instanceof Map)) return [value];

  let size = expectedCount;
  for (const key of value.keys()) {
    const index = asNumber(key);
    if (index >= size) size = index + 1;
  }

  const args = new Array<unknown>(size);
  for (const [key, item] of value.entries()) {
    const index = asNumber(key);
    if (Number.isInteger(index) && index >= 0) args[index] = item;
  }
  return args;
}

function readTypeDefPayloadId(data: Uint8Array): number {
  if (data.length < 9)
    throw new AsyncException(
      ErrorType.Management,
      ExceptionCode.ParseError,
      "TypeDef payload is too short.",
    );
  return Number(getUint64(data, 1));
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
