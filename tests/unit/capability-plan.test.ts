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

  it("does not treat the module field as Node resolution metadata", () => {
    const plan = planCapabilities({ module: "./bundler.js", main: "./index.cjs" });
    expect(plan.commonJs.run).toBe(true);
    expect(plan.warnings).toContain(
      "The module field is not used for Node.js package-root resolution.",
    );
  });

  it("uses type module as ESM evidence", () => {
    expect(planCapabilities({ type: "module", main: "./index.js" }).esm.run).toBe(true);
  });

  it("uses an mjs main as ESM evidence", () => {
    expect(planCapabilities({ main: "./index.mjs" }).esm.run).toBe(true);
  });

  it("uses a cjs main as CommonJS evidence", () => {
    const plan = planCapabilities({ main: "./index.cjs" });
    expect([plan.esm.run, plan.commonJs.run]).toEqual([true, true]);
  });

  it("infers CommonJS for legacy packages", () => {
    expect(planCapabilities({ main: "./index.js" }).commonJs.run).toBe(true);
  });

  it("runs both modes for a default CommonJS js target", () => {
    const plan = planCapabilities({ main: "./index.js" });
    expect([plan.esm.run, plan.commonJs.run]).toEqual([true, true]);
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

  it("skips root checks for a subpath-only exports map", () => {
    const plan = planCapabilities({
      type: "module",
      main: "./ignored.js",
      exports: { "./feature": { import: "./feature.js", types: "./feature.d.ts" } },
    });
    expect(plan.esm).toMatchObject({
      run: false,
      reason: "Package does not export a root entry point",
    });
    expect(plan.commonJs.run).toBe(false);
    expect(plan.typescript.run).toBe(false);
  });

  it("skips root checks when exports is null", () => {
    const plan = planCapabilities({ exports: null, main: "./ignored.cjs" });
    expect([plan.esm.run, plan.commonJs.run, plan.typescript.run]).toEqual([false, false, false]);
  });

  it("skips root checks when the dot export is null", () => {
    const plan = planCapabilities({
      exports: { ".": null, "./feature": { import: "./feature.js" } },
    });
    expect(plan.esm.reason).toBe("Package does not export a root entry point");
    expect(plan.commonJs.run).toBe(false);
  });

  it("uses only the dot export when root and subpaths coexist", () => {
    const plan = planCapabilities({
      type: "module",
      exports: {
        ".": { import: "./index.js" },
        "./feature": { require: "./feature.cjs", types: "./feature.d.ts" },
      },
    });
    expect([plan.esm.run, plan.commonJs.run, plan.typescript.run]).toEqual([true, false, false]);
  });

  it("runs both modes for cjs under type module", () => {
    const plan = planCapabilities({ type: "module", exports: "./index.cjs" });
    expect([plan.esm.run, plan.commonJs.run]).toEqual([true, true]);
  });

  it("runs both modes for a default cjs export", () => {
    const plan = planCapabilities({
      type: "module",
      exports: { ".": { default: "./index.cjs" } },
    });
    expect([plan.esm.run, plan.commonJs.run]).toEqual([true, true]);
  });

  it("skips CommonJS for an mjs root", () => {
    const plan = planCapabilities({ exports: "./index.mjs" });
    expect([plan.esm.run, plan.commonJs.run]).toEqual([true, false]);
  });

  it("skips CommonJS for js under type module", () => {
    const plan = planCapabilities({ type: "module", exports: "./index.js" });
    expect([plan.esm.run, plan.commonJs.run]).toEqual([true, false]);
  });

  it("honors explicit require even when its target is mjs", () => {
    const plan = planCapabilities({
      type: "module",
      exports: { ".": { require: "./advertised.mjs" } },
    });
    expect(plan.commonJs.run).toBe(true);
  });
});
