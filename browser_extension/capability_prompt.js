/*
 * capability_prompt.js — Agent-facing capability discovery instructions.
 *
 * This is the extension-side counterpart to
 * "Agent Capability Runtime — MVP Implementation Requirements.md".
 *
 * It produces the system/developer prompt text that is handed to the LLM so
 * the agent knows HOW to:
 *
 *   1. discover which capabilities are available,
 *   2. fetch a capability's full description (its input schema), and
 *   3. execute a capability with valid arguments.
 *
 * The agent never talks to Munim directly. It talks to the Agent Runtime's
 * HTTP interface, which routes to the Munim provider.
 *
 * The prompt text is generated (not hard-coded as a giant string literal) so
 * the endpoint, meta-capability names, and payload contract stay in sync with
 * parser.js.
 */
(function (root) {
  'use strict';

  // ---- Runtime endpoints the agent is allowed to use ---------------------
  const RUNTIME = {
    baseUrl: 'http://localhost:3000',
    routes: {
      listCapabilities: 'GET  /capabilities',
      describeCapability: 'GET  /capabilities/:name',
      execute: 'POST /execute'
    }
  };

  // Meta-capabilities are handled by the runtime itself, not a provider.
  const META = {
    list: 'capabilities.list',
    describe: 'capabilities.describe'
  };

  /**
   * Build the full capability-discovery prompt for the agent.
   *
   * @param {{baseUrl?:string, capabilities?:Array<{name:string,description:string}>}} [opts]
   * @returns {string}
   */
  function buildCapabilityPrompt(opts) {
    opts = opts || {};
    const baseUrl = opts.baseUrl || RUNTIME.baseUrl;
    const known = Array.isArray(opts.capabilities) ? opts.capabilities : [];

    const knownBlock =
      known.length > 0
        ? known
            .map(function (c) {
              return '  - ' + c.name + ' — ' + (c.description || '(no description)');
            })
            .join('\
')
        : '  (none preloaded — call capabilities.list to discover them)';

    return [
      '# Capability Runtime — Agent Instructions',
      '',
      'You operate a computer through the Agent Capability Runtime.',
      'You do NOT call the underlying computer tool (Munim) directly.',
      'You call the runtime, and the runtime routes to the provider.',
      '',
      '## STRICT OUTPUT FORMAT (read first)',
      '',
      'When you want to use a tool/capability, your reply MUST be ONLY one',
      'JSON object in exactly this shape, and nothing else:',
      '',
      '  {',
      '    "capability": "<exact capability name>",',
      '    "arguments": { <fields from that capability inputSchema> }',
      '  }',
      '',
      'Rules:',
      '  1. Output ONE JSON object. No prose, no markdown fences, no comments,',
      '     no explanation before or after it.',
      '  2. "capability" must be a name you discovered. Do not invent names.',
      '  3. "arguments" must be an object whose fields match the inputSchema -',
      '     correct names, correct types, all required fields present.',
      '  4. If a required field is unknown, call discovery/describe FIRST.',
      '  5. To talk to a human (no tool call), write normal text with NO JSON.',
      '',
      'Correct tool-call reply:',
      '  { "capability": "computer.click", "arguments": { "element_id": "e12" } }',
      '',
      'Wrong replies (rejected, NOT executed):',
      '  prose around the JSON object',
      '  a fenced code block',
      '  { "tool": "click" } (wrong shape)',
      '  { "capability": "computer.x" } (invented capability)',
      '',
      '## Golden loop',
      '',
      '  discover  ->  describe  ->  execute  ->  read result  ->  repeat',
      '',
      '## 1. Discover what is available',
      '',
      'Never assume a capability exists. First, ask the runtime what it has:',
      '',
      '  GET  ' + baseUrl + '/capabilities',
      '',
      'Returns: { "capabilities": [ { "name", "description" }, ... ] }',
      'This is lightweight on purpose — it gives you names and descriptions only.',
      '',
      'You may also call the runtime meta-capability directly via /execute:',
      '',
      '  { "capability": "' + META.list + '", "arguments": {} }',
      '',
      '## 2. Get a capability\'s full description (schema)',
      '',
      'Once you have picked a capability name, fetch its complete definition —',
      'including the JSON input schema — before calling it:',
      '',
      '  GET ' + baseUrl + '/capabilities/<name>',
      '',
      'Returns: { "name", "description", "inputSchema" }',
      '',
      'Or via the runtime meta-capability:',
      '',
      '  { "capability": "' + META.describe + '", "arguments": { "name": "<name>" } }',
      '',
      'Always read inputSchema before executing. It tells you the exact fields,',
      'types, and which fields are required.',
      '',
      '## 3. Execute a capability',
      '',
      'Send the capability name and its arguments to the runtime:',
      '',
      '  POST ' + baseUrl + '/execute',
      '  Content-Type: application/json',
      '',
      '  {',
      '    "capability": "<name>",',
      '    "arguments": { ...fields from inputSchema... }',
      '  }',
      '',
      'The server requires "capability" to be a non-empty string.',
      '"arguments" is optional but, when present, must be a plain object.',
      '',
      '## 4. Read the result and continue',
      '',
      'Success: { "ok": true,  "capability": "<name>", "result": <provider result> }',
      'Failure: { "ok": false, "error": true, "code", "message", "details?" }',
      '',
      'On failure, fix your request (unknown capability, invalid arguments)',
      'and try again. Do not invent capabilities that were not discovered.',
      '',
      '## Error codes you will see',
      '',
      '  CAPABILITY_NOT_FOUND  -> re-run discovery; the name is wrong.',
      '  INVALID_REQUEST       -> body shape is wrong (capability/arguments).',
      '  INVALID_ARGUMENTS     -> arguments violate inputSchema; read details.',
      '  PROVIDER_NOT_FOUND    -> server misconfiguration, report it.',
      '',
      '## Preloaded capabilities (may be stale — verify with discovery)',
      '',
      knownBlock,
      ''
    ].join('\
');
  }

  /**
   * Build a compact one-paragraph reminder for tight context budgets.
   */
  function buildCompactPrompt(opts) {
    const baseUrl = (opts && opts.baseUrl) || RUNTIME.baseUrl;
    return (
      'To act, first GET ' + baseUrl + '/capabilities to discover capability names, ' +
      'then GET ' + baseUrl + '/capabilities/<name> for its inputSchema, then ' +
      'POST ' + baseUrl + '/execute with ' +
      '{"capability":"<name>","arguments":{...}}. ' +
      'Never call the computer tool directly; always go through the runtime.'
    );
  }

  const CapabilityPrompt = {
    RUNTIME: RUNTIME,
    META: META,
    buildCapabilityPrompt: buildCapabilityPrompt,
    buildCompactPrompt: buildCompactPrompt
  };

  root.CapabilityPrompt = CapabilityPrompt;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CapabilityPrompt;
  }
})(typeof self !== 'undefined' ? self : this);
