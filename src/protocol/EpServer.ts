import type { Warehouse } from "../resource/Warehouse.js";
import { WSocket } from "../net/sockets/WSocket.js";
import { EpConnection } from "./EpConnection.js";
import type { IAuthenticationProvider } from "../security/IAuthenticationProvider.js";
import type { VerifyClientCallbackAsync } from "ws";
import { ESIUR_DEFAULT_PORT } from "./EpProtocol.js";

/**
 * The WebSocket subprotocol a connecting peer must request (matches
 * `WSocket`'s `EP_SUBPROTOCOL` and esiur-dotnet's `FrameworkWebSocket.SubProtocol`).
 * Upgrades that don't request it -- exactly and case-sensitively -- are rejected
 * with `400 Bad Request`, mirroring esiur-dotnet's `EsiurWebSocketEndpoint` and
 * the raw-TCP upgrade path in `EpConnection.cs`.
 */
const EP_SUBPROTOCOL = "EP";
const textEncoder = new TextEncoder();
const DEFAULT_MAXIMUM_HEADER_LENGTH = 64 * 1024;
const DEFAULT_MAXIMUM_HEADER_COUNT = 100;

/** Always negotiate "EP" itself, regardless of what else the client offered. */
function selectEpSubprotocol(protocols: Set<string>): string | false {
  return protocols.has(EP_SUBPROTOCOL) ? EP_SUBPROTOCOL : false;
}

/** Split a raw `Sec-WebSocket-Protocol` header value into its comma-separated tokens. */
function requestedProtocols(header: string | string[] | undefined): string[] {
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (!raw) return [];
  return raw
    .split(",")
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.length > 0);
}

export interface EpServerOptions {
  /** Port to listen on (default 51018; 0 = an ephemeral port). */
  port?: number;
  /** Host interface (default: all). */
  host?: string;
  /** Warehouse whose resources are served to connecting peers. */
  warehouse: Warehouse;
  /** Accept anonymous (None-mode) peers. Default true. */
  allowUnauthorized?: boolean;
  /** Optional authentication provider to register on the served warehouse. */
  authenticationProvider?: IAuthenticationProvider;
  /** Maximum WebSocket upgrade header bytes. `0` disables. Default 64 KiB. */
  maximumHeaderLength?: number;
  /** Maximum WebSocket upgrade header fields. `0` disables. Default 100. */
  maximumHeaderCount?: number;
  /** Maximum authentication-handshake duration in milliseconds. Default 30 seconds. */
  authenticationTimeoutMs?: number;
}

/** Count an HTTP/1 upgrade header block as serialized on the wire. */
function upgradeHeaderLength(rawHeaders: string[]): number {
  let length = 2; // final CRLF after the last header
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index] ?? "";
    const value = rawHeaders[index + 1] ?? "";
    length += textEncoder.encode(`${name}: ${value}\r\n`).length;
  }
  return length;
}

/**
 * A WebSocket server that hosts a {@link Warehouse}'s resources for remote peers
 * (the TypeScript analogue of C# `DistributedServer`/`EpServer`). Node-only: it
 * dynamically imports `ws`, so importing this module does not pull `ws` into a
 * browser bundle.
 */
export class EpServer {
  /** Live client connections. */
  readonly connections = new Set<EpConnection>();

  private wss: any;
  private readonly connectionAddresses = new Map<EpConnection, string | null>();
  private readonly connectionCountsByAddress = new Map<string, number>();
  private readonly attemptWindowsByAddress = new Map<string, { startedAt: number; count: number }>();
  private globalAttemptWindow = { startedAt: Date.now(), count: 0 };
  private attemptSweepSequence = 0;
  private constructor(readonly warehouse: Warehouse) {}

