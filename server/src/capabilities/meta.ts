import { CapabilityRegistry } from "./registry";

/**
 * Meta-capabilities belong to the runtime itself, not to a provider.
 *
 * They are handled internally by querying the registry:
 *   - capabilities.list
 *   - capabilities.describe
 */
export const META_CAPABILITIES = {
  list: "capabilities.list",
  describe: "capabilities.describe",
} as const;

/** Lightweight capability descriptor returned by capabilities.list. */
export interface CapabilitySummary {
  name: string;
  description: string;
}

/** Full capability descriptor returned by capabilities.describe. */
export interface CapabilityDetail {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** True when a capability name is a runtime meta-capability. */
export function isMetaCapability(name: string): boolean {
  return name === META_CAPABILITIES.list || name === META_CAPABILITIES.describe;
}

/**
 * Handle `capabilities.list`.
 *
 * Returns only names and descriptions so the model's initial context stays
 * small. Full schemas are retrieved on demand via capabilities.describe.
 */
export function listCapabilities(
  registry: CapabilityRegistry
): { capabilities: CapabilitySummary[] } {
  const capabilities = registry.list().map((capability) => ({
    name: capability.name,
    description: capability.description,
  }));

  return { capabilities };
}

/**
 * Handle `capabilities.describe`.
 *
 * Returns the complete registered definition for one capability, including
 * the provider-supplied input schema.
 */
export function describeCapability(
  registry: CapabilityRegistry,
  name: unknown
): CapabilityDetail {
  if (typeof name !== "string" || name.length === 0) {
    throw new MetaCapabilityError(
      "INVALID_ARGUMENTS",
      "capabilities.describe requires a string \"name\" argument."
    );
  }

  const capability = registry.get(name);

  if (!capability) {
    throw new MetaCapabilityError(
      "CAPABILITY_NOT_FOUND",
      `Unknown capability: ${name}`
    );
  }

  return {
    name: capability.name,
    description: capability.description,
    inputSchema: capability.inputSchema,
  };
}

/** Error type for meta-capability failures. */
export class MetaCapabilityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MetaCapabilityError";
    this.code = code;
  }
}
