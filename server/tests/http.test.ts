import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { AgentRuntime } from "../src/agent/runtime";
import { CapabilityRegistry } from "../src/capabilities/registry";
import { createHttpApp } from "../src/server/http";
import { FakeProvider, makeCapability } from "./helpers/fakeProvider";

function buildApp() {
  const registry = new CapabilityRegistry();
  const provider = new FakeProvider("fake", [makeCapability()]);
  const runtime = new AgentRuntime(registry);
  runtime.registerProvider(provider);
  const app = createHttpApp(runtime, registry);
  return { registry, provider, runtime, app };
}

describe("HTTP interface", () => {
  let registry: CapabilityRegistry;
  let provider: FakeProvider;
  let runtime: AgentRuntime;
  let app: ReturnType<typeof createHttpApp>;

  beforeEach(async () => {
    ({ registry, provider, runtime, app } = buildApp());
    await runtime.discoverAll();
  });

  it("reports health at /", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.capabilities).toBe(1);
  });

  it("GET /capabilities returns lightweight discovery", async () => {
    const res = await request(app).get("/capabilities");

    expect(res.status).toBe(200);
    expect(res.body.capabilities).toHaveLength(1);
    expect(res.body.capabilities[0].name).toBe("computer.click");
    expect(res.body.capabilities[0]).not.toHaveProperty("inputSchema");
  });

  it("GET /capabilities/:name returns the full definition", async () => {
    const res = await request(app).get("/capabilities/computer.click");

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("computer.click");
    expect(res.body.inputSchema).toBeDefined();
  });

  it("GET /capabilities/:name returns 404 for unknown capabilities", async () => {
    const res = await request(app).get("/capabilities/computer.nope");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CAPABILITY_NOT_FOUND");
  });

  it("POST /execute runs a valid capability", async () => {
    provider.result = { clicked: true };

    const res = await request(app)
      .post("/execute")
      .send({ capability: "computer.click", arguments: { element_id: "e12" } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result).toEqual({ clicked: true });
  });

  it("POST /execute returns 400 for a missing capability field", async () => {
    const res = await request(app).post("/execute").send({ arguments: {} });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  it("POST /execute returns 404 for an unknown capability", async () => {
    const res = await request(app)
      .post("/execute")
      .send({ capability: "computer.nope", arguments: {} });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CAPABILITY_NOT_FOUND");
  });

  it("POST /execute returns 400 for invalid arguments", async () => {
    const res = await request(app)
      .post("/execute")
      .send({ capability: "computer.click", arguments: {} });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_ARGUMENTS");
  });

  it("POST /execute supports meta-capabilities", async () => {
    const res = await request(app)
      .post("/execute")
      .send({ capability: "capabilities.list", arguments: {} });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.capabilities).toHaveLength(1);
  });
});
