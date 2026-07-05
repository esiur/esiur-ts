import type { Warehouse } from "../resource/Warehouse.js";
import { WSocket } from "../net/sockets/WSocket.js";
import { EpConnection } from "./EpConnection.js";
import type { IAuthenticationProvider } from "../security/IAuthenticationProvider.js";

export interface EpServerOptions {
  /** Port to listen on (0 = an ephemeral port). */
  port: number;
  /** Host interface (default: all). */
  host?: string;
  /** Warehouse whose resources are served to connecting peers. */
  warehouse: Warehouse;
  /** Accept anonymous (None-mode) peers. Default true. */
  allowUnauthorized?: boolean;
  /** Optional authentication provider to register on the served warehouse. */
  authenticationProvider?: IAuthenticationProvider;
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
  private constructor(readonly warehouse: Warehouse) {}

  /** Start listening and accepting connections bound to `warehouse`. */
  static async listen(options: EpServerOptions): Promise<EpServer> {
    const server = new EpServer(options.warehouse);
    if (options.authenticationProvider)
      options.warehouse.registerAuthenticationProvider(options.authenticationProvider);

    const { WebSocketServer } = await import("ws");
    const wss = new WebSocketServer({ port: options.port, host: options.host });
    server.wss = wss;

    await new Promise<void>((resolve, reject) => {
      wss.once("listening", () => resolve());
      wss.once("error", reject);
    });

    wss.on("connection", (raw) => {
      const connection = new EpConnection();
      connection.warehouse = options.warehouse;
      connection.allowUnauthorized = options.allowUnauthorized ?? true;
      connection.startResponderHandshake(); // wait for the peer's Initialize
      connection.assign(new WSocket(raw as unknown as WebSocket));
      server.connections.add(connection);
      connection.onClose.add(() => server.connections.delete(connection));
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
}
