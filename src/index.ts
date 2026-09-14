import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/*
 * ============================================================
 * CONFIGURATION
 * ============================================================
 *
 * CHANGE THIS PATH to wherever you extracted the Munim
 * Windows release.
 *
 * Example:
 *
 * C:\\Users\\Pius\\Downloads\\munim\\munim-computer-use.exe
 *
 */

const MUNIM_PATH = "C:\\Users\\IKATEL TECHNOLOGY\\projects\\munim-computer-use.exe"


/*
 * ============================================================
 * MCP CLIENT
 * ============================================================
 */

const client = new Client({
  name: "my-munim-client",
  version: "1.0.0",
});


/*
 * ============================================================
 * CONNECT TO MUNIM
 * ============================================================
 */

async function connectToMunim() {
  console.log("Starting Munim...");

  const transport = new StdioClientTransport({
    command: MUNIM_PATH,
    args: [],
  });

  await client.connect(transport);

  console.log("Connected to Munim.\n");
}


/*
 * ============================================================
 * LIST AVAILABLE TOOLS
 * ============================================================
 */

async function listTools() {
  const result = await client.listTools();

  console.log("\n================================");
  console.log("AVAILABLE MUNIM TOOLS");
  console.log("================================\n");

  for (const tool of result.tools) {
    console.log(`Tool: ${tool.name}`);

    if (tool.description) {
      console.log(`Description: ${tool.description}`);
    }

    console.log(
      "Input schema:",
      JSON.stringify(tool.inputSchema, null, 2)
    );

    console.log("--------------------------------\n");
  }

  return result.tools;
}


/*
 * ============================================================
 * CALL A MUNIM TOOL
 * ============================================================
 */

async function callTool(
  name: string,
  args: Record<string, unknown>
) {
  console.log(`\nCalling: ${name}`);
  console.log("Arguments:", args);

  const result = await client.callTool({
    name,
    arguments: args,
  });

  console.log("\nResult:");
  console.dir(result, {
    depth: null,
  });

  return result;
}


/*
 * ============================================================
 * INTERACTIVE CLI
 * ============================================================
 */

async function startCLI() {
  const rl = readline.createInterface({
    input,
    output,
  });

  console.log("\n================================");
  console.log("       MUNIM COMPUTER CLIENT");
  console.log("================================");

  console.log(`
Commands:

  tools
      List all Munim tools

  call <tool>
      Call a Munim tool

  quit
      Exit

Examples:

  tools

  call screenshot

  call get_app_state

`);

  while (true) {
    const command = await rl.question("munim> ");

    const trimmed = command.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed === "quit" || trimmed === "exit") {
      break;
    }

    /*
     * ----------------------------------------
     * LIST TOOLS
     * ----------------------------------------
     */

    if (trimmed === "tools") {
      try {
        await listTools();
      } catch (error) {
        console.error("Failed to list tools:", error);
      }

      continue;
    }


    /*
     * ----------------------------------------
     * CALL TOOL
     * ----------------------------------------
     */

    if (trimmed.startsWith("call ")) {
      const toolName = trimmed
        .substring("call ".length)
        .trim();

      try {
        await callTool(toolName, {});
      } catch (error) {
        console.error(
          "Tool call failed:",
          error
        );
      }

      continue;
    }


    /*
     * ----------------------------------------
     * UNKNOWN COMMAND
     * ----------------------------------------
     */

    console.log(
      "Unknown command. Try: tools, call <tool>, quit"
    );
  }

  rl.close();
}


/*
 * ============================================================
 * MAIN
 * ============================================================
 */

async function main() {
  try {
    await connectToMunim();

    await listTools();

    await startCLI();

    await client.close();

    console.log("Munim client closed.");
  } catch (error) {
    console.error("\nFailed to start Munim client.");

    console.error(error);

    process.exit(1);
  }
}


main();