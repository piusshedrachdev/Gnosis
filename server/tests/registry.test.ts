import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "../src/capabilities/registry";
import { makeCapability } from "./helpers/fakeProvider";

describe("CapabilityRegistry", () => {
  it("starts empty", () => {
    const registry = new CapabilityRegistry();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it("registers a capability and looks it up", () => {
    const registry = new CapabilityRegistry();
    const capability = makeCapability();

    registry.register(capability);

    expect(registry.has("computer.click")).toBe(true);
    expect(registry.get("computer.click")).toBe(capability);
    expect(registry.size).toBe(1);
  });

  it("returns undefined for unknown capabilities", () => {
    const registry = new CapabilityRegistry();
    expect(registry.get("computer.nope")).toBeUndefined();
    expect(registry.has("computer.nope")).toBe(false);
  });

  it("registers many capabilities", () => {
    const registry = new CapabilityRegistry();
    registry.registerMany([
      makeCapability({ name: "computer.click" }),
      makeCapability({ name: "computer.type_text", providerToolName: "type_text" }),
    ]);

    expect(registry.size).toBe(2);
    expect(registry.list().map((c) => c.name).sort()).toEqual([
      "computer.click",
      "computer.type_text",
    ]);
  });

  it("overwrites an existing capability with the same name", () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCapability({ description: "first" }));
    registry.register(makeCapability({ description: "second" }));

    expect(registry.size).toBe(1);
    expect(registry.get("computer.click")?.description).toBe("second");
  });

  it("rejects a capability without a name", () => {
    const registry = new CapabilityRegistry();
    expect(() => registry.register(makeCapability({ name: "" }))).toThrow();
  });

  it("clears all capabilities", () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCapability());
    registry.clear();
    expect(registry.size).toBe(0);
  });
});
