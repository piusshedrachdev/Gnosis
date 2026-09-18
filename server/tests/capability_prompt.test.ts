import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Tests for the browser extension's agent-facing capability prompt.
 *
 * The prompt must teach the agent the discover -> describe -> execute loop
 * against the Agent Runtime HTTP interface, and must never instruct the agent
 * to call the computer tool (Munim) directly.
 */

const require = createRequire(import.meta.url);
const promptPath = path.resolve(
  __dirname,
  "../../browser_extension/capability_prompt.js"
);

const CapabilityPrompt = require(promptPath) as {
  RUNTIME: { baseUrl: string; routes: Record<string, string> };
  META: { list: string; describe: string };
  buildCapabilityPrompt: (opts?: {
    baseUrl?: string;
    capabilities?: Array<{ name: string; description: string }>;
  }) => string;
  buildCompactPrompt: (opts?: { baseUrl?: string }) => string;
};

describe("CapabilityPrompt.buildCapabilityPrompt", () => {
  it("documents the discover -> describe -> execute loop", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt();

    expect(prompt).toMatch(/discover/i);
    expect(prompt).toMatch(/describe/i);
    expect(prompt).toMatch(/execute/i);
  });

  it("references the runtime HTTP routes", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt();

    expect(prompt).toContain("/capabilities");
    expect(prompt).toContain("/execute");
    expect(prompt).toContain("GET");
    expect(prompt).toContain("POST");
  });

  it("references the meta-capabilities", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt();

    expect(prompt).toContain(CapabilityPrompt.META.list);
    expect(prompt).toContain(CapabilityPrompt.META.describe);
  });

  it("instructs the agent NOT to call the computer tool directly", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt();

    expect(prompt).toMatch(/do NOT call the underlying computer tool/i);
  });

  it("describes the /execute body contract", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt();

    expect(prompt).toContain('"capability"');
    expect(prompt).toContain('"arguments"');
  });

  it("lists preloaded capabilities when provided", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt({
      capabilities: [
        { name: "computer.click", description: "Click an element." },
      ],
    });

    expect(prompt).toContain("computer.click");
    expect(prompt).toContain("Click an element.");
  });

  it("says none are preloaded when the list is empty", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt({ capabilities: [] });
    expect(prompt).toMatch(/none preloaded/i);
  });

  it("honors a custom base URL", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt({
      baseUrl: "http://localhost:9999",
    });
    expect(prompt).toContain("http://localhost:9999");
  });

  it("documents the runtime error codes", () => {
    const prompt = CapabilityPrompt.buildCapabilityPrompt();

    expect(prompt).toContain("CAPABILITY_NOT_FOUND");
    expect(prompt).toContain("INVALID_REQUEST");
    expect(prompt).toContain("INVALID_ARGUMENTS");
  });
});

describe("CapabilityPrompt.buildCompactPrompt", () => {
  it("produces a one-paragraph reminder with the full loop", () => {
    const compact = CapabilityPrompt.buildCompactPrompt();

    expect(compact).toContain("/capabilities");
    expect(compact).toContain("/execute");
    expect(compact).toMatch(/never call the computer tool directly/i);
  });

  it("honors a custom base URL", () => {
    const compact = CapabilityPrompt.buildCompactPrompt({
      baseUrl: "http://localhost:7777",
    });
    expect(compact).toContain("http://localhost:7777");
  });
});
