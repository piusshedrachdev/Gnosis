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
  buildButtonTarget: (s: unknown) => {
    type: string;
    value: string;
    selector: string | null;
    valid: boolean;
  };
  shouldAutoClick: (s: unknown) => boolean;
  pageKeyFromUrl: (u: string) => string | null;
  pageSettingsKey: (k: string) => string;
  emptyPageSettings: () => Record<string, unknown>;
  pickPageSettings: (s: unknown) => Record<string, unknown>;
  pageLabel: (k: string) => string;
  pickPageTab: (tabs: unknown) => { id?: number; url?: string } | null;
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

describe("SelectorUtil.buildButtonTarget (auto-click)", () => {
  it("builds a class button selector", () => {
    const target = SelectorUtil.buildButtonTarget({
      buttonType: "class",
      buttonValue: "send-button",
    });
    expect(target.valid).toBe(true);
    expect(target.selector).toBe(".send-button");
  });

  it("builds an id button selector", () => {
    const target = SelectorUtil.buildButtonTarget({
      buttonType: "id",
      buttonValue: "submit",
    });
    expect(target.selector).toBe("#submit");
    expect(target.valid).toBe(true);
  });

  it("is invalid when no button value is provided", () => {
    const target = SelectorUtil.buildButtonTarget({
      buttonType: "class",
      buttonValue: "",
    });
    expect(target.valid).toBe(false);
    expect(target.selector).toBeNull();
  });

  it("handles missing/invalid state safely", () => {
    expect(SelectorUtil.buildButtonTarget(undefined).valid).toBe(false);
    expect(SelectorUtil.buildButtonTarget(null).valid).toBe(false);
  });
});

describe("SelectorUtil.shouldAutoClick (auto-send gating)", () => {
  it("is true only when auto-send is on AND a button is set", () => {
    expect(
      SelectorUtil.shouldAutoClick({
        autoSend: true,
        buttonType: "class",
        buttonValue: "send",
      })
    ).toBe(true);
  });

  it("is false when auto-send is off", () => {
    expect(
      SelectorUtil.shouldAutoClick({
        autoSend: false,
        buttonType: "class",
        buttonValue: "send",
      })
    ).toBe(false);
  });

  it("is false when auto-send is on but no button value is set", () => {
    expect(
      SelectorUtil.shouldAutoClick({
        autoSend: true,
        buttonType: "class",
        buttonValue: "",
      })
    ).toBe(false);
  });

  it("handles missing/invalid state safely", () => {
    expect(SelectorUtil.shouldAutoClick(undefined)).toBe(false);
    expect(SelectorUtil.shouldAutoClick(null)).toBe(false);
    expect(SelectorUtil.shouldAutoClick("nope")).toBe(false);
  });
});

describe("SelectorUtil.pageKeyFromUrl (per-page keying)", () => {
  it("reduces an https URL to its origin", () => {
    expect(SelectorUtil.pageKeyFromUrl("https://www.whatsapp.com/send?x=1")).toBe(
      "https://www.whatsapp.com"
    );
  });

  it("keeps http vs https distinct", () => {
    expect(SelectorUtil.pageKeyFromUrl("http://example.com")).toBe("http://example.com");
    expect(SelectorUtil.pageKeyFromUrl("https://example.com")).toBe("https://example.com");
  });

  it("keeps port in the origin", () => {
    expect(SelectorUtil.pageKeyFromUrl("http://localhost:3000/app")).toBe(
      "http://localhost:3000"
    );
  });

  it("rejects non-http(s) and invalid URLs", () => {
    expect(SelectorUtil.pageKeyFromUrl("chrome://extensions")).toBeNull();
    expect(SelectorUtil.pageKeyFromUrl("file:///C:/x.html")).toBeNull();
    expect(SelectorUtil.pageKeyFromUrl("about:blank")).toBeNull();
    expect(SelectorUtil.pageKeyFromUrl("not a url")).toBeNull();
    expect(SelectorUtil.pageKeyFromUrl("")).toBeNull();
  });
});

