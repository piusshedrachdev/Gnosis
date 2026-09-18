# Gnosis - Agent Capability Runtime + Browser Extension

Let an LLM operate a computer through **Munim** without hard-coding its tools, and drive that runtime from a browser page via a Chrome extension.

This repo has two parts:

- **`server/`** - the **Agent Capability Runtime**: discovers Munim's MCP tools, normalizes them into capabilities, validates requests, and exposes an HTTP interface.
- **`browser_extension/`** - a Manifest V3 Chrome extension that extracts text from a page, checks it matches the runtime's tool-call format, executes it through the runtime, injects the result back into the page, and (optionally) clicks a send button - all configurable per web page.

---

## Architecture

    User
      |
      v
    LLM  --->  Agent Runtime  --->  Munim Provider  --->  Windows Desktop
               (registry,          (MCP client,
                router)             stdio)

The LLM never talks to Munim directly. It talks to the runtime over HTTP; the runtime routes to the provider.

---

## Repository layout

    gnosis/
      README.md                  this file
      server/                    Agent Capability Runtime (TypeScript/Node)
        src/
          index.ts               startup: config -> connect Munim -> discover -> HTTP
          config.ts              env config (MUNIM_PATH, PORT, CAPABILITY_PREFIX)
          agent/runtime.ts       routes actions, validates, dispatches to providers
          capabilities/          registry, meta-capabilities, JSON-schema validation
          providers/             provider interface + Munim MCP provider
          server/http.ts         Express HTTP interface
        tests/                   Vitest suite
        .env.example             example environment variables
        package.json
      browser_extension/         Manifest V3 Chrome extension
        manifest.json
        options.html / .js       settings UI (per-page config, Start/Stop)
        background.js            service worker: gate -> /execute -> inject -> auto-click
        content.js               extract from a source element; inject into a textarea
        parser.js                parses extracted text as a capability call (the gate)
        selector.js              pure helpers (selectors, per-page keys, tab picking)
        capability_prompt.js     the agent-facing capability-discovery prompt

---

## Prerequisites

- Node.js 20+ (developed on Node 24)
- A Munim executable (or any MCP stdio command) that exposes the computer-use tools
- Google Chrome (or Chromium) to load the extension

---

## Server: setup and run

    cd server
    npm install
    cp .env.example .env      # then edit .env
    npm run dev               # tsx src/index.ts (hot reload)

### Environment variables

| Variable          | Required | Default  | Description                                       |
| ----------------- | -------- | -------- | ------------------------------------------------- |
| MUNIM_PATH        | yes      | -        | Path to the Munim executable (MCP stdio command). |
| PORT              | no       | 3000     | HTTP port for the runtime interface.              |
| CAPABILITY_PREFIX | no       | computer | Prefix applied to provider tool names.            |

### Scripts

| Script             | Description                                   |
| ------------------ | --------------------------------------------- |
| npm run dev        | Run the server in development (tsx).          |
| npm run build      | Compile TypeScript to dist/.                  |
| npm start          | Run the compiled server (node dist/index.js). |
| npm test           | Run the Vitest suite once.                    |
| npm run test:watch | Run Vitest in watch mode.                     |
| npm run typecheck  | Type-check without emitting.                  |

On startup the server loads config from `.env`, connects to the Munim MCP server over stdio, discovers tools and registers them as capabilities (`<prefix>.<tool>`), then starts the HTTP interface on `PORT`.

---

## HTTP API

Base URL: `http://localhost:<PORT>` (default `http://localhost:3000`).

### `GET /`

Health check.

    { "status": "ok", "service": "Agent Capability Runtime", "capabilities": <number> }

### `GET /capabilities`

Lightweight discovery - names and descriptions only.

    { "capabilities": [ { "name": "computer.click", "description": "..." }, ... ] }

### `GET /capabilities/:name`

Full definition for one capability, including its JSON input schema.

    { "name": "computer.click", "description": "...", "inputSchema": { ... } }

Returns `404` with `{ "error": true, "code": "CAPABILITY_NOT_FOUND", ... }` for unknown names.

### `POST /execute`

Execute a capability. Request body:

    {
      "capability": "computer.type_text",
      "arguments": { "text": "hello" }
    }

- `capability` (string, required) - a capability name from discovery.
- `arguments` (object, optional) - fields from that capability's `inputSchema`.

Success response (`200`):

    { "ok": true, "capability": "computer.type_text", "result": <provider result> }

Failure response:

    { "ok": false, "error": true, "code": "<CODE>", "message": "...", "details": <optional> }

### Error codes

