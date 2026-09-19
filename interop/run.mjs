import { execFile, spawn } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = await freePort();

await execFileAsync("dotnet", ["build", "interop/InteropServer.csproj", "-c", "Release"], {
  cwd: process.cwd(),
  maxBuffer: 10 * 1024 * 1024,
});

const server = spawn("dotnet", ["interop/bin/Release/net10.0/InteropServer.dll"], {
  cwd: process.cwd(),
  env: { ...process.env, ESIUR_INTEROP_PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"],
});

try {
  await waitForReady(server, port);
  const tests = spawn(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--config", "interop/vitest.config.ts"],
    {
    cwd: process.cwd(),
    env: { ...process.env, ESIUR_INTEROP_PORT: String(port) },
    stdio: "inherit",
    },
  );
  const code = await new Promise((resolve) => tests.once("exit", resolve));
  if (code !== 0) process.exitCode = Number(code ?? 1);
} finally {
  server.kill();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      listener.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

function waitForReady(process, expectedPort) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("dotnet interop server did not start")), 15_000);
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`dotnet interop server exited with ${code}: ${output}`));
    });
    process.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes(`ESIUR-INTEROP-READY ${expectedPort}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}
