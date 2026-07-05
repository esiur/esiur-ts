import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  DC,
  EpServer,
  MemberType,
  MemoryStore,
  PasswordAuthenticationHandler,
  PasswordAuthenticationProvider,
  PasswordHash,
  Resource,
  Warehouse,
  event,
  t,
} from "../../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const clientPassword = Uint8Array.of(1, 2, 3, 4, 5);
const serverSalt = Uint8Array.of(6, 7, 8, 9, 10);
const memberSymbol = Symbol.for("esiur.members");

class BrowserService extends Resource {
  #level = 1;
  #status = "idle";

  message = event();

  get level() {
    return this.#level;
  }

  set level(value) {
    this.#level = value;
    this.instance?.modified("level", value);
  }

  get status() {
    return this.#status;
  }

  set status(value) {
    this.#status = value;
    this.instance?.modified("status", value);
  }

  greet(name) {
    this.level++;
    this.status = `greeted:${name}`;
    return `Hello ${name}:${this.level}`;
  }

  async add(a, b) {
    return a + b;
  }

  raise(message) {
    this.message.emit(message);
    return message.toUpperCase();
  }

  snapshot() {
    return `${this.level}:${this.status}`;
  }

  setLevel(value) {
    this.level = value;
    return this.level;
  }
}

BrowserService[Symbol.metadata] = {
  [memberSymbol]: [
    { kind: MemberType.Property, name: "level", type: t.i32 },
    { kind: MemberType.Property, name: "status", type: t.string },
    { kind: MemberType.Event, name: "message", type: t.string },
    { kind: MemberType.Function, name: "greet", type: t.string, args: [t.string] },
    { kind: MemberType.Function, name: "add", type: t.i32, args: [t.i32, t.i32] },
    { kind: MemberType.Function, name: "raise", type: t.string, args: [t.string] },
    { kind: MemberType.Function, name: "snapshot", type: t.string, args: [] },
    { kind: MemberType.Function, name: "setLevel", type: t.i32, args: [t.i32] },
  ],
};

class BrowserServerAuthenticationProvider extends PasswordAuthenticationProvider {
  getHostedAccountCredential(identity, domain) {
    return identity === "tester" && domain === "test"
      ? new PasswordHash(
          PasswordAuthenticationHandler.computeSha3(DC.merge(clientPassword, serverSalt)),
          serverSalt,
        )
      : new PasswordHash();
  }
}

const warehouse = new Warehouse();
warehouse.RegisterAuthenticationProvider(new BrowserServerAuthenticationProvider());
await warehouse.put("sys", new MemoryStore());
const service = await warehouse.put("sys/service", new BrowserService());
await warehouse.open();

const epServer = await EpServer.listen({
  port: 0,
  warehouse,
  allowUnauthorized: false,
});

const httpServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "POST" && url.pathname === "/drop") {
      for (const connection of [...epServer.connections]) connection.close();
      service.level = 99;
      service.status = "after-drop";
      send(res, 204, "text/plain", "");
      return;
    }

    if (url.pathname === "/config.js") {
      send(
        res,
        200,
        "application/javascript",
        `window.__esiurBrowserClientTest = { epUrl: "ws://localhost:${epServer.port}" };\n`,
      );
      return;
    }

    if (url.pathname === "/" || url.pathname === "/client.html") {
      send(res, 200, "text/html; charset=utf-8", await readFile(join(__dirname, "client.html")));
      return;
    }

    if (url.pathname === "/client.js") {
      send(
        res,
        200,
        "application/javascript",
        await readFile(join(__dirname, "client.js")),
      );
      return;
    }

    if (url.pathname === "/esiur/index.js") {
      send(
        res,
        200,
        "application/javascript",
        await readFile(join(projectRoot, "dist", "index.js")),
      );
      return;
    }

    send(res, 404, "text/plain", "Not found");
  } catch (error) {
    send(res, 500, "text/plain", error?.stack ?? String(error));
  }
});

await new Promise((resolve) => httpServer.listen(0, "localhost", resolve));
const address = httpServer.address();
const httpPort = typeof address === "object" && address ? address.port : 0;

console.log(`Esiur browser client test server is running.`);
console.log(`Open http://localhost:${httpPort}/ in a browser.`);
console.log(`EP WebSocket server: ws://localhost:${epServer.port}`);
console.log(`Press Ctrl+C to stop.`);

const close = async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  await epServer.close();
};

process.once("SIGINT", () => {
  close().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  close().finally(() => process.exit(0));
});

function send(res, status, contentType, body) {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}
