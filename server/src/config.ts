import "dotenv/config";

/**
 * Runtime configuration, read from environment variables with sane defaults.
 */
export interface AppConfig {
  /** Path to the Munim executable (or any MCP stdio command). */
  munimPath: string;
  /** HTTP port for the testing interface. */
  port: number;
  /** Application-facing capability prefix. */
  capabilityPrefix: string;
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;

  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Set it in .env or the environment.`
    );
  }

  return value;
}

export function loadConfig(): AppConfig {
  const portRaw = process.env.PORT ?? "3000";
  const port = Number.parseInt(portRaw, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: "${portRaw}".`);
  }

  return {
    munimPath: requireEnv("MUNIM_PATH"),
    port,
    capabilityPrefix: process.env.CAPABILITY_PREFIX ?? "computer",
  };
}
