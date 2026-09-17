import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Tests for the browser extension's selector/session helpers.
 *
 * These cover the Start-gated behavior: the extension is idle unless a
 * session is running AND a target value was supplied.
 */

const require = createRequire(import.meta.url);
const selectorPath = path.resolve(
  __dirname,
  "../../browser_extension/selector.js"
);

const SelectorUtil = require(selectorPath) as {
  SELECTOR_TYPES: string[];
  normalizeType: (t: unknown) => string;
  normalizeValue: (v: unknown) => string;
  buildSelector: (t: string, v: string) => string | null;
  buildInjectTarget: (s: unknown) => {
    type: string;
    value: string;
    selector: string | null;
    valid: boolean;
  };
  buildTextareaTarget: (s: unknown) => {
    containerSelector: string | null;
    textareaSelector: string | null;
    valid: boolean;
  };
  composeContent: (
    existing: string,
    content: string,
    mode: "replace" | "append"
  ) => string;
  shouldRun: (s: unknown) => boolean;
  canInject: (s: unknown) => boolean;
};

describe("SelectorUtil.normalizeType", () => {
  it("keeps valid types", () => {
    expect(SelectorUtil.normalizeType("class")).toBe("class");
    expect(SelectorUtil.normalizeType("id")).toBe("id");
  });

  it("defaults unknown types to class", () => {
    expect(SelectorUtil.normalizeType("tag")).toBe("class");
    expect(SelectorUtil.normalizeType(undefined)).toBe("class");
  });
});

describe("SelectorUtil.normalizeValue", () => {
  it("trims strings", () => {
    expect(SelectorUtil.normalizeValue("  foo ")).toBe("foo");
  });

  it("returns empty string for non-strings", () => {
    expect(SelectorUtil.normalizeValue(undefined)).toBe("");
    expect(SelectorUtil.normalizeValue(123)).toBe("");
  });
});

describe("SelectorUtil.buildSelector", () => {
  it("builds a class selector", () => {
    expect(SelectorUtil.buildSelector("class", "message")).toBe(".message");
  });

  it("builds an id selector", () => {
    expect(SelectorUtil.buildSelector("id", "output")).toBe("#output");
  });

  it("returns null for an empty value", () => {
    expect(SelectorUtil.buildSelector("class", "")).toBeNull();
    expect(SelectorUtil.buildSelector("id", "   ")).toBeNull();
  });

  it("defaults to class for an unknown type", () => {
    expect(SelectorUtil.buildSelector("bogus", "x")).toBe(".x");
  });

  it("escapes characters that are unsafe in selectors", () => {
    const sel = SelectorUtil.buildSelector("class", "a:b");
    expect(sel).not.toBeNull();
    expect(sel!.startsWith(".")).toBe(true);
    expect(sel).toContain("\\");
  });
});

describe("SelectorUtil.shouldRun (Start gating)", () => {
  it("is false when no session has been started", () => {
    expect(SelectorUtil.shouldRun({ extractorRunning: false, selectorValue: "x" })).toBe(false);
  });

  it("is false when running but no target value was provided", () => {
    expect(SelectorUtil.shouldRun({ extractorRunning: true, selectorValue: "" })).toBe(false);
    expect(SelectorUtil.shouldRun({ extractorRunning: true, selectorValue: "   " })).toBe(false);
  });

  it("is true only when running AND a value is provided", () => {
    expect(SelectorUtil.shouldRun({ extractorRunning: true, selectorValue: "target" })).toBe(true);
  });

  it("handles missing/invalid state safely", () => {
    expect(SelectorUtil.shouldRun(undefined)).toBe(false);
    expect(SelectorUtil.shouldRun(null)).toBe(false);
    expect(SelectorUtil.shouldRun("nope")).toBe(false);
  });
});

describe("SelectorUtil.buildInjectTarget (destination)", () => {
  it("builds a valid class inject target", () => {
    const target = SelectorUtil.buildInjectTarget({
      injectType: "class",
      injectValue: "agent-output",
    });
    expect(target).toEqual({
      type: "class",
      value: "agent-output",
      selector: ".agent-output",
      valid: true,
    });
  });

  it("builds a valid id inject target", () => {
    const target = SelectorUtil.buildInjectTarget({
      injectType: "id",
      injectValue: "result",
    });
    expect(target.selector).toBe("#result");
    expect(target.valid).toBe(true);
  });

  it("is invalid when no destination value is provided", () => {
    const target = SelectorUtil.buildInjectTarget({
      injectType: "class",
      injectValue: "",
    });
    expect(target.selector).toBeNull();
    expect(target.valid).toBe(false);
  });

  it("defaults to class for an unknown inject type", () => {
    const target = SelectorUtil.buildInjectTarget({
      injectType: "bogus",
      injectValue: "out",
    });
    expect(target.type).toBe("class");
    expect(target.selector).toBe(".out");
  });

  it("handles missing/invalid state safely", () => {
    expect(SelectorUtil.buildInjectTarget(undefined).valid).toBe(false);
    expect(SelectorUtil.buildInjectTarget(null).valid).toBe(false);
    expect(SelectorUtil.buildInjectTarget("nope").valid).toBe(false);
  });
});

