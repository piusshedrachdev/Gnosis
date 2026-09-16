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
  const CAPABILITY_SCHEMAS = {
    // Type extracted text into the focused element via Munim's type_text tool.
    'computer.type_text': {
      type: 'object',
      properties: {
        text: { type: 'string' },
        element_id: { type: 'string' }
      },
      required: ['text']
    },
    // Type extracted text into one of the agent's browser tabs.
    'computer.browser_type': {
      type: 'object',
      properties: {
        tab_id: { type: 'integer' },
        text: { type: 'string' }
      },
      required: ['tab_id', 'text']
    }
  };

  // Default capability used when building a payload from a raw extraction.
  const DEFAULT_CAPABILITY = 'computer.type_text';

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

  // ---- Core: build candidate payloads from an extraction -----------------

  /**
   * Turn a raw extraction message into a candidate /execute payload.
   *
   * Uses a capability the runtime actually registers. The extracted text is
   * sent as the `text` argument of `computer.type_text`, which types it into
   * the focused element via Munim.
   *
   * @param {{className?:string, value:string}} extraction
   * @param {string} [capability] Override the default capability name.
   * @returns {{capability:string, arguments:object}}
   */
  function buildPayload(extraction, capability) {
    const cap = typeof capability === 'string' && capability
      ? capability
      : DEFAULT_CAPABILITY;

    const value = (extraction && extraction.value) || '';

    // Map the extraction onto the chosen capability's real argument schema.
    if (cap === 'computer.browser_type') {
      return {
        capability: cap,
        arguments: {
          tab_id: extraction && Number.isInteger(extraction.tabId) ? extraction.tabId : 0,
          text: value
        }
      };
    }

    // Default: computer.type_text -> { text, element_id? }
    const args = { text: value };
    if (extraction && extraction.elementId) {
      args.element_id = extraction.elementId;
    }
    return { capability: cap, arguments: args };
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

    return validatePayload(buildPayload(extraction));
  }

  // ---- Export ------------------------------------------------------------

  const Parser = {
    EXECUTE_CONTRACT,
    CAPABILITY_SCHEMAS,
    DEFAULT_CAPABILITY,
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
