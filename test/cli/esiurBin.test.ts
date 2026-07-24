import { describe, it, expect, vi } from "vitest";
import {
  main,
  findEsiurCli,
  installGuidance,
  customPathGuidance,
  defaultDotnetToolShimPath,
  TOOL_PACKAGE_ID,
  type ProcessRunner,
  type ProcessRunResult,
} from "../../src/cli/esiurBin.js";

function fakeRunner(overrides: {
  fileExists?: (path: string) => boolean;
  run?: (command: string, args: string[], stdio: "inherit" | "ignore" | "pipe") => ProcessRunResult;
}): ProcessRunner {
  return {
    fileExists: overrides.fileExists ?? (() => false),
    run: overrides.run ?? (() => ({ status: 0 })),
  };
}

describe("findEsiurCli", () => {
  it("returns the default shim path when it exists", () => {
    const runner = fakeRunner({ fileExists: (p) => p === defaultDotnetToolShimPath() });
    expect(findEsiurCli(runner)).toEqual({ path: defaultDotnetToolShimPath() });
  });

  it("reports installedElsewhere when dotnet tool list -g mentions the package but the shim is missing", () => {
    const runner = fakeRunner({
      fileExists: () => false,
      run: (command, args) =>
        command === "dotnet" && args[0] === "tool" && args[1] === "list"
          ? { status: 0, stdout: "Package Id      Version\nesiur.cli       3.0.0\n" }
          : { status: 0 },
    });
    expect(findEsiurCli(runner)).toEqual({ installedElsewhere: true });
  });

  it("returns undefined when neither the shim nor the tool listing find it", () => {
    const runner = fakeRunner({
      fileExists: () => false,
      run: () => ({ status: 0, stdout: "Package Id      Version\nsome-other-tool 1.0.0\n" }),
    });
    expect(findEsiurCli(runner)).toBeUndefined();
  });
});

describe("installGuidance", () => {
  it("mentions installing the .NET SDK first when dotnet isn't found", () => {
    const runner = fakeRunner({ run: () => ({ status: null, error: new Error("ENOENT") }) });
    const text = installGuidance(runner);
    expect(text).toContain("dotnet.microsoft.com");
    expect(text).toContain(`dotnet tool install -g ${TOOL_PACKAGE_ID}`);
  });

  it("skips the SDK note when dotnet is already available", () => {
    const runner = fakeRunner({ run: () => ({ status: 0 }) });
    const text = installGuidance(runner);
    expect(text).not.toContain("dotnet.microsoft.com");
    expect(text).toContain(`dotnet tool install -g ${TOOL_PACKAGE_ID}`);
  });
});

describe("customPathGuidance", () => {
  it("explains the custom --tool-path case", () => {
    const text = customPathGuidance();
    expect(text).toContain("--tool-path");
    expect(text).toContain(`dotnet tool uninstall -g ${TOOL_PACKAGE_ID}`);
  });
});

describe("main", () => {
  it("forwards argv to the located shim with inherited stdio and propagates the exit code", () => {
    const shimPath = defaultDotnetToolShimPath();
    const run = vi.fn((command: string, args: string[], stdio: string): ProcessRunResult => {
      if (command === shimPath) {
        expect(args).toEqual(["generate", "--lang", "ts"]);
        expect(stdio).toBe("inherit");
        return { status: 42 };
      }
      return { status: 0 };
    });
    const runner = fakeRunner({ fileExists: (p) => p === shimPath, run });

    const code = main(["generate", "--lang", "ts"], runner);

    expect(code).toBe(42);
    expect(run).toHaveBeenCalledWith(shimPath, ["generate", "--lang", "ts"], "inherit");
  });

  it("prints install guidance and exits 1 when the tool isn't found anywhere", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const runner = fakeRunner({ fileExists: () => false, run: () => ({ status: null, error: new Error("ENOENT") }) });

    const code = main([], runner);

    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("dotnet tool install"));
    consoleError.mockRestore();
  });

  it("prints custom-path guidance and exits 1 when installed at a non-default location", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const runner = fakeRunner({
      fileExists: () => false,
      run: (command, args) =>
        command === "dotnet" && args[0] === "tool" && args[1] === "list"
          ? { status: 0, stdout: "esiur.cli 3.0.0" }
          : { status: 0 },
    });

    const code = main([], runner);

    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("--tool-path"));
    consoleError.mockRestore();
  });

  it("reports a spawn error without crashing", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const shimPath = defaultDotnetToolShimPath();
    const runner = fakeRunner({
      fileExists: (p) => p === shimPath,
      run: () => ({ status: null, error: new Error("spawn EACCES") }),
    });

    const code = main([], runner);

    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("spawn EACCES"));
    consoleError.mockRestore();
  });
});
