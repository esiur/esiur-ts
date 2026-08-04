#!/usr/bin/env node
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { EpConnection, ResourceId } from "../../dist/index.js";

if (typeof globalThis.WebSocket === "undefined") {
  const ws = await import("ws");
  globalThis.WebSocket = ws.WebSocket;
}

const args = parseArgs(process.argv.slice(2));
const host = args.host ?? "127.0.0.1";
const port = Number(args.port);
if (!args.url && (!Number.isInteger(port) || port <= 0 || port > 65535))
  throw new Error("Supply --port with the server's configured port, or supply --url.");
const epUrl = args.url ?? `ep://${host}:${port}`;
const serverUrl = toWebSocketUrl(epUrl);
const resourcePath = args["resource-path"] ?? args.resource ?? "sys/recovery";
const offlineDurations = parseNumberList(args["offline-durations"] ?? "2000,5000,10000");
const iterations = Number(args.iterations ?? 5);
const updatePeriodMs = Number(args["update-period"] ?? 100);
const warmupMs = Number(args.warmup ?? Math.max(1000, updatePeriodMs * 5));
const operationTimeoutMs = Number(args.timeout ?? 10000);
const outputDir = path.resolve(args.output ?? "results");

const csvPath = path.join(outputDir, "cross_language_recovery_results.csv");
const typedefPath = path.join(outputDir, "typedef_snapshot.json");
const logPath = path.join(outputDir, "run_log.jsonl");
const summaryPath = path.join(outputDir, "summary.md");

const csvColumns = [
  "run_id",
  "offline_duration_ms",
  "update_period_ms",
  "typedef_received",
  "typedef_property_count",
  "typedef_function_count",
  "typedef_event_count",
  "dynamic_proxy_used",
  "initial_attach_ms",
  "add_invocation_success",
  "set_status_success",
  "updates_received_before_disconnect",
  "server_counter_before_disconnect",
  "client_counter_before_disconnect",
  "server_counter_after_reconnect",
  "client_counter_after_recovery",
  "server_age_after_reconnect",
  "client_age_after_recovery",
  "reconnect_ms",
  "reattach_ms",
  "recovery_ms",
  "final_state_match",
  "state_mismatch_count",
  "reattach_failures",
  "missed_intermediate_events_replayed",
  "notes",
];

await mkdir(outputDir, { recursive: true });
await writeFile(csvPath, csvColumns.join(",") + "\n", "utf8");
await writeFile(logPath, "", "utf8");

const rows = [];
let typedefSnapshotWritten = false;
let failures = 0;

await logEvent("experiment_started", {
  serverUrl,
  resourcePath,
  offlineDurations,
  iterations,
  updatePeriodMs,
  warmupMs,
  operationTimeoutMs,
  outputDir,
});

