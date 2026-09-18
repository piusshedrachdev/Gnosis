# Agent Capability Runtime — MVP

## 1. Goal

Build a working end-to-end agent runtime that allows an LLM to operate a computer through **Munim**, without hard-coding Munim's individual tools into the application.

The runtime should:

1. Discover Munim's available MCP tools.
2. Normalize them into application capabilities.
3. Keep the complete tool schemas internally.
4. Give the agent lightweight capability discovery.
5. Allow the agent to request the complete schema for a capability when needed.
6. Execute the capability requested by the agent.
7. Return the actual provider result to the agent.
8. Allow the agent to make another capability call based on that result.

The first objective is simply:

> **Make the complete loop work. Do not over-engineer it.**

---

# 2. Architecture

```text
                    ┌─────────────────────┐
                    │        User         │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │        LLM          │
                    └──────────┬──────────┘
                               │
                 capability + arguments
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Agent Runtime     │
                    │                     │
                    │ Capability Registry │
                    │ Capability Router   │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Munim Provider     │
                    │                     │
                    │ MCP Client          │
                    └──────────┬──────────┘
                               │
                         MCP / stdio
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Munim MCP Server   │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Windows Desktop   │
                    └─────────────────────┘
```

The LLM does **not** communicate with Munim directly.

The LLM communicates with the Agent Runtime.

The Agent Runtime communicates with Munim.

---

# 3. Provider Abstraction

The runtime should not depend directly on Munim.

Create a provider interface.

```ts
interface CapabilityProvider {
  name: string;

  discover(): Promise<CapabilityDefinition[]>;

  execute(
    capability: CapabilityDefinition,
    args: Record<string, unknown>
  ): Promise<unknown>;
}
```

A capability definition:

```ts
interface CapabilityDefinition {
  name: string;

  provider: string;

  providerToolName: string;

  description: string;

  inputSchema: Record<string, unknown>;
}
```

Example:

```ts
{
  name: "computer.click",

  provider: "munim",

  providerToolName: "click",

  description: "Click an element on the screen.",

  inputSchema: {
    // schema supplied by Munim
  }
}
```

The important distinction is:

```text
computer.click
     │
     │ application capability name
     ▼
Munim provider
     │
     │ providerToolName
     ▼
click
     │
     ▼
Munim MCP server
```

The agent should know `computer.click`, not Munim's internal naming conventions.

---

# 4. Munim Provider

The Munim provider is responsible for translating between the application capability system and Munim's MCP interface.

At startup:

```ts
const result = await client.listTools();
```

Munim's returned tools are normalized into `CapabilityDefinition` objects.

Conceptually:

```ts
return result.tools.map(tool => ({
  name: `computer.${tool.name}`,
  provider: "munim",
  providerToolName: tool.name,
  description: tool.description ?? "",
  inputSchema: tool.inputSchema
}));
```

The exact schema returned by the currently installed MCP SDK/Munim version should be preserved rather than manually recreated.

The provider therefore retains:

- capability name
- provider
- original Munim tool name
- description
- complete input schema

---

# 5. Capability Registry

Create an in-memory registry for the MVP.

```ts
class CapabilityRegistry {
  register(capability: CapabilityDefinition): void;

  registerMany(capabilities: CapabilityDefinition[]): void;

  get(name: string): CapabilityDefinition | undefined;

  has(name: string): boolean;

  list(): CapabilityDefinition[];
}
```

At startup:

```text
Munim
  ↓
listTools()
  ↓
Munim Provider
  ↓
normalize
  ↓
Capability Registry
```

The registry is the application's source of truth for the currently discovered capabilities.

No database is required for the MVP.

---

# 6. Two-Level Capability Discovery

This is important.

The model should **not** receive every complete schema in its initial context.

But it also cannot operate with only names and descriptions.

Therefore use two discovery operations.

## `capabilities.list`

Returns lightweight information:

```json
{
  "capabilities": [
    {
      "name": "computer.click",
      "description": "Click an element on the screen."
    },
    {
      "name": "computer.type_text",
      "description": "Type text."
    },
    {
      "name": "computer.get_app_state",
      "description": "Get the current application accessibility state."
    }
  ]
}
```

The model can use this to determine what capability it needs.

---

## `capabilities.describe`

Returns the complete definition of one capability.

The model requests:

```json
{
  "capability": "capabilities.describe",
  "arguments": {
    "name": "computer.click"
  }
}
```

The runtime responds with the capability's full definition:

```json
{
  "name": "computer.click",
  "description": "...",
  "inputSchema": {}
}
```

The actual `inputSchema` comes from Munim.

This means the model can obtain:

- argument names
- argument types
- required arguments
- optional arguments
- descriptions
- nested structures
- enums
- other schema constraints

