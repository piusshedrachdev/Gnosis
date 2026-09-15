/**
 * Provider abstraction.
 *
 * The runtime must not depend directly on Munim. A provider translates the
 * application's capability model into whatever the underlying system exposes
 * (for the MVP: Munim's MCP tools).
 */

/**
 * A single capability exposed by a provider, normalized for the application.
 */
export interface CapabilityDefinition {
  /** Application-facing name, e.g. "computer.click". */
  name: string;

  /** Name of the provider that owns this capability, e.g. "munim". */
  provider: string;

  /** The provider's own name for the underlying tool, e.g. "click". */
  providerToolName: string;

  /** Human/LLM readable description of what the capability does. */
  description: string;

  /**
   * Complete JSON Schema for the capability's arguments, preserved exactly as
   * supplied by the provider.
   */
  inputSchema: Record<string, unknown>;
}

/**
 * Anything that can supply capabilities to the runtime and execute them.
 */
export interface CapabilityProvider {
  /** Provider identifier, e.g. "munim". */
  readonly name: string;

  /** Discover the capabilities currently exposed by the provider. */
  discover(): Promise<CapabilityDefinition[]>;

  /** Execute a previously discovered capability. */
  execute(
    capability: CapabilityDefinition,
    args: Record<string, unknown>
  ): Promise<unknown>;
}