| Code                  | HTTP | Meaning                                        |
| --------------------- | ---- | ---------------------------------------------- |
| INVALID_REQUEST       | 400  | Body shape is wrong (missing `capability`).    |
| INVALID_ARGUMENTS     | 400  | `arguments` violate the capability's schema.   |
| CAPABILITY_NOT_FOUND  | 404  | Unknown capability name.                       |
| PROVIDER_NOT_FOUND    | 404  | No provider registered for the capability.     |
| EXECUTION_ERROR       | 500  | Provider threw during execution.               |

### Meta-capabilities

The runtime owns two capabilities that need no provider:

- `capabilities.list` - same payload as `GET /capabilities`.
- `capabilities.describe` - args `{ "name": "<capability>" }`.

Call them through `POST /execute` like any other capability.

### Quick test

    curl -s http://localhost:3000/capabilities
    curl -s -X POST http://localhost:3000/execute \
      -H "Content-Type: application/json" \
      -d '{"capability":"capabilities.list","arguments":{}}'

---

## Browser extension

### Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `browser_extension/` folder.

### What it does

The extension turns a web page into an agent loop:

1. **Extract** - watches a source element (by class or id) and captures its text once the DOM settles (streaming-safe debounce).
2. **Gate** - `parser.js` decides whether the extracted text is a valid tool call, i.e. a JSON object of the form `{ "capability": "...", "arguments": { ... } }`. Free-form text is ignored and never executed.
3. **Execute** - a valid tool call is POSTed to the runtime (`/execute`).
4. **Inject** - the runtime's response is written into a destination textarea (the container is found by class/id, then the textarea inside it).
5. **Auto-send (optional)** - when enabled, the extension clicks a configured button after a successful extract + inject.

### Settings (options page)

Open the extension's options (click the toolbar icon, or `chrome://extensions` -> Details -> Extension options).

1. **Extract from (source)** - class or id of the element to read.
2. **Inject into (destination)** - class or id of the *container* holding a textarea; the extension writes into the textarea inside it.
3. **Auto-send (optional)** - toggle auto, and set the class or id of the button to click.

Click **Start** to arm the session, **Stop** to end it.

### Per-page settings

Settings are saved **per web page origin** (e.g. `https://chat.deepseek.com`). The options page shows the current page's origin and loads that page's saved settings. The **Saved pages** dropdown lists every origin with saved settings, so you can switch between sites.

- Non-`http(s)` pages (`chrome://`, `file://`, `about:`) are not eligible and cannot be saved.
- Reloading a page keeps its settings; another site uses its own.

### The tool-call contract

The agent must reply with **only** a JSON object in this shape when calling a tool:

    { "capability": "<name>", "arguments": { ... } }

Rules enforced by the extension's gate:

- `capability` must be a non-empty string under the `computer.` prefix or a `capabilities.*` meta-capability.
- `arguments` must be an object (when present).
- Anything that is not such a JSON object (normal chat, prose) is ignored.

The full, current list of valid capability names and their argument schemas comes from the server - discover it via `GET /capabilities` and `GET /capabilities/:name`.

---

## Testing

The server test suite covers the runtime, HTTP interface, capability registry, meta-capabilities, JSON-schema validation, and the extension's pure modules (`parser.js`, `selector.js`, `capability_prompt.js`).

    cd server
    npm test              # run once
    npm run test:watch    # watch mode

---

## How the pieces fit

- **Provider abstraction** (`server/src/providers/provider.ts`) - the runtime depends on an interface, not on Munim. `MunimProvider` implements it over MCP stdio and normalizes each tool to `<prefix>.<tool>`.
- **Capability registry** - discovered capabilities are stored with their full input schemas.
- **Runtime** (`server/src/agent/runtime.ts`) - resolves capabilities, handles meta-capabilities internally, validates arguments against the schema (Ajv), then dispatches to the owning provider.
- **Validation** (`server/src/capabilities/validation.ts`) - enforces the provider-supplied JSON schema before execution.
- **Extension gate** (`browser_extension/parser.js`) - the client-side mirror: it only forwards text that is a well-formed capability call; the server remains the authority on names and arguments.

---

## Notes

- The runtime is the execution layer, not an autonomous agent. The model decides *what* to do; the runtime decides *whether it is allowed* and *how to route it*.
- The extension keeps only a subset of capability schemas locally. It accepts any well-formed `computer.*` name and lets the server reject unknown ones - so valid tool calls for tools the extension does not know about still reach the server.
- See `server/Agent Capability Runtime — MVP Implementation Requirements.md` for the full design goals.
