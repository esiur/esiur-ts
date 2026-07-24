import { AsyncReply } from "../core/AsyncReply.js";
import { AsyncStreamReply } from "../core/AsyncStreamReply.js";
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
import { TduIdentifier } from "../data/TduIdentifier.js";
import { TypeDefInfo } from "../data/types/TypeDefInfo.js";
import { TypeDefKind, type ITypeDef } from "../data/types/ITypeDef.js";
import { StreamMode } from "../data/types/StreamMode.js";
import { Tru, TruComposite, TruTypeDef } from "../data/Tru.js";
import { getUint32, getUint64, merge, uint32ToBytes } from "../data/DC.js";
import { Endian } from "../data/Endian.js";
import { typedMap } from "../data/descriptors.js";
import { t } from "../data/descriptors.js";
import { u8 } from "../data/widths.js";
import { ResourceId } from "../data/ResourceId.js";
import { WSocket } from "../net/sockets/WSocket.js";
import type { ISocket } from "../net/sockets/ISocket.js";
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
import type { IEncryptionProvider } from "../security/cryptography/IEncryptionProvider.js";
import type { ISymetricCipher } from "../security/cryptography/ISymetricCipher.js";
import type { EncryptionContext } from "../security/cryptography/EncryptionContext.js";
import { randomBytes } from "../security/random.js";
import { ResourceManagerContext } from "../security/management/ResourceManagerContext.js";
import { ActionType } from "../security/permissions/ActionType.js";
import type { Warehouse } from "../resource/Warehouse.js";
import { TypeDef, type MemberTemplate, type FunctionTemplate } from "../resource/template.js";
import type { IResource } from "../resource/IResource.js";
import { isDynamicResource } from "../resource/IDynamicResource.js";
import { LocalTypeDef } from "../resource/typedef.js";
import { typeDefInfoFromTypeDef } from "../resource/typeDefInfoCompose.js";
import {
  EpResource,
  type EpResourceConstructor,
  type EpResourceOptions,
  type RemotePropertyValue,
} from "./EpResource.js";
import { RemoteTypeDef } from "./RemoteTypeDef.js";
import { ServerInvocationContext, isIterableResult } from "./ServerInvocationContext.js";

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
  /** Authentication protocol name. Default `"password-sha3-v1"`. */
  authenticationProtocol?: string;
  /** .NET-compatible alias for {@link authenticationProtocol}. */
  AuthenticationProtocol?: string;
  /** Transport encryption mode requested by the initiator. Default `None`. */
  encryptionMode?: EncryptionMode;
  /** .NET-compatible alias for {@link encryptionMode}. */
  EncryptionMode?: EncryptionMode;
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
  /**
   * Absolute `ws`/`wss` URL used verbatim as the socket transport, overriding
   * whatever host/port was parsed from the `Warehouse.get`/`connect` path.
   * Lets a resource path (e.g. `sys/counter`) and a WebSocket upgrade route
   * that doesn't match it (e.g. an ASP.NET Core host mounting Esiur at
   * `/esiur`) be specified independently — mirrors dotnet's
   * `EpConnectionContext.WebSocketUri`, which is used as-is, never
   * concatenated with the resource path.
   */
  webSocketUri?: string | URL;
  /** .NET-compatible alias for {@link webSocketUri}. */
  WebSocketUri?: string | URL;
}

/** .NET-compatible connection context accepted by `Warehouse.get` and `EpConnection.connect`. */
export class EpConnectionContext implements EpConnectionOptions {
  AutoReconnect?: boolean;
  ReconnectInterval?: number;
  AuthenticationMode?: AuthenticationMode;
  AuthenticationProtocol?: string;
  AuthenticationProvider?: IAuthenticationProvider;
  EncryptionMode?: EncryptionMode;
  Identity?: string;
  ResponderIdentity?: string;
  Domain?: string;
  WebSocketUri?: string | URL;

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

