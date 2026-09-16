import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Tests for the browser extension's extraction parser.
 *
 * The parser is dependency-free and exposes itself via module.exports, so we
 * load it directly from the extension folder rather than duplicating logic.
 */

const require = createRequire(import.meta.url);
const parserPath = path.resolve(__dirname, "../../browser_extension/parser.js");

interface ParseResult {
  ok: boolean;
  payload: { capability: string; arguments: Record<string, unknown> } | null;
  errors: string[];
  warnings: string[];
  report: string;
}

const Parser = require(parserPath) as {
  EXECUTE_CONTRACT: unknown;
  CAPABILITY_SCHEMAS: Record<string, unknown>;
  buildPayload: (e: { className: string; value: string }) => {
    capability: string;
    arguments: Record<string, unknown>;
  };
  validatePayload: (p: unknown) => ParseResult;
  parseExtraction: (e: unknown) => ParseResult;
};

describe("ExtractorParser.parseExtraction", () => {
  it("accepts a well-formed extraction and builds a valid payload", () => {
    const result = Parser.parseExtraction({
      className: "message",
      value: "Hello world",
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
    // Must be a capability the runtime actually registers, not a made-up one.
    expect(result.payload!.capability).toBe("computer.type_text");
    expect(result.payload!.arguments).toEqual({
      text: "Hello world",
    });
  });

  it("rejects a missing extraction", () => {
    const result = Parser.parseExtraction(undefined);
    expect(result.ok).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.report).toMatch(/MISMATCH/i);
  });

  it("rejects an empty className", () => {
    const result = Parser.parseExtraction({ className: "", value: "x" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/className/i);
  });

  it("rejects a whitespace-only className", () => {
    const result = Parser.parseExtraction({ className: "   ", value: "x" });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty value", () => {
    const result = Parser.parseExtraction({ className: "message", value: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/value/i);
  });

  it("rejects a whitespace-only value", () => {
    const result = Parser.parseExtraction({ className: "message", value: "   " });
    expect(result.ok).toBe(false);
  });
});

describe("ExtractorParser.validatePayload", () => {
  it("accepts a payload with capability and arguments", () => {
    const result = Parser.validatePayload({
      capability: "computer.type_text",
      arguments: { text: "b" },
    });
    expect(result.ok).toBe(true);
    expect(result.report).toMatch(/OK/i);
  });

  it("accepts a payload with capability and no arguments", () => {
    const result = Parser.validatePayload({ capability: "capabilities.list" });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object payload", () => {
    const result = Parser.validatePayload("nope");
    expect(result.ok).toBe(false);
  });

  it("rejects a payload missing the capability field", () => {
    const result = Parser.validatePayload({ arguments: {} });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/capability/i);
  });

  it("rejects a non-string capability", () => {
    const result = Parser.validatePayload({ capability: 123 });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object arguments field", () => {
    const result = Parser.validatePayload({
      capability: "computer.type_text",
      arguments: [1, 2, 3],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/arguments/i);
  });

  it("warns when the capability has no local schema", () => {
    const result = Parser.validatePayload({
      capability: "computer.unknown_thing",
      arguments: {},
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/no local schema/i);
  });

  it("rejects arguments that violate the known schema", () => {
    const result = Parser.validatePayload({
      capability: "computer.type_text",
      arguments: {}, // missing required "text"
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/text.*required/i);
  });
});