  /** Start listening and accepting connections bound to `warehouse`. */
  static async listen(options: EpServerOptions): Promise<EpServer> {
    const port = options.port ?? ESIUR_DEFAULT_PORT;
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new RangeError("EpServer.listen port must be from 0 through 65535.");

    const server = new EpServer(options.warehouse);
    const maximumHeaderLength = options.maximumHeaderLength
      ?? DEFAULT_MAXIMUM_HEADER_LENGTH;
    const maximumHeaderCount = options.maximumHeaderCount
      ?? DEFAULT_MAXIMUM_HEADER_COUNT;
    const authenticationTimeoutMs = options.authenticationTimeoutMs ?? 30_000;
    for (const [name, value] of Object.entries({
      maximumHeaderLength,
      maximumHeaderCount,
      authenticationTimeoutMs,
    }))
      if (!Number.isFinite(value) || value < 0)
        throw new RangeError(`${name} must be a non-negative finite number.`);
    if (options.authenticationProvider)
      options.warehouse.registerAuthenticationProvider(options.authenticationProvider);

    const { WebSocketServer } = await import("ws");
    const verifyClient: VerifyClientCallbackAsync = (info, callback) => {
      const headerCount = Math.floor(info.req.rawHeaders.length / 2);
      const headerLength = upgradeHeaderLength(info.req.rawHeaders);
      if (maximumHeaderCount > 0 && headerCount > maximumHeaderCount) {
        callback(false, 431, "Too many WebSocket upgrade headers.");
        return;
      }
      if (maximumHeaderLength > 0 && headerLength > maximumHeaderLength) {
        callback(false, 431, "WebSocket upgrade headers are too large.");
        return;
      }
      const protocols = requestedProtocols(info.req.headers["sec-websocket-protocol"]);
      if (!protocols.includes(EP_SUBPROTOCOL)) {
        callback(false, 400, `The '${EP_SUBPROTOCOL}' WebSocket subprotocol is required.`);
        return;
      }

      const rejection = server.admitConnectionAttempt(
        normalizeAddress(info.req.socket.remoteAddress),
      );
      if (rejection) callback(false, 503, rejection);
      else callback(true);
    };

    const wss = new WebSocketServer({
      port,
      host: options.host,
      verifyClient,
      handleProtocols: selectEpSubprotocol,
      maxPayload: Math.max(
        options.warehouse.configuration.parser.maximumPacketSize,
        options.warehouse.configuration.encryption.maximumRecordSize,
      ) || undefined,
    });
    server.wss = wss;

    await new Promise<void>((resolve, reject) => {
      wss.once("listening", () => resolve());
      wss.once("error", reject);
    });

    wss.on("connection", (raw, request) => {
      const address = normalizeAddress(request?.socket?.remoteAddress);
      const connection = new EpConnection();
      if (!server.registerConnection(connection, address)) {
        raw.close(1013, "EP connection admission limit reached.");
        return;
      }
      connection.warehouse = options.warehouse;
      connection.allowUnauthorized = options.allowUnauthorized ?? true;
      connection.authenticationTimeoutMs = authenticationTimeoutMs;
      connection.startResponderHandshake(); // wait for the peer's Initialize
      connection.assign(new WSocket(raw as unknown as WebSocket));
      server.connections.add(connection);
      connection.onClose.add(() => server.releaseConnection(connection));
    });

    return server;
  }

  /** The bound port (useful when listening on port 0). */
  get port(): number {
    const addr = this.wss.address();
    return typeof addr === "object" && addr ? addr.port : 0;
  }

  /** Stop the server and close all connections. */
  close(): Promise<void> {
    return new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private admitConnectionAttempt(address: string | null): string | null {
    const configuration = this.warehouse.configuration.connections;
    const now = Date.now();
    const windowMs = configuration.connectionAttemptWindowMs;

    if (configuration.maximumConnectionAttempts > 0 && windowMs > 0) {
      if (now - this.globalAttemptWindow.startedAt >= windowMs)
        this.globalAttemptWindow = { startedAt: now, count: 0 };
      if (this.globalAttemptWindow.count >= configuration.maximumConnectionAttempts)
        return "The global EP connection-attempt limit was reached.";
      this.globalAttemptWindow.count++;
    }

    if (
      configuration.maximumConnections > 0
      && this.connectionAddresses.size >= configuration.maximumConnections
    )
      return "The global EP concurrent-connection limit was reached.";

    if (address == null) return null;

    if (++this.attemptSweepSequence % 256 === 0 && windowMs > 0) {
      for (const [key, value] of this.attemptWindowsByAddress)
        if (now - value.startedAt >= windowMs) this.attemptWindowsByAddress.delete(key);
    }

    if (configuration.maximumConnectionAttemptsPerIpAddress > 0 && windowMs > 0) {
      let attempts = this.attemptWindowsByAddress.get(address);
      if (!attempts || now - attempts.startedAt >= windowMs) {
        attempts = { startedAt: now, count: 0 };
        this.attemptWindowsByAddress.set(address, attempts);
      }
      if (attempts.count >= configuration.maximumConnectionAttemptsPerIpAddress)
        return "The per-IP EP connection-attempt limit was reached.";
      attempts.count++;
    }

    const count = this.connectionCountsByAddress.get(address) ?? 0;
    if (
      configuration.maximumConnectionsPerIpAddress > 0
      && count >= configuration.maximumConnectionsPerIpAddress
    )
      return "The per-IP EP concurrent-connection limit was reached.";

    return null;
  }

  private registerConnection(connection: EpConnection, address: string | null): boolean {
    const configuration = this.warehouse.configuration.connections;
    if (
      configuration.maximumConnections > 0
      && this.connectionAddresses.size >= configuration.maximumConnections
    )
      return false;

    if (address != null) {
      const count = this.connectionCountsByAddress.get(address) ?? 0;
      if (
        configuration.maximumConnectionsPerIpAddress > 0
        && count >= configuration.maximumConnectionsPerIpAddress
      )
        return false;
      this.connectionCountsByAddress.set(address, count + 1);
    }
    this.connectionAddresses.set(connection, address);
    return true;
  }

  private releaseConnection(connection: EpConnection): void {
    this.connections.delete(connection);
    const address = this.connectionAddresses.get(connection);
    if (!this.connectionAddresses.delete(connection) || address == null) return;

    const count = this.connectionCountsByAddress.get(address) ?? 0;
    if (count <= 1) this.connectionCountsByAddress.delete(address);
    else this.connectionCountsByAddress.set(address, count - 1);
  }
}

function normalizeAddress(address: string | undefined): string | null {
  if (!address) return null;
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}
