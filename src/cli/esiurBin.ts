import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `bin/esiur`'s implementation: a thin launcher for `Esiur.CLI` (the .NET
 * global tool that generates TypeScript/JS resource stubs from C# resource
 * definitions). This package has no CLI logic of its own — it locates the
 * installed dotnet tool and forwards straight through to it, or explains how
 * to install it.
 */

export const TOOL_PACKAGE_ID = "Esiur.CLI";
const TOOL_COMMAND = "esiur";

export interface ProcessRunResult {
  status: number | null;
  stdout?: string;
  error?: Error;
}

/** Injected in tests so the detection/forwarding logic never needs a real dotnet install to exercise. */
export interface ProcessRunner {
  run(command: string, args: string[], stdio: "inherit" | "ignore" | "pipe"): ProcessRunResult;
  fileExists(path: string): boolean;
}

export const defaultRunner: ProcessRunner = {
  run(command, args, stdio) {
    const result = spawnSync(command, args, {
      stdio: stdio === "pipe" ? ["ignore", "pipe", "ignore"] : stdio,
      encoding: "utf8",
    });
    return {
      status: result.status,
      stdout: typeof result.stdout === "string" ? result.stdout : undefined,
      error: result.error,
    };
  },
  fileExists: existsSync,
};

/** Default install location of a `dotnet tool install -g` global tool's launcher shim. */
export function defaultDotnetToolShimPath(platform: NodeJS.Platform = process.platform): string {
  const exe = platform === "win32" ? `${TOOL_COMMAND}.exe` : TOOL_COMMAND;
  return join(homedir(), ".dotnet", "tools", exe);
}

export function isDotnetInstalled(runner: ProcessRunner = defaultRunner): boolean {
  const result = runner.run("dotnet", ["--version"], "ignore");
  return result.error == null && result.status === 0;
}

export type EsiurCliLocation = { path: string } | { installedElsewhere: true } | undefined;

/**
 * Locate the installed `Esiur.CLI` global tool. Checks the default global-tool
 * shim path first (covers the overwhelming majority of installs); if that's
 * absent but `dotnet tool list -g` still reports the package, it's installed
 * at a non-default location (e.g. via `--tool-path`) this wrapper can't
 * reliably resolve — reported distinctly so `main` can explain rather than
 * silently fail, and so a bare `esiur` PATH lookup (which could resolve back
 * to *this* wrapper if it's ever installed under the same name) is never needed.
 */
export function findEsiurCli(runner: ProcessRunner = defaultRunner): EsiurCliLocation {
  const shimPath = defaultDotnetToolShimPath();
  if (runner.fileExists(shimPath)) return { path: shimPath };

  const listing = runner.run("dotnet", ["tool", "list", "-g"], "pipe");
  if (listing.stdout?.toLowerCase().includes(TOOL_PACKAGE_ID.toLowerCase())) {
    return { installedElsewhere: true };
  }
  return undefined;
}

export function installGuidance(runner: ProcessRunner = defaultRunner): string {
  const lines = ["The Esiur CLI is a .NET tool and isn't installed yet.", ""];
  if (!isDotnetInstalled(runner)) {
    lines.push("You'll need the .NET SDK first: https://dotnet.microsoft.com/download", "");
  }
  lines.push(
    "Install it with:",
    "",
    `  dotnet tool install -g ${TOOL_PACKAGE_ID}`,
    "",
    "Then re-run this command.",
  );
  return lines.join("\n");
}

export function customPathGuidance(): string {
  return [
    `${TOOL_PACKAGE_ID} is installed, but not at the default global-tool location this wrapper`,
    "checks (~/.dotnet/tools) — probably installed with a custom --tool-path.",
    "",
    "Run it directly instead (make sure its install directory is on your PATH), or reinstall it as",
    "a normal global tool for this wrapper to find it automatically:",
    "",
    `  dotnet tool uninstall -g ${TOOL_PACKAGE_ID}`,
    `  dotnet tool install -g ${TOOL_PACKAGE_ID}`,
  ].join("\n");
}

/** Runs the wrapper end to end; returns the process exit code. */
export function main(argv: string[], runner: ProcessRunner = defaultRunner): number {
  const found = findEsiurCli(runner);

  if (!found) {
    console.error(installGuidance(runner));
    return 1;
  }
  if ("installedElsewhere" in found) {
    console.error(customPathGuidance());
    return 1;
  }

  const result = runner.run(found.path, argv, "inherit");
  if (result.error) {
    console.error(`Failed to run the Esiur CLI: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
