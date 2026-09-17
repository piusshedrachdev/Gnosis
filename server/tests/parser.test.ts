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
  CAPABILITY_PREFIX: string;
  META_CAPABILITIES: string[];
  isKnownCapabilityName: (n: unknown) => boolean;
  tryParseCapabilityCall: (t: string) => {
    capability: string;
    arguments: Record<string, unknown>;
  } | null;
  buildPayload: (e: { className?: string; value: string }) => {
    ok: boolean;
    call: { capability: string; arguments: Record<string, unknown> } | null;
    reason: string;
  };
  validatePayload: (p: unknown) => ParseResult;
  parseExtraction: (e: unknown) => ParseResult;
};

describe("ExtractorParser.parseExtraction", () => {
  it("accepts a well-formed capability-call extraction", () => {
    const result = Parser.parseExtraction({
      className: "message",
      value: '{ "capability": "computer.type_text", "arguments": { "text": "Hello" } }',
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
    expect(result.payload!.capability).toBe("computer.type_text");
    expect(result.payload!.arguments).toEqual({ text: "Hello" });
  });

  it("REJECTS free-form text that is not a tool call", () => {
    const result = Parser.parseExtraction({
      className: "message",
      value: "Hello world, this is just normal chat text.",
    });
    expect(result.ok).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.report).toMatch(/NOT_A_TOOL_CALL/);
  });

  it("REJECTS an unknown/invented capability name", () => {
    const result = Parser.parseExtraction({
      className: "message",
      value: '{ "capability": "computer.do_magic", "arguments": {} }',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Unknown capability/i);
  });

  it("tolerates surrounding prose around a valid capability call", () => {
    const result = Parser.parseExtraction({
      className: "message",
      value: 'Sure, here you go: { "capability": "computer.click", "arguments": { "element_id": "e12" } } done.',
    });
    expect(result.ok).toBe(true);
    expect(result.payload!.capability).toBe("computer.click");
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

describe("ExtractorParser.buildPayload gating (tool-call only)", () => {
  it("accepts a bare capability call", () => {
    const built = Parser.buildPayload({
      className: "x",
      value: '{ "capability": "computer.type_text", "arguments": { "text": "hi" } }',
    });
    expect(built.ok).toBe(true);
    expect(built.call.capability).toBe("computer.type_text");
    expect(built.call.arguments).toEqual({ text: "hi" });
  });

  it("accepts a { tool: {...} } wrapper", () => {
    const built = Parser.buildPayload({
      className: "x",
      value: '{ "tool": { "capability": "computer.click", "arguments": {} } }',
    });
    expect(built.ok).toBe(true);
    expect(built.call.capability).toBe("computer.click");
  });

  it("rejects free-form text", () => {
    const built = Parser.buildPayload({ className: "x", value: "just talking" });
    expect(built.ok).toBe(false);
    expect(built.call).toBeNull();
  });

  it("rejects an unknown capability name", () => {
    const built = Parser.buildPayload({
      className: "x",
      value: '{ "capability": "computer.nope", "arguments": {} }',
    });
    expect(built.ok).toBe(false);
    expect(built.reason).toMatch(/Unknown capability/i);
  });

  it("rejects invalid JSON", () => {
    const built = Parser.buildPayload({
      className: "x",
      value: '{ "capability": "computer.click", }',
    });
    expect(built.ok).toBe(false);
  });

  it("rejects arguments that are not an object", () => {
    const built = Parser.buildPayload({
      className: "x",
      value: '{ "capability": "computer.click", "arguments": "e12" }',
    });
    expect(built.ok).toBe(false);
  });
});

describe("ExtractorParser.isKnownCapabilityName", () => {
  it("accepts capabilities we hold a schema for", () => {
    expect(Parser.isKnownCapabilityName("computer.type_text")).toBe(true);
    expect(Parser.isKnownCapabilityName("computer.click")).toBe(true);
  });

  it("accepts runtime meta-capabilities", () => {
    expect(Parser.isKnownCapabilityName("capabilities.list")).toBe(true);
    expect(Parser.isKnownCapabilityName("capabilities.describe")).toBe(true);
  });

  it("rejects invented computer.* names", () => {
    expect(Parser.isKnownCapabilityName("computer.do_magic")).toBe(false);
  });

  it("rejects empty or unrelated names", () => {
    expect(Parser.isKnownCapabilityName("")).toBe(false);
    expect(Parser.isKnownCapabilityName("do_thing")).toBe(false);
  });
});