for (const offlineDurationMs of offlineDurations) {
  for (let iteration = 1; iteration <= iterations; iteration++) {
    const runId = `${offlineDurationMs}ms-${iteration}`;
    const row = emptyRow(runId, offlineDurationMs);
    let connection;
    let proxy;
    let resourceId = 0;
    let counterPropertyUpdates = 0;
    let counterEvents = 0;
    const notes = [];

    try {
      await logEvent("run_started", { runId, offlineDurationMs });
      connection = await step(runId, "connect", EpConnection.connect(serverUrl, { autoReconnect: false }));

      const resourceRef = await step(
        runId,
        "resolve_resource",
        connection.getResourceIdByLink(resourcePath),
      );
      resourceId = toInstanceId(resourceRef);
      if (!resourceId)
        throw new Error(`Resource '${resourcePath}' did not resolve to an instance id.`);

      const typeDef = await step(
        runId,
        "fetch_typedef",
        connection.fetchTypeDefByResourceId(resourceId),
      );
      const typeDefSnapshot = typeDef.toJSON();
      row.typedef_received = true;
      row.typedef_property_count = typeDef.remoteProperties.length;
      row.typedef_function_count = typeDef.remoteFunctions.length;
      row.typedef_event_count = typeDef.remoteEvents.length;

      if (!typedefSnapshotWritten) {
        await writeFile(typedefPath, JSON.stringify(typeDefSnapshot, null, 2), "utf8");
        typedefSnapshotWritten = true;
      }

      const attachStart = performance.now();
      proxy = await step(runId, "initial_attach", connection.attach(resourceId, typeDef.template));
      row.initial_attach_ms = elapsed(attachStart);
      row.dynamic_proxy_used = true;

      if (!proxy || typeof proxy.Add !== "function" || typeof proxy.SetStatus !== "function")
        throw new Error("Dynamic proxy does not expose expected runtime TypeDef functions.");

      proxy.propertyModified.add((change) => {
        if (change.name === "Counter") counterPropertyUpdates++;
      });
      proxy.eventOccurred.add((change) => {
        if (change.name === "CounterChanged") counterEvents++;
      });

      row.add_invocation_success = (await step(runId, "invoke_add", proxy.Add(2, 3))) === 5;
      row.set_status_success =
        (await step(runId, "invoke_set_status", proxy.SetStatus("online"))) === true;
      if (!row.add_invocation_success) throw new Error("Add(2, 3) did not return 5.");
      if (!row.set_status_success) throw new Error("SetStatus('online') did not return true.");

      await sleep(warmupMs);
      const before = JSON.parse(
        await step(runId, "snapshot_before_disconnect", proxy.GetAuthoritativeStateJson()),
      );
      row.updates_received_before_disconnect = counterPropertyUpdates;
      row.server_counter_before_disconnect = before.Counter;
      row.client_counter_before_disconnect = proxy.Counter;
      notes.push(`counter_events_before_disconnect=${counterEvents}`);

      connection.close();
      await sleep(offlineDurationMs);

      await step(runId, "reconnect", connection.reconnect(), Math.max(operationTimeoutMs, 15000));
      const reconnectMetrics = connection.lastReconnectMetrics ?? {};
      row.reconnect_ms = round(reconnectMetrics.connectMs ?? 0);
      row.reattach_ms = round(reconnectMetrics.reattachMs ?? 0);
      row.recovery_ms = round(reconnectMetrics.recoveryMs ?? 0);
      row.reattach_failures = reconnectMetrics.failedResources ?? 0;

      await step(runId, "pause_updates", proxy.SetUpdatesPaused(true));
      await sleep(Math.max(100, updatePeriodMs * 2));

      let after = JSON.parse(
        await step(runId, "snapshot_after_reconnect", proxy.GetAuthoritativeStateJson()),
      );
      let mismatches = compareState(proxy, after);
      if (mismatches > 0) {
        notes.push("validation_reattach_after_pause=true");
        await step(runId, "validation_reattach", connection.reattach(resourceId, 0, proxy));
        await sleep(50);
        after = JSON.parse(
          await step(runId, "snapshot_after_validation_reattach", proxy.GetAuthoritativeStateJson()),
        );
        mismatches = compareState(proxy, after);
      }

      row.server_counter_after_reconnect = after.Counter;
      row.client_counter_after_recovery = proxy.Counter;
      row.server_age_after_reconnect = after.Age;
      row.client_age_after_recovery = proxy.age;
      row.state_mismatch_count = mismatches;
      row.final_state_match = mismatches === 0;
      row.missed_intermediate_events_replayed = false;
      row.notes = notes.join("; ");

      if (!row.final_state_match) throw new Error("Final proxy state did not match server state.");
      if (row.reattach_failures > 0) throw new Error("One or more resources failed to reattach.");

      await step(runId, "resume_updates", proxy.SetUpdatesPaused(false));
      await logEvent("run_completed", { runId, row });
    } catch (error) {
      failures++;
      row.notes = [notes.join("; "), String(error?.stack ?? error)].filter(Boolean).join("; ");
      await logEvent("run_failed", { runId, error: String(error?.stack ?? error), row });
    } finally {
      rows.push(row);
      await appendFile(csvPath, toCsvRow(csvColumns.map((c) => row[c])) + "\n", "utf8");
      try {
        if (proxy && typeof proxy.SetUpdatesPaused === "function")
          await withTimeout(proxy.SetUpdatesPaused(false), operationTimeoutMs, "cleanup_resume_updates");
      } catch {
        // Ignore cleanup errors; the row already captures the run outcome.
      }
      connection?.close();
    }
  }
}

await writeFile(summaryPath, buildSummary(rows), "utf8");
await logEvent("experiment_finished", { failures, rows: rows.length, csvPath, summaryPath });

if (failures > 0) {
  console.error(`[cross-language-recovery] ${failures} run(s) failed. See ${csvPath}`);
  process.exitCode = 1;
} else {
  console.log(`[cross-language-recovery] completed ${rows.length} run(s).`);
  console.log(`[cross-language-recovery] CSV: ${csvPath}`);
}

function emptyRow(runId, offlineDurationMs) {
  return {
    ...Object.fromEntries(csvColumns.map((c) => [c, ""])),
    run_id: runId,
    offline_duration_ms: offlineDurationMs,
    update_period_ms: updatePeriodMs,
    typedef_received: false,
    typedef_property_count: 0,
    typedef_function_count: 0,
    typedef_event_count: 0,
    dynamic_proxy_used: false,
    initial_attach_ms: 0,
    add_invocation_success: false,
    set_status_success: false,
    updates_received_before_disconnect: 0,
    server_counter_before_disconnect: 0,
    client_counter_before_disconnect: 0,
    server_counter_after_reconnect: 0,
    client_counter_after_recovery: 0,
    server_age_after_reconnect: 0,
    client_age_after_recovery: 0,
    reconnect_ms: 0,
    reattach_ms: 0,
    recovery_ms: 0,
    final_state_match: false,
    state_mismatch_count: 0,
    reattach_failures: 0,
    missed_intermediate_events_replayed: false,
    notes: "",
  };
}

