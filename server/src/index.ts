import { loadConfig } from "./config";
import { AgentRuntime } from "./agent/runtime";
import { CapabilityRegistry } from "./capabilities/registry";
import { MunimProvider } from "./providers/munim";
import { createHttpApp } from "./server/http";

/**
 * Application entry point.
 *
 * Startup sequence:
 *   config -> connect Munim -> discover tools -> register capabilities
 *   -> build runtime -> start HTTP interface.
 *
 * The old generic /tools gateway has been replaced by the capability runtime.
 * The provider itself still exposes the raw tools for debugging.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  console.log("Starting Agent Capability Runtime...");

  const provider = new MunimProvider({
    command: config.munimPath,
    prefix: config.capabilityPrefix,
  });

  console.log("Connecting to Munim...");
  await provider.connect();
  console.log("Connected to Munim.");

  const registry = new CapabilityRegistry();
  const runtime = new AgentRuntime(registry);
  runtime.registerProvider(provider);

  console.log("Discovering capabilities...");
  const count = await runtime.discoverAll();
  console.log(`Registered ${count} capabilities:`);

  for (const capability of registry.list()) {
    console.log(`  - ${capability.name}`);
  }

  const app = createHttpApp(runtime, registry);

  const server = app.listen(config.port, () => {
    console.log(`\nHTTP interface: http://localhost:${config.port}`);
    console.log(`  GET  /capabilities`);
    console.log(`  GET  /capabilities/:name`);
    console.log(`  POST /execute`);
  });

  /** Graceful shutdown. */
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down...`);
    server.close();
    await provider.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Failed to start Agent Capability Runtime:", error);
  process.exit(1);
});
