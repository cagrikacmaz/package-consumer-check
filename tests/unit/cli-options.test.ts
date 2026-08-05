import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli-options.js";

describe("parseCliArgs", () => {
  it("uses defaults", () => {
    expect(parseCliArgs([])).toEqual({
      target: ".",
      format: "text",
      help: false,
      version: false,
      checkOptions: {},
    });
  });

  it("reads a positional target", () => {
    expect(parseCliArgs(["./package"]).target).toBe("./package");
  });

  it("reads JSON format", () => {
    expect(parseCliArgs(["--format", "json"]).format).toBe("json");
  });

  it("rejects an invalid format", () => {
    expect(() => parseCliArgs(["--format", "yaml"])).toThrow("text or json");
  });

  it("reads a positive timeout", () => {
    expect(parseCliArgs(["--timeout", "2500"]).checkOptions.timeoutMs).toBe(2500);
  });

  it("rejects zero timeout", () => {
    expect(() => parseCliArgs(["--timeout", "0"])).toThrow("positive integer");
  });

  it("reads all boolean check options", () => {
    const parsed = parseCliArgs([
      "--keep-temp",
      "--allow-scripts",
      "--require-types",
      "--skip-esm",
      "--skip-cjs",
      "--skip-types",
      "--skip-cli",
    ]);
    expect(parsed.checkOptions).toMatchObject({
      keepTemp: true,
      allowScripts: true,
      requireTypes: true,
      skipEsm: true,
      skipCommonJs: true,
      skipTypes: true,
      skipCli: true,
    });
  });

  it("collects repeated CLI arguments", () => {
    expect(
      parseCliArgs(["--cli-arg", "--help", "--cli-arg", "value"]).checkOptions.cliArgs,
    ).toEqual(["--help", "value"]);
  });

  it("collects and deduplicates accepted exit codes", () => {
    expect(
      parseCliArgs([
        "--accepted-cli-exit-code",
        "0",
        "--accepted-cli-exit-code",
        "7",
        "--accepted-cli-exit-code",
        "7",
      ]).checkOptions.acceptedCliExitCodes,
    ).toEqual([0, 7]);
  });

  it("rejects negative accepted exit codes", () => {
    expect(() => parseCliArgs(["--accepted-cli-exit-code", "-1"])).toThrow("non-negative integer");
  });

  it("reads help aliases", () => {
    expect(parseCliArgs(["-h"]).help).toBe(true);
  });

  it("reads version aliases", () => {
    expect(parseCliArgs(["-v"]).version).toBe(true);
  });

  it("rejects unknown options", () => {
    expect(() => parseCliArgs(["--unknown"])).toThrow("Unknown option");
  });

  it("rejects multiple targets", () => {
    expect(() => parseCliArgs(["one", "two"])).toThrow("Only one target");
  });

  it("accepts a dash-prefixed target after --", () => {
    expect(parseCliArgs(["--", "-package.tgz"]).target).toBe("-package.tgz");
  });

  it("reports missing option values", () => {
    expect(() => parseCliArgs(["--format"])).toThrow("requires a value");
  });
});
