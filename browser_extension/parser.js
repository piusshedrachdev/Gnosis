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
  // Kept intentionally small and explicit; the agent can discover the rest
  // from the server via capabilities.list / capabilities.describe.
  const CAPABILITY_SCHEMAS = {
    // Example capability: report a scraped/extracted value to the runtime.
    // The schema mirrors the JSON-Schema style used by the MCP provider.
    'computer.report_extracted_value': {
      type: 'object',
      properties: {
        className: { type: 'string' },
        value: { type: 'string' }
      },
      required: ['className', 'value']
    }
  };

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
   * @param {{className:string, value:string}} extraction
   * @returns {{capability:string, arguments:object}}
   */
  function buildPayload(extraction) {
    return {
      capability: 'computer.report_extracted_value',
      arguments: {
        className: (extraction && extraction.className) || '',
        value: (extraction && extraction.value) || ''
      }
    };
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
