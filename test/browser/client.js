/* global document, fetch, window */

import {
  AuthenticationMode,
  EpConnection,
  EpConnectionContext,
  IdentityPassword,
  MemberType,
  PasswordAuthenticationProvider,
  Resource,
  Warehouse,
  event,
  t,
} from "/esiur/index.js";

const clientPassword = Uint8Array.of(1, 2, 3, 4, 5);
const memberSymbol = Symbol.for("esiur.members");

class BrowserClientAuthenticationProvider extends PasswordAuthenticationProvider {
  getSelfIdentityAndCredential(domain, hostname) {
    return domain === "test" && hostname === "localhost"
      ? new IdentityPassword("tester", clientPassword)
      : new IdentityPassword();
  }

  getSelfCredential(identity, domain, hostname) {
    return identity === "tester" && domain === "test" && hostname === "localhost"
      ? clientPassword
      : null;
  }
}

class BrowserServiceStub extends Resource {
  message = event();

  get level() {
    return 0;
  }

  get status() {
    return "";
  }

  greet() {
    return "";
  }

  add() {
    return 0;
  }

  raise() {
    return "";
  }

  snapshot() {
    return "";
  }

  setLevel() {
    return 0;
  }
}

BrowserServiceStub[Symbol.metadata] = {
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

const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");

runBrowserClientTest().then(
  () => {
    statusEl.textContent = "PASS";
    statusEl.className = "pass";
    window.__esiurBrowserClientTestResult = { ok: true };
  },
  (error) => {
    statusEl.textContent = "FAIL";
    statusEl.className = "fail";
    log(`FAIL ${error?.stack ?? error}`);
    window.__esiurBrowserClientTestResult = { ok: false, error: String(error?.stack ?? error) };
  },
);

async function runBrowserClientTest() {
  const config = window.__esiurBrowserClientTest;
  assert(config?.epUrl, "Browser test config is missing epUrl.");
  log(`EP server: ${config.epUrl}`);

  const clientWarehouse = new Warehouse();
  clientWarehouse.RegisterAuthenticationProvider(new BrowserClientAuthenticationProvider());

  const connection = await clientWarehouse.Get(
    config.epUrl,
    new EpConnectionContext({
      AuthenticationMode: AuthenticationMode.InitializerIdentity,
      AuthenticationProtocol: "password-sha3-v1",
      AutoReconnect: true,
      ReconnectInterval: 25,
      Identity: "tester",
      Domain: "test",
    }),
  );

  assert(connection instanceof EpConnection, "Warehouse.Get did not return an EpConnection.");
  assert(connection.isAuthenticated, "Client connection is not authenticated.");
  assert(connection.authenticationSessionKey?.length === 64, "Session key was not derived.");
  log("Authenticated with hash provider.");

  const typeDef = clientWarehouse.getTypeDef(BrowserServiceStub);
  const remote = await connection.Get("sys/service", typeDef);
  const propertyChanges = [];
  const events = [];
  remote.propertyModified.add((change) => propertyChanges.push(change));
  remote.eventOccurred.add((occurrence) => events.push(occurrence));

  assert(remote.level === 1, "Initial level snapshot mismatch.");
  assert(remote.status === "idle", "Initial status snapshot mismatch.");
  log("Attached remote resource and read initial properties.");

  assert((await remote.greet("Browser")) === "Hello Browser:2", "greet returned unexpected value.");
  await waitFor(() => remote.level === 2 && remote.status === "greeted:Browser");
  assert(
    propertyChanges.some((p) => p.name === "level" && p.value === 2),
    "Missing level notification.",
  );
  assert(
    propertyChanges.some((p) => p.name === "status" && p.value === "greeted:Browser"),
    "Missing status notification.",
  );
  log("Invoked function and received property notifications.");

  assert((await remote.add(20, 22)) === 42, "add returned unexpected value.");

  await connection.set(remote.instanceId, typeDef.getPropertyByName("status").index, "browser-set");
  await waitFor(async () => (await remote.snapshot()) === "2:browser-set");
  log("Set server property from browser client.");

  assert((await remote.raise("browser-ping")) === "BROWSER-PING", "raise returned unexpected value.");
  await waitFor(() =>
    events.some((e) => e.name === "message" && e.value === "browser-ping"),
  );
  log("Received exported event.");

  assert((await remote.setLevel(7)) === 7, "setLevel returned unexpected value.");
  await waitFor(() => remote.level === 7);
  log("Observed server-pushed property update.");

  await fetch("/drop", { method: "POST" });
  await waitFor(() => connection.isConnected && remote.level === 99 && remote.status === "after-drop", 3500);
  assert(
    connection.lastReconnectMetrics?.restoredResources >= 1,
    "Reconnect did not restore the attached resource.",
  );
  assert((await remote.add(1, 2)) === 3, "RPC failed after reconnect.");
  log("Reconnected and reattached after server-side disconnect.");

  connection.close();
}

function log(message) {
  logEl.textContent += `${message}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for condition.");
}
