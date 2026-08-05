import { describe, expect, it } from "vitest";
import { planCapabilities } from "../../src/core/capability-plan.js";

describe("planCapabilities", () => {
  it("runs import and require for conditional dual exports", () => {
    const plan = planCapabilities({
      exports: { ".": { import: "./index.js", require: "./index.cjs" } },
    });
    expect([plan.esm.run, plan.commonJs.run]).toEqual([true, true]);
  });

  it("recognizes a string export as plausible ESM", () => {
    expect(planCapabilities({ type: "module", exports: "./index.js" }).esm.run).toBe(true);
  });

  it("skips CommonJS for an import-only root export", () => {
    const plan = planCapabilities({ exports: { ".": { import: "./index.js" } } });
    expect(plan.commonJs).toMatchObject({ run: false });
  });

  it("skips ESM for a require-only root export", () => {
    const plan = planCapabilities({ exports: { ".": { require: "./index.cjs" } } });
    expect(plan.esm).toMatchObject({ run: false });
  });

  it("uses the package module field as ESM evidence", () => {
    expect(planCapabilities({ module: "./index.js" }).esm.run).toBe(true);
  });

  it("uses type module as ESM evidence", () => {
    expect(planCapabilities({ type: "module", main: "./index.js" }).esm.run).toBe(true);
  });

  it("uses an mjs main as ESM evidence", () => {
    expect(planCapabilities({ main: "./index.mjs" }).esm.run).toBe(true);
  });

  it("uses a cjs main as CommonJS evidence", () => {
    const plan = planCapabilities({ main: "./index.cjs" });
    expect([plan.esm.run, plan.commonJs.run]).toEqual([false, true]);
  });

  it("infers CommonJS for legacy packages", () => {
    expect(planCapabilities({ main: "./index.js" }).commonJs.run).toBe(true);
  });

  it("warns when ESM capability is ambiguous", () => {
    expect(planCapabilities({ main: "./index.js" }).warnings).toContainEqual(
      expect.stringContaining("ESM support is ambiguous"),
    );
  });

  it("detects top-level types", () => {
    expect(planCapabilities({ types: "./index.d.ts" }).typescript.run).toBe(true);
  });

  it("detects the typings alias", () => {
    expect(planCapabilities({ typings: "./index.d.ts" }).typescript.run).toBe(true);
  });

  it("detects types in root exports", () => {
    expect(
      planCapabilities({ exports: { ".": { types: "./index.d.mts", import: "./index.mjs" } } })
        .typescript.run,
    ).toBe(true);
  });

  it("detects nested conditional types", () => {
    expect(
      planCapabilities({
        exports: { ".": { node: { types: "./index.d.cts", require: "./index.cjs" } } },
      }).typescript.run,
    ).toBe(true);
  });

  it("skips TypeScript when types are absent", () => {
    expect(planCapabilities({ main: "index.cjs" }).typescript).toMatchObject({ run: false });
  });

  it("detects object bins", () => {
    const plan = planCapabilities({ bin: { first: "first.js", second: "second.js" } });
    expect(plan.cli.run).toBe(true);
    expect(Object.keys(plan.bins)).toHaveLength(2);
  });

  it("detects string bins", () => {
    expect(planCapabilities({ name: "tool", bin: "cli.js" }).bins).toEqual({ tool: "cli.js" });
  });

  it("skips CLI when bins are absent", () => {
    expect(planCapabilities({}).cli).toMatchObject({ run: false });
  });

  it("honors a default export target", () => {
    const plan = planCapabilities({ type: "module", exports: { ".": { default: "./index.js" } } });
    expect(plan.esm.run).toBe(true);
  });
});
