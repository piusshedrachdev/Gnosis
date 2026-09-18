import { describe, it, expect } from "vitest";
import {
  CapabilityValidationError,
  validateArguments,
} from "../src/capabilities/validation";
import { makeCapability } from "./helpers/fakeProvider";

describe("validateArguments", () => {
  it("accepts arguments that satisfy the schema", () => {
    const capability = makeCapability();
    expect(() => validateArguments(capability, { element_id: "e12" })).not.toThrow();
  });

  it("rejects a missing required argument", () => {
    const capability = makeCapability();
    expect(() => validateArguments(capability, {})).toThrow(CapabilityValidationError);
  });

  it("rejects an argument of the wrong type", () => {
    const capability = makeCapability();
    expect(() => validateArguments(capability, { element_id: 42 })).toThrow(
      CapabilityValidationError
    );
  });

  it("reports validation details", () => {
    const capability = makeCapability();

    try {
      validateArguments(capability, {});
      throw new Error("expected validation to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      const typed = error as CapabilityValidationError;
      expect(typed.code).toBe("INVALID_ARGUMENTS");
      expect(Array.isArray(typed.details)).toBe(true);
      expect(typed.details.length).toBeGreaterThan(0);
    }
  });

  it("skips validation when the schema is empty", () => {
    const capability = makeCapability({ inputSchema: {} });
    expect(() => validateArguments(capability, { anything: true })).not.toThrow();
  });

  it("validates a string argument capability", () => {
    const capability = makeCapability({
      name: "computer.type_text",
      providerToolName: "type_text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    });

    expect(() => validateArguments(capability, { text: "hello" })).not.toThrow();
    expect(() => validateArguments(capability, { text: 123 })).toThrow(
      CapabilityValidationError
    );
  });
});