describe("SelectorUtil.pageSettingsKey + emptyPageSettings", () => {
  it("namespaces the storage key by page", () => {
    expect(SelectorUtil.pageSettingsKey("https://example.com")).toBe(
      "pageSettings:https://example.com"
    );
  });

  it("returns a full default settings record", () => {
    const s = SelectorUtil.emptyPageSettings();
    expect(s).toEqual({
      selectorType: "class",
      selectorValue: "",
      injectType: "class",
      injectValue: "",
      autoSend: false,
      buttonType: "class",
      buttonValue: "",
    });
  });
});

describe("SelectorUtil.pickPageSettings", () => {
  it("keeps only known fields and applies defaults", () => {
    const picked = SelectorUtil.pickPageSettings({
      selectorType: "id",
      selectorValue: "out",
      injectType: "class",
      injectValue: "composer",
      autoSend: true,
      buttonType: "id",
      buttonValue: "send",
      extra: "ignored",
    });
    expect(picked).toEqual({
      selectorType: "id",
      selectorValue: "out",
      injectType: "class",
      injectValue: "composer",
      autoSend: true,
      buttonType: "id",
      buttonValue: "send",
    });
  });

  it("fills defaults for a missing/invalid record", () => {
    expect(SelectorUtil.pickPageSettings(undefined)).toEqual(
      SelectorUtil.emptyPageSettings()
    );
    expect(SelectorUtil.pickPageSettings(null)).toEqual(
      SelectorUtil.emptyPageSettings()
    );
  });
});

describe("SelectorUtil.pageLabel", () => {
  it("strips the scheme for display", () => {
    expect(SelectorUtil.pageLabel("https://www.whatsapp.com")).toBe("www.whatsapp.com");
    expect(SelectorUtil.pageLabel("http://localhost:3000")).toBe("localhost:3000");
  });
});

describe("SelectorUtil.pickPageTab (skip extension/options tabs)", () => {
  it("picks the active web tab, skipping a chrome-extension tab", () => {
    const tab = SelectorUtil.pickPageTab([
      { id: 1, url: "chrome-extension://abc/options.html", active: true },
      { id: 2, url: "https://www.whatsapp.com/", active: false },
    ]);
    expect(tab).not.toBeNull();
    expect(tab!.id).toBe(2);
  });

  it("prefers an active usable tab over inactive ones", () => {
    const tab = SelectorUtil.pickPageTab([
      { id: 1, url: "https://a.com/", active: false, lastAccessed: 999 },
      { id: 2, url: "https://b.com/", active: true, lastAccessed: 1 },
    ]);
    expect(tab!.id).toBe(2);
  });

  it("falls back to the most recently accessed usable tab", () => {
    const tab = SelectorUtil.pickPageTab([
      { id: 1, url: "https://old.com/", active: false, lastAccessed: 10 },
      { id: 2, url: "https://new.com/", active: false, lastAccessed: 50 },
    ]);
    expect(tab!.id).toBe(2);
  });

  it("returns null when no usable tab exists", () => {
    expect(
      SelectorUtil.pickPageTab([
        { id: 1, url: "chrome-extension://abc/options.html", active: true },
        { id: 2, url: "chrome://extensions", active: false },
      ])
    ).toBeNull();
    expect(SelectorUtil.pickPageTab([])).toBeNull();
    expect(SelectorUtil.pickPageTab(undefined)).toBeNull();
  });

  it("finds a chat.deepseek.com page tab when the options tab is active", () => {
    const tab = SelectorUtil.pickPageTab([
      { id: 1, url: "chrome-extension://abc/options.html", active: true },
      { id: 2, url: "https://chat.deepseek.com/", active: false },
    ]);
    expect(tab).not.toBeNull();
    expect(SelectorUtil.pageKeyFromUrl((tab as any).url)).toBe(
      "https://chat.deepseek.com"
    );
  });

  it("accepts a tab that only exposes pendingUrl (still loading)", () => {
    const tab = SelectorUtil.pickPageTab([
      { id: 1, url: "chrome-extension://abc/options.html", active: true },
      { id: 2, pendingUrl: "https://chat.deepseek.com/", active: false },
    ]);
    expect(tab).not.toBeNull();
    expect((tab as any).id).toBe(2);
  });
});
