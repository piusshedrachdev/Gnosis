import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import express, { Request, Response } from "express";


/*
 * ============================================================
 * CONFIGURATION
 * ============================================================
 */


const MUNIM_PATH = "C:\\Users\\IKATEL TECHNOLOGY\\projects\\munim-computer-use.exe"

const PORT = 3000;


/*
 * ============================================================
 * MCP CLIENT
 * ============================================================
 */

const munim = new Client({
  name: "munim-http-gateway",
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

  await munim.connect(transport);

  console.log("Connected to Munim.");
}


/*
 * ============================================================
 * DISCOVER TOOLS
 * ============================================================
 *
 * We don't hard-code Munim's tools.
 *
 * Munim tells us what tools it currently exposes.
 */

async function getTools() {
  const result = await munim.listTools();

  return result.tools;
}


/*
 * ============================================================
 * EXPRESS SERVER
 * ============================================================
 */

const app = express();

app.use(express.json());


/*
 * ============================================================
 * HEALTH CHECK
 * ============================================================
 */

app.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "Munim HTTP Gateway",
  });
});


/*
 * ============================================================
 * DISCOVER TOOLS
 * ============================================================
 *
 * GET /tools
 *
 * Returns the tools currently exposed by Munim.
 */

app.get("/tools", async (_req: Request, res: Response) => {
  try {
    const tools = await getTools();

    res.json({
      tools,
    });
  } catch (error) {
    console.error("Failed to get tools:", error);

    res.status(500).json({
      error: "Failed to discover Munim tools",
    });
  }
});


/*
 * ============================================================
 * CALL ANY TOOL
 * ============================================================
 *
 * POST /tools/:name
 *
 * Example:
 *
 * POST /tools/screenshot
 *
 * {
 *   "arguments": {}
 * }
 *
 *
 * Another example:
 *
 * POST /tools/type_text
 *
 * {
 *   "arguments": {
 *     "text": "Hello world"
 *   }
 * }
 *
 * We don't need separate routes for these tools.
 */

app.post(
  "/tools/:name",
  async (req: Request, res: Response) => {
    const toolName = req.params.name;

    try {
      /*
       * Get the current tools from Munim.
       */
      const tools = await getTools();

      /*
       * Check that the requested tool actually exists.
       */
      const tool = tools.find(
        (tool) => tool.name === toolName
      );

      if (!tool) {
        return res.status(404).json({
          error: `Tool "${toolName}" was not found`,
          availableTools: tools.map(
            (tool) => tool.name
          ),
        });
      }


      /*
       * Get arguments from the HTTP request.
       *
       * Expected request:
       *
       * {
       *   "arguments": {
       *      ...
       *   }
       * }
       */

      const toolArguments =
        req.body?.arguments ?? {};
      console.log(req.body)


      /*
       * Call Munim through MCP.
       */

      console.log(
        `Calling Munim tool: ${toolName}`
      );

      console.log(
        "Arguments:",
        toolArguments
      );


      const result = await munim.callTool({
        name: toolName,
        arguments: toolArguments,
      });


      /*
       * Return Munim's result directly
       * to the HTTP client.
       */

      res.json(result);

    } catch (error) {

      console.error(
        `Failed to call tool "${toolName}":`,
        error
      );

      res.status(500).json({
        error: `Failed to execute tool "${toolName}"`,
        details:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);


/*
 * ============================================================
 * START SERVER
 * ============================================================
 */

async function main() {
  try {

    /*
     * First connect to Munim.
     */

    await connectToMunim();


    /*
     * Discover tools once at startup
     * just so we can display them.
     */

    const tools = await getTools();

    console.log("\nMunim tools:");

    for (const tool of tools) {
      console.log(`  - ${tool.name}`);
    }


    /*
     * Start HTTP server.
     */

    app.listen(PORT, () => {

      console.log(
        `\nHTTP server running at http://localhost:${PORT}`
      );

      console.log(
        `Tool discovery: http://localhost:${PORT}/tools`
      );

    });

  } catch (error) {

    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
}


/*
 * ============================================================
 * START APPLICATION
 * ============================================================
 */

main();
