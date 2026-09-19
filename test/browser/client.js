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
    const detail = describeError(error);
    log(`FAIL ${detail}`);
    window.__esiurBrowserClientTestResult = { ok: false, error: detail };
  },
);

async function runBrowserClientTest() {
  const config = window.__esiurBrowserClientTest;
  assert(config?.epUrl, "Browser test config is missing epUrl.");
  log(`EP server: ${config.epUrl}`);

  if (config.fixture === "dotnet-flow-graph") {
    await runDotnetFlowGraphTest(config.epUrl);
    return;
  }

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
  await remote.onAsync("message", (value) => events.push(value));

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

  log("Invoking async add function.");
  assert((await remote.add(20, 22)) === 42, "add returned unexpected value.");

  await connection.set(remote.instanceId, typeDef.getPropertyByName("status").index, "browser-set");
  await waitFor(async () => (await remote.snapshot()) === "2:browser-set");
  log("Set server property from browser client.");

  assert((await remote.raise("browser-ping")) === "BROWSER-PING", "raise returned unexpected value.");
  await waitFor(() => events.includes("browser-ping"));
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

async function runDotnetFlowGraphTest(epUrl) {
  const connection = await EpConnection.connect(epUrl);
  assert(connection.isConnected, "Browser did not connect to the .NET fixture.");
  const workspace = await within(connection.Get("sys/workspace"), 5000, "attach workspace");
  const revisionFunction = workspace.resourceDefinition.getFunctionByName("GetFlowRevision");
  const snapshotFunction = workspace.resourceDefinition.getFunctionByName("GetFlowSnapshot");
  const pulseFunction = workspace.resourceDefinition.getFunctionByName("Pulse");
  assert(revisionFunction && snapshotFunction && pulseFunction, "Flow workspace functions are missing.");

  const switchFlow = async (flowId) => {
    const revision = connection.invoke(workspace.instanceId, revisionFunction.index, flowId);
    const root = connection.Get(`sys/workspace/flows/${flowId}/blocks/${flowId * 1000}`);
    const snapshot = connection.invoke(workspace.instanceId, snapshotFunction.index, flowId);
    const [revisionJson, attachedRoot, typedSnapshot] = await within(
      Promise.all([revision, root, snapshot]),
      8000,
      `switch flow ${flowId}`,
    );
    assert(JSON.parse(String(revisionJson)).flowId === flowId, `Revision ${flowId} mismatch.`);
    assert(attachedRoot.link.includes(`/flows/${flowId}/`), `Root ${flowId} mismatch.`);
    assert(Number(typedSnapshot.FlowId) === flowId, `Snapshot ${flowId} mismatch.`);
  };

  const switches = Array.from({ length: 6 }, () => [1, 2, 3].map((flowId) => switchFlow(flowId))).flat();
  const pulses = Array.from({ length: 6 }, (_, seed) =>
    within(connection.invoke(workspace.instanceId, pulseFunction.index, seed), 5000, `pulse ${seed}`),
  );
  await within(Promise.all([...switches, ...pulses]), 20000, "browser flow graph workload");

  let missingRejected = false;
  try {
    await within(connection.Get("sys/workspace/flows/99/blocks/99000"), 2000, "missing block");
  } catch {
    missingRejected = true;
  }
  assert(missingRejected, "Missing browser resource did not reject.");
  await switchFlow(2);
  assert(connection.isConnected, "Connection closed after rapid browser flow switching.");
  log("Chromium sustained dense .NET resource attach, TypeDefs, updates, and flow switching.");
  connection.close();
}

async function within(promise, timeoutMs, operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${operation} did not finish within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function log(message) {
  logEl.textContent += `${message}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function describeError(error) {
  if (error == null) return String(error);
  const parts = [
    error.name,
    error.message,
    error.type == null ? "" : `type=${error.type}`,
    error.code == null ? "" : `code=${error.code}`,
  ].filter(Boolean);
  return `${parts.join(" · ")}\n${error.stack ?? ""}`.trim();
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
