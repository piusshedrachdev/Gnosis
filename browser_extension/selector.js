/*
 * selector.js — Pure selector/session helpers shared by the content script
 * and the test suite.
 *
 * Keeping this logic dependency-free and side-effect-free lets us unit test
 * the Start-gated selector behavior without a browser environment.
 */
(function (root) {
  'use strict';

  const SELECTOR_TYPES = ['class', 'id'];

  function normalizeType(type) {
    return SELECTOR_TYPES.indexOf(type) === -1 ? 'class' : type;
  }

  function normalizeValue(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  /**
   * Build a CSS selector from a type + value.
   * Returns null when the value is empty.
   *
   * @param {'class'|'id'} type
   * @param {string} value
   * @returns {string|null}
   */
  function buildSelector(type, value) {
    const t = normalizeType(type);
    const v = normalizeValue(value);
    if (!v) return null;
    const escaped = cssEscape(v);
    return (t === 'id' ? '#' : '.') + escaped;
  }

  /**
   * Minimal CSS.escape fallback so this module runs outside the browser too.
   * Mirrors the escaping rules closely enough for class/id tokens.
   */
  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
      try {
        return CSS.escape(value);
      } catch (e) {
        // fall through to manual escaping
      }
    }

    // Manual escape: prefix any character that is not alphanumeric, hyphen,
    // or underscore with a backslash.
    return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  /**
   * Decide whether a session should run, given persisted state.
   * The extension is idle unless running is true AND a source value was
   * provided. The injection target is validated separately so a running
   * session without a destination is reported clearly rather than silently
   * extracting and dropping results.
   *
   * @param {{extractorRunning?:boolean, selectorValue?:string}} state
   * @returns {boolean}
   */
  function shouldRun(state) {
    if (!state || typeof state !== 'object') return false;
    return Boolean(state.extractorRunning) && normalizeValue(state.selectorValue).length > 0;
  }

  /**
   * Build the injection (destination) selector config from persisted state.
   *
   * @param {{injectType?:string, injectValue?:string}} state
   * @returns {{type:'class'|'id', value:string, selector:string|null, valid:boolean}}
   */
  function buildInjectTarget(state) {
    const type = normalizeType(state && state.injectType);
    const value = normalizeValue(state && state.injectValue);
    const selector = buildSelector(type, value);
    return {
      type: type,
      value: value,
      selector: selector,
      valid: selector !== null
    };
  }

  /**
   * True only when the session has BOTH a source to extract from and a
   * destination to inject into.
   *
   * @param {{extractorRunning?:boolean, selectorValue?:string, injectValue?:string}} state
   * @returns {boolean}
   */
  function canInject(state) {
    return shouldRun(state) && buildInjectTarget(state).valid;
  }

  /**
   * Build the resolution plan for injecting into a container that holds a
   * textarea. The user supplies the container's class or id; the content
   * script uses `containerSelector` to find it and `textareaSelector` to find
   * the textarea inside it.
   *
   * @param {{injectType?:string, injectValue?:string}} state
   * @returns {{
   *   containerSelector: string|null,
   *   textareaSelector: string|null,
   *   valid: boolean
   * }}
   */
  function buildTextareaTarget(state) {
    const target = buildInjectTarget(state);
    if (!target.valid) {
      return { containerSelector: null, textareaSelector: null, valid: false };
    }
    return {
      containerSelector: target.selector,
      // Scope the textarea lookup to inside the container.
      textareaSelector: target.selector + ' textarea',
      valid: true
    };
  }

  const SelectorUtil = {
    SELECTOR_TYPES: SELECTOR_TYPES,
    normalizeType: normalizeType,
    normalizeValue: normalizeValue,
    buildSelector: buildSelector,
    buildInjectTarget: buildInjectTarget,
    buildTextareaTarget: buildTextareaTarget,
    shouldRun: shouldRun,
    canInject: canInject
  };

  root.SelectorUtil = SelectorUtil;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SelectorUtil;
  }
})(typeof self !== 'undefined' ? self : this);
