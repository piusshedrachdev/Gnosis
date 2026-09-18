import { CapabilityDefinition } from "../providers/provider";

/**
 * In-memory store of discovered capabilities.
 *
 * The registry is the runtime's source of truth for what capabilities exist.
 * No persistence is required for the MVP.
 */
export class CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityDefinition>();

  /** Register a single capability. Overwrites any existing one by name. */
  register(capability: CapabilityDefinition): void {
    if (!capability?.name) {
      throw new Error("Cannot register a capability without a name.");
    }
    this.capabilities.set(capability.name, capability);
  }

  /** Register many capabilities at once. */
  registerMany(capabilities: CapabilityDefinition[]): void {
    for (const capability of capabilities) {
      this.register(capability);
    }
  }

  /** Look up a capability by application name. */
  get(name: string): CapabilityDefinition | undefined {
    return this.capabilities.get(name);
  }

  /** Whether a capability with the given name is registered. */
  has(name: string): boolean {
    return this.capabilities.has(name);
  }

  /** All registered capabilities. */
  list(): CapabilityDefinition[] {
    return Array.from(this.capabilities.values());
  }

  /** Number of registered capabilities. */
  get size(): number {
    return this.capabilities.size;
  }

  /** Remove all capabilities. */
  clear(): void {
    this.capabilities.clear();
  }
}
