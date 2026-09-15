import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  CapabilityDefinition,
  CapabilityProvider,
} from "./provider";

/**
 * Options for connecting the Munim provider to the Munim MCP server.
 */
export interface MunimProviderOptions {
  /** Path to the Munim executable (or any MCP stdio command). */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Extra environment variables for the child process. */
  env?: Record<string, string>;
  /** Application-facing capability prefix. Defaults to "computer". */
  prefix?: string;
}

/** Minimal shape of a tool returned by MCP's listTools(). */
interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * A CapabilityProvider backed by a Munim MCP server over stdio.
 *
 * Responsibilities:
 *   - own the MCP client lifecycle
 *   - translate Munim tools into CapabilityDefinition objects
 *   - execute capabilities by calling back into Munim
 */
export class MunimProvider implements CapabilityProvider {
  readonly name = "munim";

  private readonly client: Client;
  private readonly options: Required<Pick<MunimProviderOptions, "prefix">> &
    MunimProviderOptions;

  private connected = false;

  constructor(options: MunimProviderOptions) {
    this.options = { prefix: "computer", ...options };

    this.client = new Client({
      name: "agent-capability-runtime",
      version: "1.0.0",
    });
  }

  /** Connect to the Munim MCP server. Safe to call once. */
  async connect(): Promise<void> {
    if (this.connected) return;

    const transport = new StdioClientTransport({
      command: this.options.command,
      args: this.options.args ?? [],
      env: this.options.env
        ? { ...process.env, ...this.options.env } as Record<string, string>
        : undefined,
    });

    await this.client.connect(transport);
    this.connected = true;
  }

  /** True once the MCP client has connected successfully. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Close the MCP connection if one is open. */
  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.client.close();
  }

  /** Discover Munim's tools and normalize them into capabilities. */
  async discover(): Promise<CapabilityDefinition[]> {
    if (!this.connected) {
      throw new Error(
        "MunimProvider is not connected. Call connect() before discover()."
      );
    }

    const result = await this.client.listTools();
    const tools = (result?.tools ?? []) as McpTool[];

    return tools.map((tool) => this.normalize(tool));
  }

  /** Execute a capability against Munim. */
  async execute(
    capability: CapabilityDefinition,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.connected) {
      throw new Error(
        "MunimProvider is not connected. Call connect() before execute()."
      );
    }

    if (capability.provider !== this.name) {
      throw new Error(
        `Capability "${capability.name}" does not belong to provider "${this.name}".`
      );
    }

    return this.client.callTool({
      name: capability.providerToolName,
      arguments: args,
    });
  }

  /**
   * Translate a raw Munim tool into an application capability, preserving the
   * provider's input schema exactly as returned.
   */
  private normalize(tool: McpTool): CapabilityDefinition {
    return {
      name: `${this.options.prefix}.${tool.name}`,
      provider: this.name,
      providerToolName: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    };
  }
}
