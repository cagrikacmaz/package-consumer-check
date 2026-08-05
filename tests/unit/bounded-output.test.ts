import { describe, expect, it } from "vitest";
import { BoundedOutput, TRUNCATION_MARKER } from "../../src/process/bounded-output.js";

describe("BoundedOutput", () => {
  it("keeps output below the limit", () => {
    const output = new BoundedOutput(10);
    output.append("hello");
    expect(output.value).toBe("hello");
    expect(output.truncated).toBe(false);
  });

  it("combines chunks", () => {
    const output = new BoundedOutput(10);
    output.append("hel");
    output.append(Buffer.from("lo"));
    expect(output.value).toBe("hello");
  });

  it("truncates output by bytes", () => {
    const output = new BoundedOutput(4);
    output.append("abcdef");
    expect(output.value).toBe(`abcd${TRUNCATION_MARKER}`);
  });

  it("ignores later chunks after truncation", () => {
    const output = new BoundedOutput(2);
    output.append("abc");
    output.append("def");
    expect(output.value).toBe(`ab${TRUNCATION_MARKER}`);
  });

  it("supports a zero byte limit", () => {
    const output = new BoundedOutput(0);
    output.append("a");
    expect(output.value).toBe(TRUNCATION_MARKER);
  });
});
