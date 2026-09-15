import { describe, it, expect, beforeEach } from "vitest";
import { AgentRuntime } from "../src/agent/runtime";
import { CapabilityRegistry } from "../src/capabilities/registry";
import { META_CAPABILITIES } from "../src/capabilities/meta";
import { FakeProvider, makeCapability } from "./helpers/fakeProvider";

function buildRuntime() {
  const registry = new CapabilityRegistry();
  const provider = new FakeProvider("fake", [makeCapability()]);
  const runtime = new AgentRuntime(registry);
  runtime.registerProvider(provider);
  return { registry, provider, runtime };
}

describe("AgentRuntime", () => {
  let registry: CapabilityRegistry;
  let provider: FakeProvider;
  let runtime: AgentRuntime;

  beforeEach(async () => {
    ({ registry, provider, runtime } = buildRuntime());
    await runtime.discoverAll();
  });

  it("discovers capabilities from providers into the registry", () => {
    expect(registry.size).toBe(1);
    expect(registry.has("computer.click")).toBe(true);
  });

  it("handles capabilities.list internally without calling a provider", async () => {
    const response = await runtime.execute({ capability: META_CAPABILITIES.list });

    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const result = response.result as { capabilities: Array<{ name: string }> };
    expect(result.capabilities.map((c) => c.name)).toEqual(["computer.click"]);
    expect(provider.calls).toHaveLength(0);
  });

  it("handles capabilities.describe internally", async () => {
    const response = await runtime.execute({
      capability: META_CAPABILITIES.describe,
      arguments: { name: "computer.click" },
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const result = response.result as { inputSchema: unknown };
    expect(result.inputSchema).toBeDefined();
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects an unknown capability without calling the provider", async () => {
    const response = await runtime.execute({ capability: "computer.nope", arguments: {} });

    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.code).toBe("CAPABILITY_NOT_FOUND");
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects invalid arguments before execution", async () => {
    const response = await runtime.execute({
      capability: "computer.click",
      arguments: {},
    });

    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.code).toBe("INVALID_ARGUMENTS");
    expect(provider.calls).toHaveLength(0);
  });

  it("executes a valid capability through the provider", async () => {
    provider.result = { clicked: true };

    const response = await runtime.execute({
      capability: "computer.click",
      arguments: { element_id: "e12" },
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result).toEqual({ clicked: true });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual({
      capability: "computer.click",
      args: { element_id: "e12" },
    });
  });

  it("returns the provider result untouched", async () => {
    const providerResult = {
      content: [{ type: "text", text: "done" }],
      isError: false,
    };
    provider.result = providerResult;

    const response = await runtime.execute({
      capability: "computer.click",
      arguments: { element_id: "e1" },
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result).toBe(providerResult);
  });

  it("normalizes provider errors into a failure response", async () => {
    provider.error = new Error("munim exploded");

    const response = await runtime.execute({
      capability: "computer.click",
      arguments: { element_id: "e1" },
    });

    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.message).toBe("munim exploded");
  });

  it("rejects a request without a capability field", async () => {
    const response = await runtime.execute({} as never);
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.code).toBe("INVALID_REQUEST");
  });

  it("does not require hard-coded routes for new capabilities", async () => {
    const fresh = new FakeProvider("fake2", [
      makeCapability({
        name: "computer.brand_new_tool",
        provider: "fake2",
        providerToolName: "brand_new_tool",
        inputSchema: { type: "object", properties: {} },
      }),
    ]);

    const freshRegistry = new CapabilityRegistry();
    const freshRuntime = new AgentRuntime(freshRegistry);
    freshRuntime.registerProvider(fresh);
    await freshRuntime.discoverAll();

    expect(freshRegistry.has("computer.brand_new_tool")).toBe(true);

    fresh.result = { ok: true };
    const response = await freshRuntime.execute({
      capability: "computer.brand_new_tool",
      arguments: {},
    });

    expect(response.ok).toBe(true);
    expect(fresh.calls).toHaveLength(1);
  });
});