describe("SelectorUtil.canInject (both selectors required)", () => {
  it("is true only when running, with a source AND a destination", () => {
    expect(
      SelectorUtil.canInject({
        extractorRunning: true,
        selectorValue: "source",
        injectValue: "destination",
      })
    ).toBe(true);
  });

  it("is false when the source is missing", () => {
    expect(
      SelectorUtil.canInject({
        extractorRunning: true,
        selectorValue: "",
        injectValue: "destination",
      })
    ).toBe(false);
  });

  it("is false when the destination is missing", () => {
    expect(
      SelectorUtil.canInject({
        extractorRunning: true,
        selectorValue: "source",
        injectValue: "",
      })
    ).toBe(false);
  });

  it("is false when no session is running", () => {
    expect(
      SelectorUtil.canInject({
        extractorRunning: false,
        selectorValue: "source",
        injectValue: "destination",
      })
    ).toBe(false);
  });
});

describe("SelectorUtil.buildTextareaTarget (container -> textarea)", () => {
  it("builds a container selector and a scoped textarea selector", () => {
    const target = SelectorUtil.buildTextareaTarget({
      injectType: "class",
      injectValue: "chat-input",
    });
    expect(target.valid).toBe(true);
    expect(target.containerSelector).toBe(".chat-input");
    expect(target.textareaSelector).toBe(".chat-input textarea");
  });

  it("scopes the textarea selector for an id container", () => {
    const target = SelectorUtil.buildTextareaTarget({
      injectType: "id",
      injectValue: "composer",
    });
    expect(target.containerSelector).toBe("#composer");
    expect(target.textareaSelector).toBe("#composer textarea");
  });

  it("is invalid when no container value is provided", () => {
    const target = SelectorUtil.buildTextareaTarget({
      injectType: "class",
      injectValue: "",
    });
    expect(target.valid).toBe(false);
    expect(target.containerSelector).toBeNull();
    expect(target.textareaSelector).toBeNull();
  });

  it("handles missing/invalid state safely", () => {
    expect(SelectorUtil.buildTextareaTarget(undefined).valid).toBe(false);
    expect(SelectorUtil.buildTextareaTarget(null).valid).toBe(false);
    expect(SelectorUtil.buildTextareaTarget("nope").valid).toBe(false);
  });
});

describe("SelectorUtil.composeContent (replace vs append)", () => {
  it("replace mode returns only the new content", () => {
    expect(SelectorUtil.composeContent("OLD PROMPT", "NEW", "replace")).toBe("NEW");
  });

  it("append mode keeps the prompt and adds the result below it", () => {
    const out = SelectorUtil.composeContent(
      "PROMPT TEXT",
      '{ "ok": true }',
      "append"
    );
    expect(out).toBe('PROMPT TEXT\n\n{ "ok": true }');
    expect(out.startsWith("PROMPT TEXT")).toBe(true);
    expect(out).toContain('{ "ok": true }');
  });

  it("append mode with empty existing returns the new content", () => {
    expect(SelectorUtil.composeContent("", "RESULT", "append")).toBe("RESULT");
  });

  it("append mode with empty content returns the existing content", () => {
    expect(SelectorUtil.composeContent("PROMPT", "", "append")).toBe("PROMPT");
  });

  it("handles non-string inputs safely", () => {
    // @ts-expect-error deliberate bad input
    expect(SelectorUtil.composeContent(undefined, "X", "replace")).toBe("X");
    // @ts-expect-error deliberate bad input
    expect(SelectorUtil.composeContent("X", undefined, "append")).toBe("X");
  });

  it("demonstrates the bug fix: prompt survives the response", () => {
    const prompt = "CAPABILITY PROMPT";
    const response = '{ "ok": true, "result": "typed 32 characters" }';

    // Old behavior: the response replaced the prompt entirely.
    const oldBehavior = SelectorUtil.composeContent(prompt, response, "replace");
    expect(oldBehavior).not.toContain("CAPABILITY PROMPT");

    // New behavior: the response is appended, prompt remains.
    const newBehavior = SelectorUtil.composeContent(prompt, response, "append");
    expect(newBehavior).toContain("CAPABILITY PROMPT");
    expect(newBehavior).toContain('"ok": true');
  });
});