without loading all of them into the initial context.

---

# 7. Agent Action Format

The LLM communicates with the runtime using one universal structure:

```json
{
  "capability": "computer.click",
  "arguments": {
    "element_id": "42"
  }
}
```

The runtime does not need a different HTTP endpoint for every capability.

There is one generic execution path:

```text
capability
arguments
    ↓
registry lookup
    ↓
provider lookup
    ↓
provider.execute()
    ↓
Munim client.callTool()
```

---

# 8. Meta-Capabilities

The following capabilities belong to the runtime rather than Munim:

```text
capabilities.list
capabilities.describe
```

They should be handled internally.

For example:

```json
{
  "capability": "capabilities.list",
  "arguments": {}
}
```

does not go to Munim.

The runtime handles it by querying the registry.

Likewise:

```json
{
  "capability": "capabilities.describe",
  "arguments": {
    "name": "computer.click"
  }
}
```

is handled by the registry.

---

# 9. Capability Execution

When the model requests:

```json
{
  "capability": "computer.click",
  "arguments": {
    "element_id": "42"
  }
}
```

the runtime should:

### Step 1 — Resolve capability

```ts
const capability = registry.get("computer.click");
```

### Step 2 — Reject unknown capability

If it does not exist:

```json
{
  "error": true,
  "code": "CAPABILITY_NOT_FOUND",
  "message": "Unknown capability: computer.click"
}
```

Do not call Munim.

### Step 3 — Validate arguments

Validate the supplied arguments against:

```ts
capability.inputSchema
```

For the MVP, use a JSON Schema validator rather than manually implementing validation.

### Step 4 — Execute through provider

The Munim provider translates:

```text
computer.click
```

into:

```text
click
```

and executes:

```ts
client.callTool({
  name: capability.providerToolName,
  arguments: args
});
```

---

# 10. Results

Do **not** invent a universal result structure for Munim tools yet.

For the MVP, preserve the provider result.

The current MCP tool execution model returns a `CallToolResult`, which can contain content blocks, optional structured content, and an `isError` indicator. Tool execution errors are represented so the client/LLM can reason about them rather than treating every failure as a transport-level failure. 

Therefore:

```text
Munim result
     ↓
Munim provider
     ↓
Agent runtime
     ↓
LLM
```

The runtime should not assume:

```text
every tool returns text
every tool returns JSON
every tool returns an object
every tool returns something useful
```

Some operations may return information that allows the next operation to be chosen.

For example:

```text
get_app_state
      ↓
accessibility information
      ↓
agent identifies element
      ↓
computer.click
```

If a tool produces no useful result, the agent should be able to decide what to do next.

**Do not implement special screenshot/browser_snapshot result processing in this MVP.**

---

# 11. Agent Loop

The basic agent loop is:

```text
User request
     ↓
LLM
     ↓
Agent action JSON
     ↓
Runtime
     ↓
Capability
     ↓
Provider
     ↓
Munim
     ↓
Desktop
     ↓
Tool result
     ↓
LLM
     ↓
next action
```

For example:

```text
User:
"Open Chrome and inspect the current page."
```

The model might first request:

```json
{
  "capability": "computer.get_app_state",
  "arguments": {}
}
```

The runtime executes it.

The result goes back to the model.

The model then decides whether another capability is required.

The important point is that **the model controls the sequence of actions**.

The runtime only:

- exposes capabilities
- validates requests
- routes requests
- executes requests
- returns results

---

# 12. Model Instructions

The agent's system instructions should establish a simple contract:

```text
You interact with the computer through capabilities.

Each action must be represented as:

{
  "capability": "...",
  "arguments": {}
}

You may use capabilities.list to discover available capabilities.

If you know which capability you need but do not know its arguments,
use capabilities.describe to retrieve its complete schema.

Do not invent capability names.

Do not invent arguments.

Use the returned schema when constructing capability arguments.

After receiving a capability result, decide whether the task is complete
or whether another capability is required.
```

The exact prompt can evolve after the first working implementation.

---

# 13. HTTP Layer

HTTP is an infrastructure layer, not the model's capability interface.

For the MVP, expose a generic API for testing the runtime externally.

### `GET /capabilities`

Returns lightweight capability discovery.

```http
GET /capabilities
```

Response:

```json
{
  "capabilities": [
    {
      "name": "computer.click",
      "description": "..."
    }
  ]
}
```

### `GET /capabilities/:name`

Returns the complete capability definition.

```http
GET /capabilities/computer.click
```

Response:

```json
{
  "name": "computer.click",
  "description": "...",
  "inputSchema": {}
}
```

### `POST /execute`

Generic execution endpoint.

```http
POST /execute
```

Body:

