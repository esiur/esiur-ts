/* global fetch, WebSocket */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, rmdir } from "node:fs/promises";
import net from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const serverScript = join(__dirname, "server.mjs");
const profileRoot = join(projectRoot, ".tmp");
const profileDir = join(profileRoot, `browser-client-${process.pid}`);

let serverProcess;
let browserProcess;
let cdp;
let browserErrors = "";

try {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error(
      "No Chrome/Edge browser was found. Install Chrome/Edge or set CHROME_BIN to a Chromium-compatible browser.",
    );
  }

  await mkdir(profileDir, { recursive: true });

  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const testUrl = await waitForServerUrl(serverProcess);
  const debugPort = await getFreePort();
  browserProcess = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-crash-reporter",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-default-browser-check",
      "--no-first-run",
      "--no-sandbox",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      testUrl,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  browserProcess.stderr?.on("data", (chunk) => {
    browserErrors += chunk.toString();
  });

  const target = await waitForCdpTarget(debugPort, testUrl);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  const result = await waitForBrowserResult(cdp);

  console.log(result.log.trimEnd());
  console.log("Browser client test passed.");
} catch (error) {
  console.error(error?.stack ?? error);
  if (browserErrors.trim()) console.error(browserErrors.trimEnd());
  process.exitCode = 1;
} finally {
  await closeCdp();
  await stopProcess(browserProcess);
  await stopProcess(serverProcess);
  await removeProfileDir();
}

function findBrowser() {
  const configured = process.env.CHROME_BIN ?? process.env.BROWSER;
  if (configured && existsSync(configured)) return configured;

  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];

  for (const candidate of candidates) if (existsSync(candidate)) return candidate;

  const pathNames =
    process.platform === "win32"
      ? ["chrome.exe", "msedge.exe"]
      : ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const name of pathNames) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function waitForServerUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      fail(new Error(`Timed out waiting for browser test server.\n${output}`));
    }, 10000);

    const done = (url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(url);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const read = (chunk) => {
      const text = chunk.toString();
      output += text;
      const match = output.match(/Open (http:\/\/localhost:\d+\/) in a browser\./);
      if (match) done(match[1]);
    };

    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", (code, signal) => {
      fail(new Error(`Browser test server exited before startup (${code ?? signal}).\n${output}`));
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function waitForCdpTarget(port, pageUrl) {
  const deadline = Date.now() + 10000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) throw new Error(`CDP target list returned ${response.status}.`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page" && item.url.startsWith(pageUrl));
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }

  throw lastError ?? new Error("Timed out waiting for browser DevTools target.");
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();

    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((requestResolve, requestReject) => {
            pending.set(id, { resolve: requestResolve, reject: requestReject });
          });
        },
        close() {
          socket.close();
        },
      });
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message);
    });

    socket.addEventListener("close", () => {
      for (const request of pending.values()) request.reject(new Error("Browser DevTools connection closed."));
      pending.clear();
    });

    socket.addEventListener("error", () => reject(new Error("Failed to connect to browser DevTools target.")));
  });
}

async function waitForBrowserResult(client) {
  const deadline = Date.now() + 15000;
  let lastState = null;

  while (Date.now() < deadline) {
    const state = await readBrowserState(client);
    lastState = state;

    if (state.result?.ok === true) return state;
    if (state.result?.ok === false) {
      throw new Error(`${state.result.error}\n${state.log}`);
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for browser test result.\n${lastState?.log ?? ""}`);
}

async function readBrowserState(client) {
  const expression = `(() => JSON.stringify({
    result: globalThis.__esiurBrowserClientTestResult ?? null,
    status: document.querySelector("#status")?.textContent ?? "",
    log: document.querySelector("#log")?.textContent ?? ""
  }))()`;
  const response = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  return JSON.parse(response.result.result.value);
}

async function closeCdp() {
  if (!cdp) return;
  try {
    await Promise.race([cdp.send("Browser.close").catch(() => undefined), delay(1000)]);
  } catch {
    // The browser may close the DevTools socket before acknowledging Browser.close.
  } finally {
    cdp.close();
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function removeProfileDir() {
  const resolvedRoot = resolve(profileRoot);
  const resolvedProfile = resolve(profileDir);
  if (!resolvedProfile.startsWith(`${resolvedRoot}\\`) && !resolvedProfile.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`Refusing to remove browser profile outside ${resolvedRoot}: ${resolvedProfile}`);
  }
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 });
  try {
    await rmdir(resolvedRoot);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
