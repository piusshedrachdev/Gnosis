import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "../src/capabilities/registry";
import {
  META_CAPABILITIES,
  isMetaCapability,
  listCapabilities,
  describeCapability,
  MetaCapabilityError,
} from "../src/capabilities/meta";
import { makeCapability } from "./helpers/fakeProvider";

function seededRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(makeCapability());
  registry.register(
    makeCapability({
      name: "computer.type_text",
      providerToolName: "type_text",
      description: "Type text.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    })
  );
  return registry;
}

describe("meta capabilities", () => {
  it("identifies runtime meta-capabilities", () => {
    expect(isMetaCapability(META_CAPABILITIES.list)).toBe(true);
    expect(isMetaCapability(META_CAPABILITIES.describe)).toBe(true);
    expect(isMetaCapability("computer.click")).toBe(false);
  });

  it("capabilities.list returns only name and description", () => {
    const registry = seededRegistry();
    const result = listCapabilities(registry);

    expect(result.capabilities).toHaveLength(2);

    for (const summary of result.capabilities) {
      expect(Object.keys(summary).sort()).toEqual(["description", "name"]);
      expect(summary).not.toHaveProperty("inputSchema");
      expect(summary).not.toHaveProperty("providerToolName");
    }
  });

  it("capabilities.describe returns the full definition including the schema", () => {
    const registry = seededRegistry();
    const detail = describeCapability(registry, "computer.click");

    expect(detail.name).toBe("computer.click");
    expect(detail.description).toBe("Click an element.");
    expect(detail.inputSchema).toEqual({
      type: "object",
      properties: { element_id: { type: "string" } },
      required: ["element_id"],
    });
  });

  it("capabilities.describe rejects an unknown capability", () => {
    const registry = seededRegistry();

    try {
      describeCapability(registry, "computer.nope");
      throw new Error("expected describeCapability to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MetaCapabilityError);
      expect((error as MetaCapabilityError).code).toBe("CAPABILITY_NOT_FOUND");
    }
  });

  it("capabilities.describe rejects a non-string name", () => {
    const registry = seededRegistry();

    try {
      describeCapability(registry, 42);
      throw new Error("expected describeCapability to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MetaCapabilityError);
      expect((error as MetaCapabilityError).code).toBe("INVALID_ARGUMENTS");
    }
  });
});