```json
{
  "capability": "computer.click",
  "arguments": {
    "element_id": "42"
  }
}
```

Response:

```json
{
  "result": {}
}
```

The HTTP API is primarily useful for testing and for future external clients.

The internal agent should ideally call the runtime directly rather than making an unnecessary HTTP request to itself.

---

# 14. Existing Munim `/tools` API

The earlier generic Munim gateway can remain during development:

```text
GET  /tools
POST /tools/:name
```

However, this is considered a **provider/debugging interface**, not the agent-facing abstraction.

The intended architecture is:

```text
Agent
  ↓
Capability Runtime
  ↓
Capability Registry
  ↓
Provider
  ↓
Munim
```

not:

```text
Agent
  ↓
/tools/click
  ↓
Munim
```

---

# 15. Discovery Lifecycle

For the MVP:

```text
Application starts
       ↓
Start Munim
       ↓
Connect MCP client
       ↓
client.listTools()
       ↓
Munim provider normalizes tools
       ↓
Register capabilities
       ↓
Runtime ready
```

No database or persistent capability store is required.

If Munim's available tools change, the application can rediscover them by calling the provider's `discover()` method again.

A refresh mechanism can be added later.

---

# 16. Files / Components

Keep the implementation small.

Suggested structure:

```text
src/
│
├── index.ts
│
├── agent/
│   └── runtime.ts
│
├── capabilities/
│   ├── registry.ts
│   └── meta.ts
│
├── providers/
│   ├── provider.ts
│   └── munim.ts
│
└── server/
    └── http.ts
```

### `providers/provider.ts`

Provider interface and capability definition.

### `providers/munim.ts`

MCP connection, discovery, normalization and Munim execution.

### `capabilities/registry.ts`

Stores and resolves capabilities.

### `capabilities/meta.ts`

Implements:

```text
capabilities.list
capabilities.describe
```

### `agent/runtime.ts`

Receives an agent action and routes it.

### `server/http.ts`

Optional HTTP interface for testing.

### `index.ts`

Application startup and dependency wiring.

---

# 17. What We Are NOT Building Yet

Do not implement these for the first MVP:

- database-backed capability registry
- semantic capability search
- embeddings
- automatic capability selection
- automatic tool dependency graphs
- special screenshot processing
- special browser snapshot processing
- result summarization
- result truncation
- autonomous planning framework
- multiple computer providers
- authentication
- permissions system
- complex retry system
- background job system
- separate endpoint for every Munim tool

The first milestone is simply:

> **LLM → capability discovery → schema retrieval → capability execution → Munim → result → LLM**

---

# 18. End-to-End Acceptance Test

The MVP is considered working when the following sequence works.

### Test 1 — Startup

Application starts Munim and successfully connects through MCP.

### Test 2 — Discovery

The provider calls Munim's `listTools()` and registers the returned tools.

### Test 3 — Lightweight discovery

The runtime can return:

```json
{
  "capabilities": [
    {
      "name": "...",
      "description": "..."
    }
  ]
}
```

without returning every full schema.

### Test 4 — Schema retrieval

Given:

```json
{
  "capability": "capabilities.describe",
  "arguments": {
    "name": "computer.click"
  }
}
```

the runtime returns the complete registered definition, including the Munim-provided input schema.

### Test 5 — Generic execution

Given:

```json
{
  "capability": "computer.click",
  "arguments": {}
}
```

the runtime resolves the capability and sends the request to the Munim provider.

### Test 6 — No hard-coded tool routes

Adding another Munim tool should **not require creating another HTTP route or another `if/else` statement**.

It should appear automatically after discovery.

### Test 7 — Unknown capability

An unknown capability produces a runtime error without calling Munim.

### Test 8 — Invalid arguments

Arguments that violate the capability's schema are rejected before execution.

### Test 9 — Real agent loop

A model can:

```text
discover
   ↓
describe
   ↓
execute
   ↓
receive result
   ↓
execute another capability
```

without the application developer manually specifying the sequence.

---

# 19. Final MVP Principle

The system should have a very simple division of responsibility:

```text
LLM
────────────────────────
Decides WHAT to do
Decides WHEN to do it
Chooses capabilities
Provides arguments
Interprets results


Agent Runtime
────────────────────────
Discovers capabilities
Stores schemas
Validates requests
Routes capabilities
Calls providers


Provider
────────────────────────
Translates application capabilities
into provider-specific operations


Munim
────────────────────────
Actually operates the computer
```

The runtime is therefore **not another autonomous agent**.

It is the execution layer that gives an agent a controlled, discoverable interface to real computer capabilities.

The MVP should first prove that this architecture works with Munim end-to-end. Everything beyond that can be added after the basic loop is functioning.