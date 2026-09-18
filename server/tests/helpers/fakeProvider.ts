import {
  CapabilityDefinition,
  CapabilityProvider,
} from "../../src/providers/provider";

/**
 * A configurable in-memory provider used to test the runtime without Munim.
 */
export class FakeProvider implements CapabilityProvider {
  readonly name: string;

  /** Capabilities returned by discover(). */
  capabilities: CapabilityDefinition[];

  /** Records every execute() call. */
  readonly calls: Array<{ capability: string; args: Record<string, unknown> }> = [];

  /** Result returned by execute(). */
  result: unknown = { ok: true };

  /** When set, execute() throws this error. */
  error: Error | null = null;

  constructor(
    name = "fake",
    capabilities: CapabilityDefinition[] = []
  ) {
    this.name = name;
    this.capabilities = capabilities;
  }

  async discover(): Promise<CapabilityDefinition[]> {
    return this.capabilities;
  }

  async execute(
    capability: CapabilityDefinition,
    args: Record<string, unknown>
  ): Promise<unknown> {
    this.calls.push({ capability: capability.name, args });

    if (this.error) {
      throw this.error;
    }

    return this.result;
  }
}

/** Build a simple capability definition for tests. */
export function makeCapability(
  overrides: Partial<CapabilityDefinition> = {}
): CapabilityDefinition {
  return {
    name: "computer.click",
    provider: "fake",
    providerToolName: "click",
    description: "Click an element.",
    inputSchema: {
      type: "object",
      properties: {
        element_id: { type: "string" },
      },
      required: ["element_id"],
    },
    ...overrides,
  };
}
