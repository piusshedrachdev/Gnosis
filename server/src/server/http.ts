import express, { Request, Response } from "express";
import { AgentRuntime } from "../agent/runtime";
import { CapabilityRegistry } from "../capabilities/registry";
import { listCapabilities, describeCapability, MetaCapabilityError } from "../capabilities/meta";

/**
 * HTTP layer for the Agent Capability Runtime.
 *
 * This is an infrastructure/testing interface, not the model's capability
 * interface. It exposes:
 *
 *   GET  /capabilities
 *   GET  /capabilities/:name
 *   POST /execute
 */
export function createHttpApp(
  runtime: AgentRuntime,
  registry: CapabilityRegistry
) {
  const app = express();

  app.use(express.json({ limit: "10mb" }));

  /** Health check. */
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "Agent Capability Runtime",
      capabilities: registry.size,
    });
  });

  /** Lightweight capability discovery. */
  app.get("/capabilities", (_req: Request, res: Response) => {
    res.json(listCapabilities(registry));
  });

  /** Full capability definition, including the provider input schema. */
  app.get("/capabilities/:name", (req: Request, res: Response) => {
    try {
      // Express decodes the param; capability names may contain dots.
      const detail = describeCapability(registry, req.params.name);
      res.json(detail);
    } catch (error) {
      if (error instanceof MetaCapabilityError) {
        const status = error.code === "CAPABILITY_NOT_FOUND" ? 404 : 400;
        return res.status(status).json({
          error: true,
          code: error.code,
          message: error.message,
        });
      }

      res.status(500).json({
        error: true,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /** Generic capability execution endpoint. */
  app.post("/execute", async (req: Request, res: Response) => {
    const body = req.body ?? {};

    if (typeof body.capability !== "string") {
      return res.status(400).json({
        error: true,
        code: "INVALID_REQUEST",
        message: 'Request body must include a string "capability" field.',
      });
    }

    const response = await runtime.execute({
      capability: body.capability,
      arguments: body.arguments ?? {},
    });

    const status = response.ok ? 200 : statusForCode(response.code);
    res.status(status).json(response);
  });

  return app;
}

/** Map runtime error codes to HTTP status codes. */
function statusForCode(code: string): number {
  switch (code) {
    case "CAPABILITY_NOT_FOUND":
    case "PROVIDER_NOT_FOUND":
      return 404;
    case "INVALID_REQUEST":
    case "INVALID_ARGUMENTS":
      return 400;
    default:
      return 500;
  }
}