function compareState(proxy, state) {
  let mismatches = 0;
  if (Number(proxy.Counter) !== Number(state.Counter)) mismatches++;
  if (String(proxy.Status) !== String(state.Status)) mismatches++;
  if (Number(proxy.LastUpdateTicks) !== Number(state.LastUpdateTicks)) mismatches++;
  return mismatches;
}

function buildSummary(data) {
  const byDuration = new Map();
  for (const row of data) {
    const key = row.offline_duration_ms;
    if (!byDuration.has(key)) byDuration.set(key, []);
    byDuration.get(key).push(row);
  }
  const allTypeDefs = data.every((r) => r.typedef_received);
  const allDynamic = data.every((r) => r.dynamic_proxy_used);
  const allAdd = data.every((r) => r.add_invocation_success);
  const allSetStatus = data.every((r) => r.set_status_success);
  const allReattached = data.every(
    (r) => Number(r.reattach_failures) === 0 && Number(r.recovery_ms) > 0,
  );
  const allMatched = data.every((r) => r.final_state_match);
  const allSucceeded = allTypeDefs && allDynamic && allAdd && allSetStatus && allReattached && allMatched;

  const lines = [
    "# Cross-Language TypeDef Discovery and Reattachment Recovery",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Runs: ${data.length}`,
    `TypeDef discovered successfully: ${allTypeDefs}`,
    `Dynamic runtime proxy used without static stubs: ${allDynamic}`,
    `Add invocation succeeded: ${allAdd}`,
    `SetStatus invocation succeeded: ${allSetStatus}`,
    `Reattachment succeeded: ${allReattached}`,
    `Final client/server state matched: ${allMatched}`,
    "Intermediate offline events replayed individually: false",
    "",
    "The expected recovery claim is final-state convergence after age-based reattachment; intermediate updates generated while the client is offline are not claimed to be replayed individually.",
    "",
    "## Timing By Offline Duration",
    "",
    "| offline_duration_ms | runs | reconnect_ms mean/sample_sd | reattach_ms mean/sample_sd | recovery_ms mean/sample_sd | final matches |",
    "|---:|---:|---:|---:|---:|---:|",
  ];

  for (const [duration, group] of [...byDuration.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    lines.push(
      `| ${duration} | ${group.length} | ${fmtStats(group.map((r) => Number(r.reconnect_ms)))} | ${fmtStats(group.map((r) => Number(r.reattach_ms)))} | ${fmtStats(group.map((r) => Number(r.recovery_ms)))} | ${group.filter((r) => r.final_state_match).length}/${group.length} |`,
    );
  }

  lines.push(
    "",
    "## Paper Statement",
    "",
    allSucceeded
      ? "Generated from the local experiment results: the TypeScript client discovered the C# resource interface from runtime TypeDefs, built a dynamic proxy without generated stubs, invoked remote functions, received live updates, reconnected after transient disconnections, reattached using resource age, and converged to the authoritative C# server state. Offline intermediate events were not replayed individually; the demonstrated property is final-state convergence."
      : "Generated from the local experiment results: this run did not satisfy all success criteria, so it should not be cited as evidence of final-state convergence. Inspect the CSV and JSONL logs for failed rows.",
    "",
  );

  return lines.join("\n");
}

function fmtStats(values) {
  if (values.length === 0) return "n/a";
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const denominator = values.length > 1 ? values.length - 1 : 1;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / denominator;
  return `${round(mean)}/${round(Math.sqrt(variance))}`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

function parseNumberList(value) {
  return String(value)
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x >= 0);
}

function toWebSocketUrl(url) {
  if (url.startsWith("ep://")) return `ws://${url.slice("ep://".length).split("/")[0]}`;
  if (url.startsWith("eps://")) return `wss://${url.slice("eps://".length).split("/")[0]}`;
  const parsed = new URL(url);
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:")
    throw new Error(`Unsupported server URL protocol '${parsed.protocol}'.`);
  return `${parsed.protocol}//${parsed.host}`;
}

function toInstanceId(value) {
  if (value instanceof ResourceId) return value.id;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object") {
    if (value.instanceId != null) return Number(value.instanceId);
    if (value.id != null) return Number(value.id);
  }
  return 0;
}

function elapsed(start) {
  return round(performance.now() - start);
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function step(runId, name, promise, timeoutMs = operationTimeoutMs) {
  const started = performance.now();
  await logEvent("step_started", { runId, step: name });
  try {
    const value = await withTimeout(promise, timeoutMs, name);
    await logEvent("step_completed", { runId, step: name, elapsed_ms: elapsed(started) });
    return value;
  } catch (error) {
    await logEvent("step_failed", {
      runId,
      step: name,
      elapsed_ms: elapsed(started),
      error: String(error?.stack ?? error),
    });
    throw error;
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
        timeoutMs,
      );
    }),
  ]);
}

function toCsvRow(values) {
  return values.map(csvCell).join(",");
}

function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

async function logEvent(eventName, payload) {
  await appendFile(
    logPath,
    JSON.stringify({ timestamp: new Date().toISOString(), event: eventName, ...payload }) + "\n",
    "utf8",
  );
}
