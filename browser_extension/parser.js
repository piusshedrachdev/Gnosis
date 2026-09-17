/*
 * parser.js — Extraction → Capability payload parser & validator.
 *
 * Responsibility:
 *   The content script extracts raw text from a target CSS class. The server
 *   exposes a POST /execute endpoint that expects a specific shape:
 *
 *     { "capability": "<string>", "arguments": { ... } }
 *
 *   This module turns the raw extraction into candidate capability payloads,
 *   then validates them against the server's requirements. If the extracted
 *   data matches what the API needs, the payload is marked `ok: true` and can
 *   be forwarded. Otherwise it returns `ok: false` with a precise report of
 *   what is missing or mismatched.
 *
 * The module is dependency-free and works in both the service worker and the
 * content script (it attaches itself to a global namespace).
 */
(function (root) {
  'use strict';

  // ---- Constants ---------------------------------------------------------

  // The server's /execute contract, kept in one place so it is easy to audit.
  const EXECUTE_CONTRACT = {
    endpoint: '/execute',
    method: 'POST',
    // Top-level body fields required by server/src/server/http.ts
    requiredBodyFields: {
      capability: 'string'
    },
    // Optional body field: must be a plain object when present.
    optionalBodyFields: {
      arguments: 'object'
    }
  };

  // Capability names this extension knows how to produce payloads for.
  //
  // IMPORTANT: these MUST correspond to capabilities the Agent Runtime
  // actually registers. The runtime derives its capability names from the
  // Munim MCP tools as `<prefix>.<tool_name>` (e.g. "computer.type_text",
  // "computer.click", "computer.browser_type"). There is no
  // "report_extracted_value" tool, so sending that name yields
  // CAPABILITY_NOT_FOUND.
  //
  // The extractor's job is to hand extracted text to a real computer-use
  // capability, so we default to `computer.type_text`, whose schema requires
  // a `text` field.
  // Schemas for the capabilities this extension can recognise inside an
  // extracted agent reply. The runtime derives its names from the Munim MCP
  // tools as `<prefix>.<tool_name>`. These mirror the real tool schemas so a
  // reply can be validated locally before it is forwarded.
  const CAPABILITY_SCHEMAS = {
    'computer.type_text': {
      type: 'object',
      properties: {
        text: { type: 'string' },
        element_id: { type: 'string' }
      },
      required: ['text']
    },
    'computer.browser_type': {
      type: 'object',
      properties: {
        tab_id: { type: 'integer' },
        text: { type: 'string' }
      },
      required: ['tab_id', 'text']
    },
    'computer.click': {
      type: 'object',
      properties: {
        element_id: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        click_count: { type: 'integer' }
      },
      required: []
    },
    'computer.press_key': {
      type: 'object',
      properties: {
        key: { type: 'string' },
        modifiers: { type: 'array' }
      },
      required: ['key']
    },
    'computer.scroll': {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        direction: { type: 'string' }
      },
      required: []
    },
    'computer.browser_snapshot': {
      type: 'object',
      properties: {
        tab_id: { type: 'integer' }
      },
      required: ['tab_id']
    },
    'computer.browser_navigate': {
      type: 'object',
      properties: {
        tab_id: { type: 'integer' },
        url: { type: 'string' }
      },
      required: ['tab_id', 'url']
    },
    'computer.browser_click': {
      type: 'object',
      properties: {
        tab_id: { type: 'integer' },
        element_index: { type: 'integer' }
      },
      required: ['tab_id']
    },
    // Runtime meta-capabilities (handled by the runtime itself).
    'capabilities.list': {
      type: 'object',
      properties: {},
      required: []
    },
    'capabilities.describe': {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  };

  // Prefix that every provider capability must start with.
  const CAPABILITY_PREFIX = 'computer.';

  // Meta-capabilities are owned by the runtime, not a provider.
  const META_CAPABILITIES = ['capabilities.list', 'capabilities.describe'];

  // ---- Small helpers -----------------------------------------------------

  function isPlainObject(value) {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  /**
   * Validate a value against a minimal subset of JSON Schema.
   * Returns an array of human-readable problems (empty === valid).
   */
  function validateAgainstSchema(schema, value, path) {
    const problems = [];
    path = path || 'arguments';

    if (!schema || typeof schema !== 'object') return problems;

    if (schema.type === 'object') {
      if (!isPlainObject(value)) {
        problems.push(path + ' must be an object.');
        return problems;
      }

      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const key of required) {
        if (!(key in value)) {
          problems.push(path + '.' + key + ' is required but missing.');
        }
      }

      const props = schema.properties || {};
      for (const key of Object.keys(value)) {
        if (!(key in props)) continue; // extra keys tolerated (Ajv strict:false)
        const sub = props[key];
        const subPath = path + '.' + key;
        const val = value[key];

        if (sub.type === 'string' && typeof val !== 'string') {
          problems.push(subPath + ' must be a string.');
        } else if (sub.type === 'integer' && !Number.isInteger(val)) {
          problems.push(subPath + ' must be an integer.');
        } else if (sub.type === 'number' && typeof val !== 'number') {
          problems.push(subPath + ' must be a number.');
        } else if (sub.type === 'object') {
          problems.push(...validateAgainstSchema(sub, val, subPath));
        }
      }
    }

    return problems;
  }

  // ---- Core: parse an extracted agent reply as a capability call ----------

  /**
   * Extract the first balanced JSON object from a string.
   *
   * The agent may wrap its reply in prose or markdown fences; we look for the
   * first '{' and scan for the matching '}' (respecting strings/escapes) so we
   * can tolerate surrounding text.
   *
   * @param {string} text
   * @returns {string|null}
   */
  function extractJsonObject(text) {
    if (typeof text !== 'string') return null;

    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  /**
   * Try to interpret extracted text as a capability call.
   *
   * Accepts either:
   *   - a bare capability call: { "capability": "...", "arguments": {...} }
   *   - an /execute wrapper:    { "tool": {...} }  (tolerated, unwrapped)
   *
   * Returns the parsed object or null when the text is not a capability call.
   * This is the GATE: free-form text (normal chat, prose) returns null and must
   * NOT be executed or injected.
   *
   * @param {string} text
   * @returns {{capability:string, arguments:object}|null}
   */
  function tryParseCapabilityCall(text) {
    const jsonText = extractJsonObject(text);
    if (!jsonText) return null;

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return null;
    }

    if (!isPlainObject(parsed)) return null;

    // Tolerate an {"tool": {...}} wrapper.
    if (isPlainObject(parsed.tool)) {
      parsed = parsed.tool;
    }

    if (!isNonEmptyString(parsed.capability)) return null;

    const args = parsed.arguments;
    if (args !== undefined && !isPlainObject(args)) return null;

    return {
      capability: parsed.capability,
      arguments: args || {}
    };
  }

  /**
   * True when a capability name is one this extension can vouch for: it must
   * be a runtime meta-capability or a capability we hold a schema for. We do
   * NOT accept arbitrary `computer.*` names, because an invented name would be
   * rejected by the runtime with CAPABILITY_NOT_FOUND — the gate must catch it
   * here so nothing invalid is executed or injected.
   *
   * @param {string} name
   * @returns {boolean}
   */
  function isKnownCapabilityName(name) {
    if (!isNonEmptyString(name)) return false;
    if (META_CAPABILITIES.indexOf(name) !== -1) return true;
    return Object.prototype.hasOwnProperty.call(CAPABILITY_SCHEMAS, name);
  }

  /**
   * Turn a raw extraction message into a candidate /execute payload, but ONLY
   * when the extracted text is a well-formed capability call.
   *
   * @param {{className?:string, value:string}} extraction
   * @returns {{ok:boolean, call:object|null, reason:string}}
   */
  function buildPayload(extraction) {
    const value = (extraction && extraction.value) || '';

    const call = tryParseCapabilityCall(value);
    if (!call) {
      return {
        ok: false,
        call: null,
        reason: 'Extracted text is not a capability call (no valid { capability, arguments } JSON found).'
      };
    }

    if (!isKnownCapabilityName(call.capability)) {
      return {
        ok: false,
        call: null,
        reason: 'Unknown capability name: "' + call.capability + '".'
      };
    }

    return { ok: true, call, reason: 'Capability call recognised.' };
  }

  // ---- Core: validate a payload against the API contract -----------------

  /**
   * Validate a candidate payload against BOTH:
   *   1. the /execute HTTP body contract, and
   *   2. the capability's argument schema (when known).
   *
   * @returns {{
   *   ok: boolean,
   *   payload: object,
   *   errors: string[],
   *   warnings: string[],
   *   report: string
   * }}
   */
  function validatePayload(payload) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(payload)) {
      return {
        ok: false,
        payload,
        errors: ['Payload must be a plain object.'],
        warnings,
        report: 'INVALID: payload is not an object.'
      };
    }

    // 1. HTTP contract checks
    if (!('capability' in payload)) {
      errors.push('Missing required body field "capability".');
    } else if (!isNonEmptyString(payload.capability)) {
      errors.push('"capability" must be a non-empty string.');
    }

    if ('arguments' in payload && !isPlainObject(payload.arguments)) {
      errors.push('"arguments" must be a plain object when provided.');
    }

    // 2. Capability schema checks (when the capability is known locally)
    if (errors.length === 0) {
      const schema = CAPABILITY_SCHEMAS[payload.capability];
      if (schema) {
        const argProblems = validateAgainstSchema(
          schema,
          payload.arguments || {},
          'arguments'
        );
        errors.push(...argProblems);
      } else {
        warnings.push(
          'No local schema for capability "' +
            payload.capability +
            '"; server-side validation will still apply.'
        );
      }
    }

    const ok = errors.length === 0;
    return {
      ok,
      payload,
      errors,
      warnings,
      report: ok
        ? 'OK: payload matches the /execute contract.'
        : 'MISMATCH: ' + errors.join(' ')
    };
  }

  // ---- Public: extract -> parse -> validate ------------------------------

  /**
   * Full pipeline used by the extension:
   *   raw extraction  ->  payload  ->  validation result
   *
   * @param {{className:string, value:string}} extraction
   */
  function parseExtraction(extraction) {
    if (!extraction || typeof extraction !== 'object') {
      return {
        ok: false,
        payload: null,
        errors: ['No extraction provided.'],
        warnings: [],
        report: 'MISMATCH: extraction is missing.'
      };
    }

    if (!isNonEmptyString(extraction.className)) {
      return {
        ok: false,
        payload: null,
        errors: ['Extraction is missing a non-empty "className".'],
        warnings: [],
        report: 'MISMATCH: className is missing or empty.'
      };
    }

    if (!isNonEmptyString(extraction.value)) {
      return {
        ok: false,
        payload: null,
        errors: ['Extraction is missing a non-empty "value".'],
        warnings: [],
        report: 'MISMATCH: extracted value is missing or empty.'
      };
    }

    // GATE: only proceed when the extracted text is a capability call.
    const built = buildPayload(extraction);
    if (!built.ok) {
      return {
        ok: false,
        payload: null,
        errors: [built.reason],
        warnings: [],
        report: 'NOT_A_TOOL_CALL: ' + built.reason
      };
    }

    return validatePayload(built.call);
  }

  // ---- Export ------------------------------------------------------------

  const Parser = {
    EXECUTE_CONTRACT,
    CAPABILITY_SCHEMAS,
    CAPABILITY_PREFIX,
    META_CAPABILITIES,
    tryParseCapabilityCall,
    extractJsonObject,
    isKnownCapabilityName,
    buildPayload,
    validatePayload,
    parseExtraction
  };

  // Attach for both content script and service worker contexts.
  root.ExtractorParser = Parser;

  // Also expose for module-based bundlers / tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Parser;
  }
})(typeof self !== 'undefined' ? self : this);