  /**
   * The raw {@link EpResource} behind an id returned by {@link get}/{@link attach}
   * (which hand back the ergonomic dot-access proxy instead). Needed to
   * `warehouse.put()` a fetched resource for relaying to a third node — the
   * warehouse machinery needs the real object, not a Proxy wrapper, so it can
   * assign `.instance` and use it as an `IDynamicResource` directly.
   */
  getAttachedResource(instanceId: number): EpResource | undefined {
    return this.attachedResources.get(instanceId);
  }
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
  /**
   * Server-side explicit per-event subscriptions (instance id → subscribed
   * event indices), consulted only for events where {@link EventTemplate.subscribable}
   * is true — other events keep being pushed to every attached connection
   * unconditionally, as `subscribeToInstance` already does.
   */
  private readonly eventSubscriptions = new Map<number, Set<number>>();
  /**
   * Per (instanceId, eventIndex) marker listener used to ref-count an
   * upstream `.on()` subscription when relaying a `subscribable` event
   * through an {@link EpResource} — keeps the upstream connection subscribed
   * only while at least one downstream peer here still is.
   */
  private readonly relayListeners = new Map<string, (value: unknown) => void>();
  /**
   * In-flight streamed calls, keyed by the *originating* `InvokeFunction`/
   * `StaticCall` request's callback id — the same id `PullStream`/
   * `TerminateExecution`/`HaltExecution`/`ResumeExecution` reference as
   * their "execution callback" (see `sendStreamRequest`, the client-side
   * counterpart that keys these the same way).
   */
  private readonly invocations = new Map<number, ServerInvocationContext>();

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
  private encryptionProvider: IEncryptionProvider | null = null;
  private symetricCipher: ISymetricCipher | null = null;
  /** True once inbound records are being decrypted (mirrors dotnet's `_decryptInbound`). */
  private decryptInbound = false;
  /** True once outbound records are being encrypted. */
  private encryptionActive = false;
  /** Encryption protocols offered in this connection's own Initialize headers (initiator only). */
  private offeredEncryptionProviders: string[] = [];
  private authenticationProtocol = "password-sha3-v1";
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
    // `webSocketUri`, when set, is used verbatim as the socket transport —
    // never combined with `url` — matching dotnet's `WebSocketUri` override.
    const webSocketUri = config?.webSocketUri ?? config?.WebSocketUri;
    await connection.openClientSocket(webSocketUri ? String(webSocketUri) : url);
    return connection;
  }

  private applyOptions(options?: EpConnectionOptions): void {
    if (!options) return;
    const autoReconnect = options.autoReconnect ?? options.AutoReconnect;
    const reconnectInterval = options.reconnectInterval ?? options.ReconnectInterval;
    const authenticationMode = options.authenticationMode ?? options.AuthenticationMode;
    const authenticationProtocol = options.authenticationProtocol ?? options.AuthenticationProtocol;
    const authenticationProvider = options.authenticationProvider ?? options.AuthenticationProvider;
    const encryptionMode = options.encryptionMode ?? options.EncryptionMode;
    const identity = options.identity ?? options.Identity;
    const responderIdentity = options.responderIdentity ?? options.ResponderIdentity;
    const domain = options.domain ?? options.Domain;

    if (autoReconnect != null) this.autoReconnect = autoReconnect;
    if (reconnectInterval != null) this.reconnectInterval = reconnectInterval;
    if (authenticationMode != null) this.authenticationMode = authenticationMode;
    if (encryptionMode != null) this.encryptionMode = encryptionMode;
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

    const socket = await this.createClientSocket(url);
    this.assign(socket);
    await socket.connect(url);
    await this.whenReady();
  }

  /**
   * Choose the transport for `url`'s scheme. Unlike C#'s `CreateClientSocket`
   * (which picks `TcpSocket` vs `FrameworkWebSocket` based on whether
   * `WebSocketUri`/a browser runtime is in play, since dotnet's connect API
   * takes a bare host/port), esiur-ts's `connect()`/`Warehouse.get()` always
   * take a single URL string — so the URL's own scheme is the natural,
   * explicit selector here: `tcp://host:port` dials a raw {@link TcpSocket}
   * (Node-only; esiur-dotnet servers exposing only their native `TcpServer`,
   * with no WebSocket upgrade route, are otherwise unreachable from
   * esiur-ts), anything else (`ws://`/`wss://`/`ep://`/`eps://`) keeps using
   * {@link WSocket} as before.
   */
  private async createClientSocket(url: string): Promise<ISocket> {
    let scheme = "";
    try {
      scheme = new URL(url).protocol.slice(0, -1).toLowerCase();
    } catch {
      /* fall through to the default WebSocket transport */
    }
    if (scheme === "tcp") {
      const { TcpSocket } = await import("../net/sockets/TcpSocket.js");
      return new TcpSocket();
    }
    return new WSocket();
  }

  /** Send the initiator's Initialize packet. */
  private declare(): void {
    try {
      const headers = new Map(this.localHeaders);
      if (this.domain) headers.set(EpAuthPacketHeader.Domain, this.domain);

      if (this.encryptionMode !== EncryptionMode.None) this.prepareEncryptionOffer(headers);

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

  /** Initiator: offer supported cipher names and a fresh nonce before sending Initialize. */
  private prepareEncryptionOffer(headers: Map<EpAuthPacketHeader, unknown>): void {
    if (this.authenticationMode === AuthenticationMode.None)
      throw new Error("Session-key encryption requires an authenticated session.");
    if (
      this.encryptionMode !== EncryptionMode.EncryptWithSessionKey &&
      this.encryptionMode !== EncryptionMode.EncryptWithSessionKeyAndAddress
    )
      throw new Error(`Unsupported encryption mode \`${this.encryptionMode}\`.`);

    const names = this.offeredEncryptionProviders.length > 0
      ? this.offeredEncryptionProviders
      : (this.warehouse?.getEncryptionProviderNames() ?? []);
    const offered = [...new Set(names.filter((n) => n && this.warehouse?.tryGetEncryptionProvider(n)))];

    if (offered.length === 0)
      throw new Error("Encryption was requested but none of the offered providers are registered.");

    this.offeredEncryptionProviders = offered;
    this.localHeaders.set(EpAuthPacketHeader.SupportedCiphers, offered);
    this.localHeaders.delete(EpAuthPacketHeader.CipherType);
    const nonce = randomBytes(32);
    this.localHeaders.set(EpAuthPacketHeader.CipherNonce, nonce);
    headers.set(EpAuthPacketHeader.SupportedCiphers, offered);
    headers.set(EpAuthPacketHeader.CipherNonce, nonce);
  }

  /**
   * Responder: negotiate an offered cipher against this connection's
   * registered providers, mutating `localHeaders` (the Acknowledge headers
   * about to be sent) with the selection.
   */
  private negotiateEncryptionAsResponder(localHeaders: Map<EpAuthPacketHeader, unknown>): boolean {
    this.encryptionMode = this.authPacket.encryptionMode;
    if (this.encryptionMode === EncryptionMode.None) return true;

    if (
      this.encryptionMode !== EncryptionMode.EncryptWithSessionKey &&
      this.encryptionMode !== EncryptionMode.EncryptWithSessionKeyAndAddress
    )
      return this.rejectEncryption("The requested encryption mode is not supported.");
    if (this.authPacket.authMode === AuthenticationMode.None)
      return this.rejectEncryption("Session-key encryption requires authentication.");

    const offered = asStringArray(this.remoteHeaders.get(EpAuthPacketHeader.SupportedCiphers));
    const selected = offered.find((name) => name && this.warehouse?.tryGetEncryptionProvider(name));
    if (!selected) return this.rejectEncryption("No mutually supported encryption provider is available.");

    const remoteNonce = this.remoteHeaders.get(EpAuthPacketHeader.CipherNonce);
    if (!(remoteNonce instanceof Uint8Array) || remoteNonce.length < 16 || remoteNonce.length > 64)
      return this.rejectEncryption("The initiator did not supply a valid cipher nonce.");

    this.encryptionProvider = this.warehouse!.getEncryptionProvider(selected);
    const localOffered = (this.warehouse?.getEncryptionProviderNames() ?? []).filter(
      (n) => this.warehouse?.tryGetEncryptionProvider(n),
    );
    this.localHeaders.set(EpAuthPacketHeader.SupportedCiphers, localOffered);
    this.localHeaders.set(EpAuthPacketHeader.CipherType, selected);
    const nonce = randomBytes(32);
    this.localHeaders.set(EpAuthPacketHeader.CipherNonce, nonce);

    localHeaders.set(EpAuthPacketHeader.SupportedCiphers, localOffered);
    localHeaders.set(EpAuthPacketHeader.CipherType, selected);
    localHeaders.set(EpAuthPacketHeader.CipherNonce, nonce);
    return true;
  }

  /** Initiator: accept the responder's cipher selection from its Acknowledge headers. */
  private acceptEncryptionAsInitiator(): boolean {
    if (this.encryptionMode === EncryptionMode.None) {
      const selected = this.remoteHeaders.get(EpAuthPacketHeader.CipherType);
      return selected == null || this.rejectEncryption("The responder selected encryption that was not requested.");
    }

    const selected = this.remoteHeaders.get(EpAuthPacketHeader.CipherType);
    if (typeof selected !== "string" || !selected.trim() || !this.offeredEncryptionProviders.includes(selected))
      return this.rejectEncryption("The responder did not select an offered encryption provider.");

    const remoteNonce = this.remoteHeaders.get(EpAuthPacketHeader.CipherNonce);
    if (!(remoteNonce instanceof Uint8Array) || remoteNonce.length < 16 || remoteNonce.length > 64)
      return this.rejectEncryption("The responder did not supply a valid cipher nonce.");

    const provider = this.warehouse?.tryGetEncryptionProvider(selected);
    if (!provider) return this.rejectEncryption(`Encryption provider \`${selected}\` is not registered locally.`);

    this.encryptionProvider = provider;
    return true;
  }

  private rejectEncryption(message: string): false {
    try {
      this.sendAuthData(EpAuthPacketMethod.ErrorMustEncrypt, message);
    } catch {
      /* best effort */
    }
    this.failAuthentication(message, true);
    return false;
  }

  /**
   * Once a session key and negotiated provider are available, derive the
   * session cipher (port of C# `PrepareSessionEncryption`). Async only
   * because {@link IEncryptionProvider.createCipher} may need to resolve a
   * Node-only crypto module once per session — see `AesEncryptionProvider.ts`.
   */
  private async prepareSessionEncryption(): Promise<void> {
    if (this.encryptionMode === EncryptionMode.None || this.symetricCipher) return;
    if (!this.sessionKey || this.sessionKey.length === 0)
      throw new Error("The authentication provider did not derive a session key for encryption.");
    if (!this.encryptionProvider) throw new Error("No encryption provider was negotiated.");

    const initiator = this.direction === "initiator";
    const initiatorNonce = asBytes(
      initiator
        ? this.localHeaders.get(EpAuthPacketHeader.CipherNonce)
        : this.remoteHeaders.get(EpAuthPacketHeader.CipherNonce),
    );
    const responderNonce = asBytes(
      initiator
        ? this.remoteHeaders.get(EpAuthPacketHeader.CipherNonce)
        : this.localHeaders.get(EpAuthPacketHeader.CipherNonce),
    );
    if (!initiatorNonce || !responderNonce) throw new Error("Missing negotiated cipher nonce.");

    const offeredProtocols = initiator
      ? this.offeredEncryptionProviders
      : asStringArray(this.remoteHeaders.get(EpAuthPacketHeader.SupportedCiphers));
    const authenticationProtocol = initiator
      ? this.authenticationHandler?.protocol
      : String(this.remoteHeaders.get(EpAuthPacketHeader.AuthenticationProtocol) ?? "");
    const selectedProtocol = String(
      initiator
        ? this.remoteHeaders.get(EpAuthPacketHeader.CipherType)
        : this.localHeaders.get(EpAuthPacketHeader.CipherType),
    );

    const context: EncryptionContext = {
      key: this.sessionKey,
      direction: initiator ? AuthenticationDirection.Initiator : AuthenticationDirection.Responder,
      mode: this.encryptionMode,
      protocol: selectedProtocol,
      offeredProtocols,
      authenticationMode: this.authenticationMode,
      authenticationProtocol: authenticationProtocol ?? "",
      domain: initiator ? this.domain : String(this.remoteHeaders.get(EpAuthPacketHeader.Domain) ?? ""),
      initiatorNonce,
      responderNonce,
    };

    this.symetricCipher = await this.encryptionProvider.createCipher(context);
  }

  /** Turn on record protection for both directions once the cipher is ready. */
  private enableEncryption(): void {
    if (!this.symetricCipher) throw new Error("Cannot enable encryption before creating a cipher.");
    this.decryptInbound = true;
    this.encryptionActive = true;
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

    if (!this.negotiateEncryptionAsResponder(localHeaders)) return;

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

    if (!this.acceptEncryptionAsInitiator()) return;

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

    if (this.encryptionMode === EncryptionMode.None) {
      this.finishAuthenticationReady();
      return;
    }

    // Every call site above has already sent its final plaintext auth
    // message (SessionEstablished/Established) before reaching this point,
    // so it's safe to derive the cipher and flip to encrypted transport here
    // — nothing more goes out unencrypted after readiness is published.
    void this.prepareSessionEncryption()
      .then(() => {
        this.enableEncryption();
        this.finishAuthenticationReady();
      })
      .catch((e) => this.failAuthentication(e));
  }

  private finishAuthenticationReady(): void {
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
      encryptionMode: this.encryptionMode,
      encryptionProvider: this.encryptionProvider,
      symetricCipher: this.symetricCipher,
      encryptionActive: this.encryptionActive,
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

  /** Invoke a `static` exported function `index` on TypeDef `typeId` — no resource instance involved. */
  staticCall(typeId: number, index: number, ...args: unknown[]): AsyncReply {
    return this.sendRequest(EpPacketRequest.StaticCall, typeId, u8(index), args);
  }

  /**
   * Send a stream-flavored request: the callback id also drives
   * `PullStream`/`TerminateExecution`/`HaltExecution`/`ResumeExecution`
   * against the same remote invocation via the returned {@link AsyncStreamReply}.
   */
  sendStreamRequest<T = unknown>(
    streamMode: StreamMode,
    action: EpPacketRequest,
    ...args: unknown[]
  ): AsyncStreamReply<T> {
    const callbackId = ++this.callbackCounter;
    const reply = new AsyncStreamReply<T>(
      streamMode,
      () => this.sendRequest(EpPacketRequest.PullStream, callbackId),
      () => this.sendRequest(EpPacketRequest.TerminateExecution, callbackId),
      () => this.sendRequest(EpPacketRequest.HaltExecution, callbackId),
      () => this.sendRequest(EpPacketRequest.ResumeExecution, callbackId),
    );
    this.requests.set(callbackId, reply);
    this.send(EpPacket.composeRequest(action, callbackId, this.composeArgs(args)));
    return reply;
  }

  /** Invoke a streaming function `index` on the resource with `instanceId`. */
  invokeStream<T = unknown>(
    streamMode: StreamMode,
    instanceId: number,
    index: number,
    ...args: unknown[]
  ): AsyncStreamReply<T> {
    return this.sendStreamRequest<T>(
      streamMode,
      EpPacketRequest.InvokeFunction,
      instanceId,
      u8(index),
      args,
    );
  }

  /** Invoke function `index` with an already-shaped argument payload. */
  invokeWithArguments(instanceId: number, index: number, args: unknown): AsyncReply {
    return this.sendRequest(EpPacketRequest.InvokeFunction, instanceId, u8(index), args ?? []);
  }

  /** Set property `index` on the resource with `instanceId`. */
  set(instanceId: number, index: number, value: unknown): AsyncReply {
    return this.sendRequest(EpPacketRequest.SetProperty, instanceId, u8(index), value);
  }

  /**
   * Subscribe to event `index` on the resource with `instanceId` — required
   * before the server pushes `EventOccurred` notifications for events where
   * {@link RemoteEventDef.subscribable} is true (`autoDelivered` events are
   * pushed unconditionally and never need this). The server errors
   * (`AlreadyListened`) on a duplicate call for an already-subscribed event,
   * so callers must track subscription state themselves — see
   * {@link EpResource.on}, which does this per-event, ref-counted by listener
   * count, rather than sending on every call.
   */
  subscribe(instanceId: number, index: number): AsyncReply {
    return this.sendRequest(EpPacketRequest.Subscribe, instanceId, u8(index));
  }

  /** Unsubscribe from event `index` on the resource with `instanceId`. See {@link subscribe}. */
  unsubscribe(instanceId: number, index: number): AsyncReply {
    return this.sendRequest(EpPacketRequest.Unsubscribe, instanceId, u8(index));
  }

  /** Resolve a resource path to a {@link ResourceId} reference. */
  getResourceIdByLink(link: string): AsyncReply {
    return this.sendRequest(EpPacketRequest.GetResourceIdByLink, link);
  }

  /** Stop receiving notifications for a resource on this connection (it keeps living for other subscribers). */
  detach(instanceId: number): AsyncReply {
    return this.sendRequest(EpPacketRequest.DetachResource, instanceId);
  }

  /** Rename a resource (single path segment — no `/`). */
  moveResource(instanceId: number, newName: string): AsyncReply {
    return this.sendRequest(EpPacketRequest.MoveResource, instanceId, newName);
  }

  /** Remove a resource from the peer's warehouse. */
  deleteResource(instanceId: number): AsyncReply {
    return this.sendRequest(EpPacketRequest.DeleteResource, instanceId);
  }

  /**
   * Create a resource of a type already registered on the peer's warehouse.
   * `properties` is keyed by wire property index; replies with the new
   * resource's instance id.
   */
  createResource(
    path: string,
    typeIdOrName: number | string,
    properties?: Map<number, unknown>,
    attributes?: Map<string, unknown>,
  ): AsyncReply<number> {
    return this.sendRequest(
      EpPacketRequest.CreateResource,
      path,
      typeIdOrName,
      properties ?? new Map<number, unknown>(),
      attributes ?? new Map<string, unknown>(),
    ).then((reply) => Number(reply));
  }

  /**
   * Resolve a resource path, replying with its children as `[id, link]`
   * pairs (see `epRequestQueryResources`'s doc comment for why this isn't
   * full auto-attaching resource references, unlike dotnet's `Query`).
   * Distinct from {@link getResourceIdByLink}, which resolves a single link.
   */
  queryResources(path: string): AsyncReply<Array<[number, string]>> {
    return this.sendRequest(EpPacketRequest.Query, path).then(
      (reply) => (reply as Array<[number, string]>) ?? [],
    );
  }

  /** Bulk-fetch a resource type's full TypeDef dependency graph in one round trip. */
  fetchLinkedTypeDefs(path: string): AsyncReply<RemoteTypeDef[]> {
    return this.sendRequest(EpPacketRequest.LinkTypeDefs, path).then(async (reply) => {
      const payloads = (reply as unknown[]) ?? [];
      const results: RemoteTypeDef[] = [];
      for (const p of payloads) {
        const data = this.expectTypeDefPayload(p, "LinkTypeDefs did not return raw TypeDef payloads.");
        results.push(await this.parseTypeDefPayload(data, null));
      }
      return results;
    });
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

  /** Batch-resolve full class names to their remote TypeDef ids. */
  getTypeDefIds(fullNames: string[]): AsyncReply<number[]> {
    return this.sendRequest(EpPacketRequest.TypeDefIdsByNames, fullNames).then((reply) => {
      if (!Array.isArray(reply))
        throw new AsyncException(
          ErrorType.Management,
          ExceptionCode.ParseError,
          "TypeDefIdsByNames did not return an id array.",
        );
      return reply.map((v) => Number(v));
    });
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
    const typeDefId = readTypeDefPayloadId(data, this.warehouse);
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

  /**
   * Resolve and attach a remote resource by its path on this connection. When
   * `typeDef` is omitted, its TypeDef is fetched from the server first (one
   * extra round trip) — mirrors dotnet's `Get<T>`, which never needs a
   * caller-supplied type because C# generates the proxy dynamically.
   */
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
   * Reattach an already-known resource by link or instance id, sending its
   * last-known age. The peer returns only properties modified after that
   * age. Prefer the link — the remote node may have freed/recreated the
   * resource since, so its id is not permanent, but the link is. The reply
   * leads with the resolved id so an id change (link re-resolved to a
   * different instance) can be detected and tracking re-keyed.
   */
  reattach(resourceLinkOrId: string | number, age: number, resource: EpResource): AsyncReply<EpResource> {
    return this.sendRequest(EpPacketRequest.ReattachResource, resourceLinkOrId, age).then((reply) => {
      const list = reply as unknown[];
      const oldId = resource.instanceId;
      const resolvedId = asNumber(list[0]);
      resource.setRemoteIdentity({
        instanceId: resolvedId,
        typeDefId: asNumber(list[1]),
        age: asNumber(list[2]),
        link: String(list[3] ?? ""),
        hops: asNumber(list[4]),
      });

      const raw = list[5] as Uint8Array | undefined;
      if (raw) resource.applyDelta(this.parsePropertyValueMap(raw));

      if (resolvedId !== oldId) {
        // Only evict oldId's entry if it still points to this resource —
        // if the remote node reused oldId for something else in the
        // meantime, a blind delete would wrongly evict that unrelated
        // resource's own valid tracking.
        if (this.attachedResources.get(oldId) === resource) this.attachedResources.delete(oldId);
      }
      this.attachedResources.set(resolvedId, resource);
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
    const dyn = isDynamicResource(resource) ? resource : undefined;
    const bag = resource as unknown as Record<string, unknown>;
    const parts: Uint8Array[] = [];
    for (const p of instance.definition.properties) {
      parts.push(compose(instance.getAge(p.index) ?? 0, this.warehouse, this));
      parts.push(compose(instance.getModificationDate(p.index) ?? new Date(0), this.warehouse, this));
      parts.push(compose(dyn ? dyn.getResourceProperty(p.index) : bag[p.name], this.warehouse, this));
    }
    return merge(...parts);
  }

  private composePropertyValueMap(instanceId: number, sinceAge: number): Uint8Array {
    const resource = this.warehouse?.getById(instanceId);
    if (!resource?.instance) return new Uint8Array(0);

    const instance = resource.instance;
    const dyn = isDynamicResource(resource) ? resource : undefined;
    const bag = resource as unknown as Record<string, unknown>;
    const parts: Uint8Array[] = [];
    for (const p of instance.definition.properties) {
      const propertyAge = instance.getAge(p.index) ?? 0;
      if (propertyAge <= sinceAge) continue;
      parts.push(compose(u8(p.index), this.warehouse, this));
      parts.push(compose(propertyAge, this.warehouse, this));
      parts.push(compose(instance.getModificationDate(p.index) ?? new Date(0), this.warehouse, this));
      parts.push(compose(dyn ? dyn.getResourceProperty(p.index) : bag[p.name], this.warehouse, this));
    }
    return merge(...parts);
  }

  private async restoreAttachedResources(): Promise<void> {
    const resources = [...this.attachedResources.values()];
    const stats = { restored: 0, failed: 0 };
    for (const resource of resources) {
      try {
        await this.reattach(resource.link || resource.instanceId, resource.age, resource);
        resource.resubscribeAfterReconnect();
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

  // ---- outbound (encrypted transport) ------------------------------------------

  private static readonly ENCRYPTED_RECORD_HEADER_SIZE = 4;

  /**
   * Wrap outbound bytes in an AES-GCM-protected record once encryption is
   * active (port of C# `SendAsync`'s `ComposeEncryptedRecord` path):
   * `[4-byte BE protected-length][cipher.encrypt(message)]`. Plain
   * pass-through otherwise.
   */
  override send(message: Uint8Array): void {
    if (!this.encryptionActive || !this.symetricCipher) {
      super.send(message);
      return;
    }
    const protectedPayload = this.symetricCipher.encrypt(message);
    super.send(merge(uint32ToBytes(protectedPayload.length, Endian.Big), protectedPayload));
  }

  // ---- inbound ----------------------------------------------------------------

  protected override dataReceived(buffer: NetworkBuffer): void {
    const msg = buffer.read();
    if (!msg) return;

    let offset = 0;
    const ends = msg.length;
    while (offset < ends) {
      if (this.decryptInbound) {
        const remaining = ends - offset;
        const headerSize = EpConnection.ENCRYPTED_RECORD_HEADER_SIZE;
        if (remaining < headerSize) {
          buffer.holdFor(msg, offset, remaining, headerSize);
          return;
        }

        const protectedLength = getUint32(msg, offset, Endian.Big);
        const totalLength = headerSize + protectedLength;
        if (remaining < totalLength) {
          buffer.holdFor(msg, offset, remaining, totalLength);
          return;
        }

        const protectedPayload = msg.subarray(offset + headerSize, offset + totalLength);
        offset += totalLength;

        let plaintext: Uint8Array;
        try {
          plaintext = this.symetricCipher!.decrypt(protectedPayload);
        } catch (e) {
          this.failAuthentication(e, true);
          this.close();
          return;
        }

        this.dispatchPlaintext(plaintext);
        continue;
      }

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

  /**
   * Parse and dispatch every complete packet within an already-decrypted
   * record. Unlike the plaintext path above, a truncated packet here is a
   * genuine protocol error rather than "need more data" — the whole record
   * was already fully received and authenticated before decryption.
   */
  private dispatchPlaintext(plaintext: Uint8Array): void {
    let offset = 0;
    const ends = plaintext.length;
    while (offset < ends) {
      if (!this.authenticated) {
        const consumed = this.authPacket.parse(plaintext, offset, ends);
        if (consumed <= 0) throw new Error("Truncated encrypted auth packet.");
        offset += consumed;
        this.handleAuthPacket(this.authPacket);
        continue;
      }
      const consumed = this.packet.parse(plaintext, offset, ends);
      if (consumed <= 0) throw new Error("Truncated encrypted packet.");
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
          void this.epRequestInvokeFunction(callbackId, tdu);
          return;
        case EpPacketRequest.StaticCall:
          void this.epRequestStaticCall(callbackId, tdu);
          return;
        case EpPacketRequest.SetProperty:
          void this.epRequestSetProperty(callbackId, tdu);
          return;
        case EpPacketRequest.Subscribe:
          void this.epRequestSubscribe(callbackId, tdu);
          return;
        case EpPacketRequest.Unsubscribe:
          void this.epRequestUnsubscribe(callbackId, tdu);
          return;
        case EpPacketRequest.AttachResource:
          void this.epRequestAttachResource(callbackId, tdu);
          return;
        case EpPacketRequest.ReattachResource:
          void this.epRequestReattachResource(callbackId, tdu);
          return;
        case EpPacketRequest.GetResourceIdByLink:
          this.epRequestGetResourceIdByLink(callbackId, tdu);
          return;
        case EpPacketRequest.TypeDefById:
          void this.epRequestTypeDefById(callbackId, tdu);
          return;
        case EpPacketRequest.TypeDefByResourceId:
          void this.epRequestTypeDefByResourceId(callbackId, tdu);
          return;
        case EpPacketRequest.TypeDefIdsByNames:
          void this.epRequestTypeDefIdsByNames(callbackId, tdu);
          return;
        case EpPacketRequest.Query:
          void this.epRequestQueryResources(callbackId, tdu);
          return;
        case EpPacketRequest.LinkTypeDefs:
          void this.epRequestLinkTypeDefs(callbackId, tdu);
          return;
        case EpPacketRequest.DetachResource:
          void this.epRequestDetachResource(callbackId, tdu);
          return;
        case EpPacketRequest.CreateResource:
          void this.epRequestCreateResource(callbackId, tdu);
          return;
        case EpPacketRequest.DeleteResource:
          void this.epRequestDeleteResource(callbackId, tdu);
          return;
        case EpPacketRequest.MoveResource:
          void this.epRequestMoveResource(callbackId, tdu);
          return;
        case EpPacketRequest.PullStream:
          void this.epRequestPullStream(callbackId, tdu);
          return;
        case EpPacketRequest.TerminateExecution:
          void this.epRequestTerminateExecution(callbackId, tdu);
          return;
        case EpPacketRequest.HaltExecution:
          void this.epRequestHaltExecution(callbackId, tdu);
          return;
        case EpPacketRequest.ResumeExecution:
          void this.epRequestResumeExecution(callbackId, tdu);
          return;
      }
    }
    this.onRequest?.(this, action, callbackId, tdu);
  }

  /**
   * Evaluate permissions/rate-control/auditing managers for one operation
   * (port of C# `TryApplyManagers`). Sends the denial error itself and
   * returns `false` when the operation isn't admitted; otherwise waits out
   * any rate-control-assigned delay and returns `true`.
   *
   * Scope note: dotnet additionally tracks repeated rate-control denials
   * per connection and, past a threshold, blocks the connection outright
   * (`IsRateControlBlocked`/`DenyRateControlledRequest`) — a secondary
   * DoS-hardening layer on top of this per-operation check, not ported here.
   */
  private async tryApplyManagers(
    member: MemberTemplate | null,
    resource: IResource | null,
    action: ActionType,
    callbackId: number,
    denialErrorType: ErrorType,
    denialCode: ExceptionCode,
    supportsDelay = false,
  ): Promise<boolean> {
    if (!this.warehouse) return true;

    const context = new ResourceManagerContext(
      this.warehouse,
      this,
      this.getAuthenticationSession(),
      resource,
      member,
      action,
      this,
      [],
      null,
      supportsDelay,
    );

    try {
      const evaluation = this.warehouse.evaluateManagers(context);
      if (!evaluation.isAllowed) {
        this.sendError(denialErrorType, callbackId, denialCode);
        return false;
      }
      if (evaluation.delay > 0) {
        if (!supportsDelay) {
          this.sendError(denialErrorType, callbackId, denialCode);
          return false;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, evaluation.delay));
      }
      return true;
    } catch {
      this.sendError(denialErrorType, callbackId, denialCode);
      return false;
    }
  }

  /** Server handler: send current property values and subscribe the peer to changes. */
  private async epRequestAttachResource(callbackId: number, tdu: PlainTdu | null): Promise<void> {
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

    if (
      !(await this.tryApplyManagers(
        null,
        resource,
        ActionType.Attach,
        callbackId,
        ErrorType.Management,
        ExceptionCode.AccessDenied,
      ))
    )
      return;

    const instance = resource.instance;
    if (!instance) return;
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

  /**
   * Server handler: send only properties modified after the caller's known
   * age. Accepts either a resource link (string) or a previously-known
   * instance id (number) — the id is not permanent (the remote node may
   * free/recreate a resource from memory), but the link is, so reconnecting
   * clients resolve by link. Reply leads with the resolved id so the caller
   * can detect it changed since its last attach.
   */
  private async epRequestReattachResource(callbackId: number, tdu: PlainTdu | null): Promise<void> {
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

    const linkOrId = parsed[0];
    const sinceAge = asNumber(parsed[1]);

    let resource: IResource | undefined;
    if (typeof linkOrId === "string") {
      try {
        resource = await this.warehouse.query(linkOrId);
      } catch {
        resource = undefined;
      }
    } else {
      resource = this.warehouse.getById(Number(linkOrId));
    }

    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        resource,
        ActionType.Attach,
        callbackId,
        ErrorType.Management,
        ExceptionCode.AccessDenied,
      ))
    )
      return;

    const instance = resource.instance;
    if (!instance) return;
    const resolvedId = instance.id;
    const typeDef = this.warehouse.getLocalTypeDefByType(resource.constructor);
    const propertyValues = this.composePropertyValueMap(resolvedId, sinceAge);
    this.subscribeToInstance(resolvedId);

    this.sendReply(
      EpPacketReply.Completed,
      callbackId,
      resolvedId,
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

  /** Server handler: compose and reply with a registered TypeDef by its numeric id. */
  private async epRequestTypeDefById(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const id = Number(this.decode(tdu));
    let local: ITypeDef;
    try {
      local = this.warehouse.getLocalTypeDefById(id);
    } catch {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.TypeDefNotFound);
      return;
    }
    if (!(local instanceof LocalTypeDef)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.TypeDefNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        null,
        ActionType.ViewTypeDef,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    const info = typeDefInfoFromTypeDef(local.id, local.kind, local.template);
    this.sendReply(EpPacketReply.Completed, callbackId, compose(info, this.warehouse, this));
  }

  /** Server handler: compose and reply with a resource's TypeDef. */
  private async epRequestTypeDefByResourceId(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const resourceId = Number(this.decode(tdu));
    const resource = this.warehouse.getById(resourceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        resource,
        ActionType.ViewTypeDef,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    // A relayed EpResource has no LocalTypeDef registration of its own on
    // this warehouse — forward the id the upstream connection originally
    // assigned this type (mirrors dotnet's RemoteTypeDef, which inherits
    // TypeDef.Id and is composed unchanged when relayed onward).
    let id: number;
    let kind: TypeDefKind;
    if (resource instanceof EpResource) {
      id = resource.typeDefId ?? 0;
      kind = TypeDefKind.Resource;
    } else {
      const local = this.warehouse.getLocalTypeDefByType(resource.constructor);
      id = local.id;
      kind = local.kind;
    }

    const info = typeDefInfoFromTypeDef(id, kind, resource.instance.definition);
    this.sendReply(EpPacketReply.Completed, callbackId, compose(info, this.warehouse, this));
  }

  /** Server handler: batch name -> id lookup. Misses are skipped, not errored. */
  private async epRequestTypeDefIdsByNames(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    let names: unknown[];
    try {
      names = (this.decode(tdu) as unknown[]) ?? [];
    } catch {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const resolved = names
      .map((n) => this.warehouse!.getLocalTypeDefByName(String(n)))
      .filter((td): td is ITypeDef => td != null);

    if (resolved.length === 0) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.TypeDefNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        null,
        ActionType.ViewTypeDef,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    this.sendReply(
      EpPacketReply.Completed,
      callbackId,
      resolved.map((td) => td.id),
    );
  }

  /**
   * Server handler (Query, 0xB): resolve a link, reply with the resource's
   * children as `{id, link}` descriptors, filtered to what the caller is
   * allowed to Attach. Distinct from {@link epRequestGetResourceIdByLink},
   * which resolves a single link rather than listing children.
   *
   * Dotnet replies with full resource references that auto-attach on
   * decode; esiur-ts has no compose-side counterpart for that at all yet
   * (`LocalResource8/16/32` TDUs are decode-only — see `ResourceId.ts` /
   * `DataDeserializer.ts` — and nothing turns a decoded `ResourceId` into an
   * attached `EpResource` either). Building that bidirectional
   * resource-reference wire support is its own substantial feature; this
   * intentionally replies with plain, already-composable descriptors
   * instead — the caller can `attach()`/`get()` any id it wants from there.
   */
  private async epRequestQueryResources(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const link = String(this.decode(tdu) ?? "");
    let resource: IResource | undefined;
    try {
      resource = await this.warehouse.query(link);
    } catch {
      resource = undefined;
    }
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    const children = await resource.instance.store.children<IResource>(resource);
    const allowed = children.filter((child) => this.isActionAllowed(child, ActionType.Attach));
    // [id, link] pairs — Codec.compose has no generic plain-object composer,
    // only Map/Array/etc.; a nested array composes fine through the same
    // dynamic-List path every other multi-field reply in this file uses.
    const descriptors = allowed.map((child) => [child.instance!.id, child.instance!.link ?? ""]);
    this.sendReply(EpPacketReply.Completed, callbackId, descriptors);
  }

  /**
   * Server handler (LinkTypeDefs, 0xC): resolve a link, reply with the
   * composed TypeDef payloads for the resource's type and every type it
   * transitively references through property/argument/return `Tru`s — a
   * bulk fetch of a type's full dependency graph in one round trip. Remote
   * (relayed) types are unsupported, matching dotnet.
   */
  private async epRequestLinkTypeDefs(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const link = String(this.decode(tdu) ?? "");
    let resource: IResource | undefined;
    try {
      resource = await this.warehouse.query(link);
    } catch {
      resource = undefined;
    }
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    const local = this.warehouse.getLocalTypeDefByType(resource.constructor);
    if (!(local instanceof LocalTypeDef)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotSupported);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        resource,
        ActionType.ViewTypeDef,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    const closure = new Map<number, LocalTypeDef>();
    collectTypeDefDependencies(local, closure);
    const payloads = [...closure.values()].map((td) =>
      compose(typeDefInfoFromTypeDef(td.id, td.kind, td.template), this.warehouse, this),
    );
    this.sendReply(EpPacketReply.Completed, callbackId, payloads);
  }

  /**
   * Silent (no error reply) permission check, for filtering a list of
   * candidates (e.g. Query's children) rather than gating a single request.
   */
  private isActionAllowed(resource: IResource | null, action: ActionType): boolean {
    if (!this.warehouse) return true;
    const context = new ResourceManagerContext(
      this.warehouse,
      this,
      this.getAuthenticationSession(),
      resource,
      null,
      action,
      this,
    );
    try {
      return this.warehouse.evaluateManagers(context).isAllowed;
    } catch {
      return false;
    }
  }

  /**
   * Server handler: pure per-connection bookkeeping — stop notifying *this*
   * connection about a resource; the resource itself keeps living in the
   * warehouse for other subscribers. The cleanup closure is the same one
   * {@link subscribeToInstance} stores on attach.
   */
  private async epRequestDetachResource(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const resourceId = Number(this.decode(tdu));
    const resource = this.warehouse.getById(resourceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        resource,
        ActionType.Detach,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    this.subscriptions.get(resourceId)?.();
    this.subscriptions.delete(resourceId);
    this.sendReply(EpPacketReply.Completed, callbackId);
  }

  /**
   * Server handler: rename a resource within its current parent (dotnet's
   * MoveResource never actually re-parents — same restriction here, no `/`
   * allowed in the new name). Unlike dotnet, which gets away with a bare
   * `Instance.Name = name` assignment, ts's `MemoryStore.link()` tracks a
   * resource's path via a separate `instance.variables` entry rather than
   * deriving it from `Instance.name` — so the rename has to go through
   * `IStore.move()`, which keeps both in sync.
   */
  private async epRequestMoveResource(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    let args: unknown[];
    try {
      args = this.decode(tdu) as unknown[];
    } catch {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const resourceId = Number(args[0]);
    const newName = String(args[1] ?? "");
    if (newName.includes("/")) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotSupported);
      return;
    }

    const resource = this.warehouse.getById(resourceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        resource,
        ActionType.Rename,
        callbackId,
        ErrorType.Management,
        ExceptionCode.RenameDenied,
      ))
    )
      return;

    const store = resource.instance.store;
    const relativeLink = store.link(resource) ?? resource.instance.name;
    const parts = relativeLink.split("/");
    parts[parts.length - 1] = newName;
    await store.move(resource, parts.join("/"));
    this.sendReply(EpPacketReply.Completed, callbackId);
  }

  /** Server handler: remove a resource from the warehouse and its store. */
  private async epRequestDeleteResource(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const resourceId = Number(this.decode(tdu));
    const resource = this.warehouse.getById(resourceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        resource,
        ActionType.Delete,
        callbackId,
        ErrorType.Management,
        ExceptionCode.DeleteDenied,
      ))
    )
      return;

    if (this.warehouse.remove(resource)) this.sendReply(EpPacketReply.Completed, callbackId);
    else this.sendError(ErrorType.Management, callbackId, ExceptionCode.DeleteFailed);
  }

  /**
   * Server handler: create a resource of a type already registered on this
   * warehouse (no dynamic/generic creation — matches dotnet's
   * `Activator.CreateInstance`-on-a-known-compiled-`Type` restriction).
   */
  private async epRequestCreateResource(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    let args: unknown[];
    try {
      args = this.decode(tdu) as unknown[];
    } catch {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const path = String(args[0] ?? "");
    const typeIdOrName = args[1];
    const props = (args[2] as Map<number, unknown> | undefined) ?? new Map<number, unknown>();
    const attrs = (args[3] as Map<string, unknown> | undefined) ?? undefined;

    let local: ITypeDef | undefined;
    try {
      local =
        typeof typeIdOrName === "string"
          ? this.warehouse.getLocalTypeDefByName(typeIdOrName)
          : this.warehouse.getLocalTypeDefById(Number(typeIdOrName));
    } catch {
      local = undefined;
    }
    if (!local || !(local instanceof LocalTypeDef)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ClassNotFound);
      return;
    }

    const parts = path.replace(/^\/+/, "").split("/");
    const parentPath = parts.slice(0, -1).join("/");
    let parent: IResource | undefined;
    try {
      parent = await this.warehouse.query(parentPath);
    } catch {
      parent = undefined;
    }
    if (!parent?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.StoreNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        parent,
        ActionType.CreateResource,
        callbackId,
        ErrorType.Management,
        ExceptionCode.CreateDenied,
      ))
    )
      return;

    try {
      const instance = local.createInstance() as IResource;
      for (const [index, value] of props) {
        const name = local.template.getPropertyByIndex(index)?.name;
        if (name) local.setProperty(instance, name, value);
      }
      const put = await this.warehouse.put(path, instance, { attributes: attrs });
      this.sendReply(EpPacketReply.Completed, callbackId, put.instance!.id);
    } catch (e) {
      this.sendError(ErrorType.Exception, callbackId, ExceptionCode.RuntimeException, String(e));
    }
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
    const onEvent = (info: { event: { index: number; subscribable?: boolean }; value: unknown }): void => {
      if (info.event.subscribable && !this.eventSubscriptions.get(instanceId)?.has(info.event.index)) return;
      this.sendNotification(
        EpPacketNotification.EventOccurred,
        instanceId,
        info.event.index,
        info.value,
      );
    };
    instance.propertyModified.add(onProp);
    instance.eventOccurred.add(onEvent);
    this.subscriptions.set(instanceId, () => {
      instance.propertyModified.remove(onProp);
      instance.eventOccurred.remove(onEvent);
    });
  }

  /** Server handler: resolve the resource, invoke the function by index, reply with its result. */
  private async epRequestInvokeFunction(callbackId: number, tdu: PlainTdu | null): Promise<void> {
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

    if (
      !(await this.tryApplyManagers(
        ft,
        resource,
        ActionType.Execute,
        callbackId,
        ErrorType.Management,
        ExceptionCode.AccessDenied,
        /* supportsDelay */ true,
      ))
    )
      return;

    const args = toIndexedArguments(parsed[2], ft.args.length);

    let result: unknown;
    try {
      // A relayed EpResource has no real class method matching `ft.name` —
      // only its own bespoke invoke-by-index, which forwards the call to
      // the upstream connection it's a proxy for.
      result =
        resource instanceof EpResource
          ? resource.invoke(index, args)
          : (resource as unknown as Record<string, (...a: unknown[]) => unknown>)[ft.name](
              ...args,
            );
    } catch (e) {
      this.sendError(ErrorType.Exception, callbackId, ExceptionCode.RuntimeException, String(e));
      return;
    }

    this.replyWithFunctionResult(callbackId, ft, result);
  }

  /** Shared invoke-result reply tail for {@link epRequestInvokeFunction} and {@link epRequestStaticCall}. */
  private replyWithFunctionResult(callbackId: number, ft: FunctionTemplate, result: unknown): void {
    if (ft.streamMode !== StreamMode.None) {
      this.beginStreamedReply(callbackId, ft, result);
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

  /**
   * Register a streaming call's result and reply `Stream` on `callbackId`
   * (the "execution callback" `PullStream`/etc. later reference). A `Push`
   * source is pumped immediately; a `Pull` source just sits registered until
   * an explicit `PullStream` request drives it.
   */
  private beginStreamedReply(callbackId: number, ft: FunctionTemplate, result: unknown): void {
    if (!isIterableResult(result)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotSupported);
      return;
    }

    const context = new ServerInvocationContext(result, ft.streamMode, ft.pausable);
    this.invocations.set(callbackId, context);
    this.sendReply(EpPacketReply.Stream, callbackId);

    if (ft.streamMode === StreamMode.Push) void this.pumpStream(callbackId, context);
  }

  /** Drive a `Push`-mode stream to completion, sending one `Chunk` reply per item. */
  private async pumpStream(executionCallbackId: number, context: ServerInvocationContext): Promise<void> {
    try {
      for (;;) {
        const r = await context.pullAsync();
        if (r.done) break;
        this.sendReply(EpPacketReply.Chunk, executionCallbackId, r.value);
      }
      this.invocations.delete(executionCallbackId);
      this.sendReply(EpPacketReply.Completed, executionCallbackId);
    } catch (e) {
      this.invocations.delete(executionCallbackId);
      this.sendError(ErrorType.Exception, executionCallbackId, ExceptionCode.RuntimeException, String(e));
    }
  }

  /** Server handler (PullStream): advance a `Pull`-mode stream by one item. */
  private async epRequestPullStream(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const executionCallbackId = Number(this.decode(tdu));
    const context = this.invocations.get(executionCallbackId);
    if (!context || context.streamMode !== StreamMode.Pull) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotAllowed);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        null,
        ActionType.PullStream,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    try {
      const r = await context.pullAsync();
      if (r.done) {
        this.invocations.delete(executionCallbackId);
        this.sendReply(EpPacketReply.Completed, executionCallbackId);
      } else {
        this.sendReply(EpPacketReply.Chunk, executionCallbackId, r.value);
      }
      this.sendReply(EpPacketReply.Completed, callbackId);
    } catch (e) {
      this.invocations.delete(executionCallbackId);
      this.sendError(ErrorType.Exception, executionCallbackId, ExceptionCode.RuntimeException, String(e));
      this.sendError(ErrorType.Exception, callbackId, ExceptionCode.RuntimeException, String(e));
    }
  }

  /** Server handler (TerminateExecution): stop a stream and release its iterator. */
  private async epRequestTerminateExecution(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const executionCallbackId = Number(this.decode(tdu));
    const context = this.invocations.get(executionCallbackId);
    if (!context) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotAllowed);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        null,
        ActionType.TerminateExecution,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    this.invocations.delete(executionCallbackId);
    await context.terminate();
    this.sendReply(EpPacketReply.Completed, executionCallbackId);
    this.sendReply(EpPacketReply.Completed, callbackId);
  }

  /** Server handler (HaltExecution): pause a pausable stream. */
  private async epRequestHaltExecution(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const executionCallbackId = Number(this.decode(tdu));
    const context = this.invocations.get(executionCallbackId);
    if (!context) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotAllowed);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        null,
        ActionType.HaltExecution,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    try {
      context.halt();
      this.sendReply(EpPacketReply.Completed, callbackId);
    } catch {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotAllowed);
    }
  }

  /** Server handler (ResumeExecution): resume a halted stream. */
  private async epRequestResumeExecution(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const executionCallbackId = Number(this.decode(tdu));
    const context = this.invocations.get(executionCallbackId);
    if (!context) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotAllowed);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        null,
        null,
        ActionType.ResumeExecution,
        callbackId,
        ErrorType.Management,
        ExceptionCode.NotAllowed,
      ))
    )
      return;

    try {
      context.resume();
      this.sendReply(EpPacketReply.Completed, callbackId);
    } catch {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotAllowed);
    }
  }

  /**
   * Server handler (StaticCall): invoke a `static` exported function by
   * TypeDef id + function index — class-level, no resource instance
   * involved.
   */
  private async epRequestStaticCall(callbackId: number, tdu: PlainTdu | null): Promise<void> {
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

    const typeId = Number(parsed[0]);
    const index = Number(parsed[1]);
    const args = (parsed[2] as unknown[]) ?? [];

    let local: ITypeDef;
    try {
      local = this.warehouse.getLocalTypeDefById(typeId);
    } catch {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.TypeDefNotFound);
      return;
    }
    if (!(local instanceof LocalTypeDef)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.TypeDefNotFound);
      return;
    }

    const ft = local.template.getFunctionByIndex(index);
    if (!ft || !ft.isStatic) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.MethodNotFound);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        ft,
        null,
        ActionType.Execute,
        callbackId,
        ErrorType.Management,
        ExceptionCode.InvokeDenied,
        /* supportsDelay */ true,
      ))
    )
      return;

    let result: unknown;
    try {
      result = local.invokeStaticFunction(ft.name, args);
    } catch (e) {
      this.sendError(ErrorType.Exception, callbackId, ExceptionCode.RuntimeException, String(e));
      return;
    }

    this.replyWithFunctionResult(callbackId, ft, result);
  }

  /** Server handler: resolve the resource and set a property by index. */
  private async epRequestSetProperty(callbackId: number, tdu: PlainTdu | null): Promise<void> {
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

    if (
      !(await this.tryApplyManagers(
        pt,
        resource,
        ActionType.SetProperty,
        callbackId,
        ErrorType.Management,
        ExceptionCode.AccessDenied,
        /* supportsDelay */ true,
      ))
    )
      return;

    if (isDynamicResource(resource)) resource.setResourceProperty(pt.index, value);
    else (resource as unknown as Record<string, unknown>)[pt.name] = value;
    this.sendReply(EpPacketReply.Completed, callbackId);
  }

  /**
   * Server handler: an already-attached connection asks to start receiving a
   * `subscribable` event's occurrences. Errors `AlreadyListened` on a
   * duplicate call — callers must track subscription state themselves (see
   * {@link EpResource.on}) rather than relying on this being a no-op.
   */
  private async epRequestSubscribe(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const parsed = this.decode(tdu) as unknown[];
    const resourceId = Number(parsed[0]);
    const index = Number(parsed[1]);

    const resource = this.warehouse.getById(resourceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }
    if (!this.subscriptions.has(resourceId)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotAttached);
      return;
    }
    const et = resource.instance.definition.getEventByIndex(index);
    if (!et) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.GeneralFailure);
      return;
    }
    if (!et.subscribable) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotSubscribable);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        et,
        resource,
        ActionType.Subscribe,
        callbackId,
        ErrorType.Management,
        ExceptionCode.AccessDenied,
      ))
    )
      return;

    const subscribed = this.eventSubscriptions.get(resourceId) ?? new Set<number>();
    if (subscribed.has(index)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.AlreadyListened);
      return;
    }
    subscribed.add(index);
    this.eventSubscriptions.set(resourceId, subscribed);

    // Relaying through a proxy: this resource only receives the event at all
    // if *it* is subscribed upstream. Ref-count via .on() so the upstream
    // wire subscription stays alive for as long as any downstream peer
    // (there may be several) needs it.
    if (resource instanceof EpResource) {
      const key = `${resourceId}:${index}`;
      const listener = (): void => {};
      this.relayListeners.set(key, listener);
      resource.on(et.name, listener);
    }

    this.sendReply(EpPacketReply.Completed, callbackId);
  }

  /** Server handler: the mirror of {@link epRequestSubscribe}. */
  private async epRequestUnsubscribe(callbackId: number, tdu: PlainTdu | null): Promise<void> {
    if (!tdu || !this.warehouse) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ParseError);
      return;
    }

    const parsed = this.decode(tdu) as unknown[];
    const resourceId = Number(parsed[0]);
    const index = Number(parsed[1]);

    const resource = this.warehouse.getById(resourceId);
    if (!resource?.instance) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.ResourceNotFound);
      return;
    }
    if (!this.subscriptions.has(resourceId)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.NotAttached);
      return;
    }
    const et = resource.instance.definition.getEventByIndex(index);
    if (!et) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.GeneralFailure);
      return;
    }

    const subscribed = this.eventSubscriptions.get(resourceId);
    if (!subscribed?.has(index)) {
      this.sendError(ErrorType.Management, callbackId, ExceptionCode.AlreadyUnsubscribed);
      return;
    }

    if (
      !(await this.tryApplyManagers(
        et,
        resource,
        ActionType.Unsubscribe,
        callbackId,
        ErrorType.Management,
        ExceptionCode.AccessDenied,
      ))
    )
      return;

    subscribed.delete(index);

    if (resource instanceof EpResource) {
      const key = `${resourceId}:${index}`;
      const listener = this.relayListeners.get(key);
      if (listener) {
        resource.off(et.name, listener);
        this.relayListeners.delete(key);
      }
    }

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
      case EpPacketReply.Stream:
        this.replyStream(callbackId);
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
      case EpPacketReply.Chunk:
        this.replyChunk(callbackId, tdu);
        break;
      case EpPacketReply.Warning:
        this.replyWarning(callbackId, tdu);
        break;
    }
  }

  private decode(tdu: PlainTdu | null): unknown {
    if (!tdu) return undefined;
    // A top-level `TduIdentifier.TypeDef` (0x81) value is never generically
    // decoded here: its `PropertyDefInfo.valueType`/`FunctionDefInfo.returnType`/
    // etc. fields commonly reference other not-yet-fetched remote TypeDefs on
    // this connection, which only the async, resolver-aware
    // `RemoteTypeDef.parseAsyncInto` (driven by `finishTypeDefRequest`) can
    // resolve. Hand back the raw TDU bytes instead, matching the shape the
    // legacy wire format already produced (a `RawData` payload) so
    // `expectTypeDefPayload`/`RemoteTypeDef.parse*` work unchanged either way.
    if (tdu.identifier === TduIdentifier.TypeDef)
      return tdu.data.subarray(tdu.tduOffset, tdu.tduOffset + tdu.totalLength);
    return parse(tdu.data, tdu.tduOffset, this.warehouse);
  }

  private replyCompleted(callbackId: number, tdu: PlainTdu | null): void {
    const req = this.requests.get(callbackId);
    if (!req) return;
    this.requests.delete(callbackId);
    // A `Completed` reply for a streamed invocation signals both "the call
    // is done" (the normal `trigger`, inherited unchanged) and "no more
    // chunks are coming" — without the latter, `for await` consumers of an
    // `AsyncStreamReply` would hang waiting on a chunk that will never arrive.
    if (req instanceof AsyncStreamReply) req.triggerStreamCompleted();
    req.trigger(this.decode(tdu));
  }

  private replyStream(callbackId: number): void {
    const req = this.requests.get(callbackId);
    if (req instanceof AsyncStreamReply) req.triggerStreamStarted();
  }

  private replyChunk(callbackId: number, tdu: PlainTdu | null): void {
    this.requests.get(callbackId)?.triggerChunk(this.decode(tdu));
  }

  private replyWarning(callbackId: number, tdu: PlainTdu | null): void {
    const args = (this.decode(tdu) as unknown[]) ?? [];
    this.requests
      .get(callbackId)
      ?.triggerWarning(Number(args[0] ?? 0), String(args[1] ?? ""));
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
    this.eventSubscriptions.clear();

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

/**
 * Walk `local`'s properties/functions/events for `Tru`s referencing another
 * local type (`TruTypeDef`, recursing through `TruComposite` sub-types for
 * typed lists/maps/tuples), collecting the full transitive closure. Used by
 * `LinkTypeDefs` to bulk-fetch a type's dependency graph in one round trip.
 */
function collectTypeDefDependencies(local: LocalTypeDef, closure: Map<number, LocalTypeDef>): void {
  if (closure.has(local.id)) return;
  closure.set(local.id, local);

  const visitTru = (tru: Tru | undefined): void => {
    if (!tru) return;
    if (tru instanceof TruTypeDef) {
      if (tru.typeDef instanceof LocalTypeDef) collectTypeDefDependencies(tru.typeDef, closure);
      return;
    }
    if (tru instanceof TruComposite) for (const sub of tru.subTypes) visitTru(sub);
  };

  for (const p of local.template.properties) visitTru(p.valueType);
  for (const f of local.template.functions) {
    visitTru(f.returnType);
    for (const a of f.args) visitTru(a.type);
  }
  for (const e of local.template.events) visitTru(e.argType);
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

function asBytes(value: unknown): Uint8Array | undefined {
  return value instanceof Uint8Array ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function readTypeDefPayloadId(data: Uint8Array, warehouse: unknown): number {
  if (data.length < 1)
    throw new AsyncException(
      ErrorType.Management,
      ExceptionCode.ParseError,
      "TypeDef payload is too short.",
    );

  if ((data[0] & 0xc7) === TduIdentifier.TypeDef) {
    // No fixed-offset shortcut exists in the new format (matching dotnet) —
    // the id is `TypeDefField.Id` inside the indexed structure, so extracting
    // it requires a full (small) decode.
    const parsed = parseSync(data, 0, warehouse);
    if (!(parsed.value instanceof TypeDefInfo))
      throw new AsyncException(
        ErrorType.Management,
        ExceptionCode.ParseError,
        "Invalid TypeDefInfo payload.",
      );
    return parsed.value.id;
  }

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
