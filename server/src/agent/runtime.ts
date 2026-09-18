import { CapabilityRegistry } from "../capabilities/registry";
import {
  META_CAPABILITIES,
  isMetaCapability,
  listCapabilities,
  describeCapability,
} from "../capabilities/meta";
import {
  CapabilityValidationError,
  validateArguments,
} from "../capabilities/validation";
import { CapabilityProvider } from "../providers/provider";

/** A single action requested by the agent. */
export interface AgentAction {
  capability: string;
  arguments?: Record<string, unknown>;
}

/** Successful runtime response. */
export interface RuntimeSuccess {
  ok: true;
  capability: string;
  result: unknown;
}

/** Failed runtime response. */
export interface RuntimeFailure {
  ok: false;
  error: true;
  code: string;
  message: string;
  details?: unknown;
}

export type RuntimeResponse = RuntimeSuccess | RuntimeFailure;

/** Error thrown by the runtime for resolution/validation failures. */
export class RuntimeError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.details = details;
  }
}

/**
 * The Agent Runtime routes agent actions to the right provider.
 *
 * It:
 *   - resolves capabilities from the registry
 *   - handles runtime meta-capabilities internally
 *   - validates arguments against the capability schema
 *   - delegates execution to the owning provider
 *   - returns the provider result untouched
 */
export class AgentRuntime {
  private readonly providers = new Map<string, CapabilityProvider>();

  constructor(private readonly registry: CapabilityRegistry) {}

  /** Register a provider under its own name. */
  registerProvider(provider: CapabilityProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Retrieve a registered provider by name. */
  getProvider(name: string): CapabilityProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Run one or more providers' discovery and register the results.
   *
   * Returns the capabilities that were registered.
   */
  async discoverAll(): Promise<number> {
    let count = 0;

    for (const provider of this.providers.values()) {
      const capabilities = await provider.discover();
      this.registry.registerMany(capabilities);
      count += capabilities.length;
    }

    return count;
  }

  /**
   * Execute a single agent action.
   *
   * Never throws for expected failures (unknown capability, invalid arguments,
   * provider errors); instead it returns a structured RuntimeFailure.
   */
  async execute(action: AgentAction): Promise<RuntimeResponse> {
    try {
      return { ok: true, capability: action.capability, result: await this.dispatch(action) };
    } catch (error) {
      return this.toFailure(action.capability, error);
    }
  }

  /** Internal dispatch that may throw. */
  private async dispatch(action: AgentAction): Promise<unknown> {
    if (!action || typeof action.capability !== "string") {
      throw new RuntimeError(
        "INVALID_REQUEST",
        "An action must include a string \"capability\" field."
      );
    }

    const args = action.arguments ?? {};

    if (typeof args !== "object" || Array.isArray(args)) {
      throw new RuntimeError(
        "INVALID_REQUEST",
        "\"arguments\" must be an object when provided."
      );
    }

    // Meta-capabilities are handled by the runtime itself.
    if (isMetaCapability(action.capability)) {
      return this.executeMeta(action.capability, args as Record<string, unknown>);
    }

    const capability = this.registry.get(action.capability);

    if (!capability) {
      // Do not call the provider for unknown capabilities.
      throw new RuntimeError(
        "CAPABILITY_NOT_FOUND",
        `Unknown capability: ${action.capability}`
      );
    }

    validateArguments(capability, args as Record<string, unknown>);

    const provider = this.providers.get(capability.provider);

    if (!provider) {
      throw new RuntimeError(
        "PROVIDER_NOT_FOUND",
        `No provider registered for "${capability.provider}".`
      );
    }

    return provider.execute(capability, args as Record<string, unknown>);
  }

  /** Handle runtime-owned meta-capabilities. */
  private executeMeta(
    name: string,
    args: Record<string, unknown>
  ): unknown {
    switch (name) {
      case META_CAPABILITIES.list:
        return listCapabilities(this.registry);
      case META_CAPABILITIES.describe:
        return describeCapability(this.registry, args.name);
      default:
        throw new RuntimeError(
          "CAPABILITY_NOT_FOUND",
          `Unknown capability: ${name}`
        );
    }
  }

  /** Normalize any thrown error into a RuntimeFailure. */
  private toFailure(capability: string, error: unknown): RuntimeFailure {
    if (error instanceof RuntimeError) {
      return {
        ok: false,
        error: true,
        code: error.code,
        message: error.message,
        details: error.details,
      };
    }

    if (error instanceof CapabilityValidationError) {
      return {
        ok: false,
        error: true,
        code: error.code,
        message: error.message,
        details: error.details,
      };
    }

    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      return {
        ok: false,
        error: true,
        code,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      ok: false,
      error: true,
      code: "EXECUTION_ERROR",
      message:
        error instanceof Error
          ? error.message
          : `Failed to execute capability: ${capability}`,
    };
  }
}
