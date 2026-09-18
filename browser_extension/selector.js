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

  /**
   * Compose the final text to write into an injection target.
   *
   *   'replace' -> the new content only (initial prompt)
   *   'append'  -> existing value + blank-line separator + new content (results)
   *
   * Kept pure so the append-vs-replace behavior is unit testable.
   *
   * @param {string} existing
   * @param {string} content
   * @param {'replace'|'append'} mode
   * @returns {string}
   */
  function composeContent(existing, content, mode) {
    const prev = typeof existing === 'string' ? existing : '';
    const next = typeof content === 'string' ? content : '';

    if (mode === 'append') {
      if (!prev) return next;
      if (!next) return prev;
      return prev + '\n\n' + next;
    }
    return next;
  }

  /**
   * Build the auto-click button target from persisted state.
   *
   * @param {{buttonType?:string, buttonValue?:string}} state
   * @returns {{type:'class'|'id', value:string, selector:string|null, valid:boolean}}
   */
  function buildButtonTarget(state) {
    const type = normalizeType(state && state.buttonType);
    const value = normalizeValue(state && state.buttonValue);
    const selector = buildSelector(type, value);
    return {
      type: type,
      value: value,
      selector: selector,
      valid: selector !== null
    };
  }

  /**
   * Whether an auto-click should happen: auto-send on AND a valid button.
   *
   * @param {{autoSend?:boolean, buttonType?:string, buttonValue?:string}} state
   * @returns {boolean}
   */
  function shouldAutoClick(state) {
    if (!state || typeof state !== 'object') return false;
    return Boolean(state.autoSend) && buildButtonTarget(state).valid;
  }

  // ---- Per-page settings keys -------------------------------------------

  // Namespace for per-page settings stored in chrome.storage.local.
  const PAGE_KEY_PREFIX = 'pageSettings:';
  // Index of every origin that has saved settings.
  const PAGE_INDEX_KEY = 'savedPages';

  /**
   * Normalize a URL to a page key (its origin), e.g.
   *   https://www.whatsapp.com/send?x=1  ->  https://www.whatsapp.com
   * Returns null for URLs with no usable http(s) origin (chrome://, file://,
   * about:, etc.), so we never key settings on unusable pages.
   *
   * @param {string} url
   * @returns {string|null}
   */
  function pageKeyFromUrl(url) {
    if (typeof url !== 'string' || !url) return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (!u.hostname) return null;
      return u.protocol + '//' + u.host;
    } catch (e) {
      return null;
    }
  }

  /** Storage key for a page's settings record. */
  function pageSettingsKey(pageKey) {
    return PAGE_KEY_PREFIX + pageKey;
  }

  /** The stored settings fields, with defaults. */
  function emptyPageSettings() {
    return {
      selectorType: 'class',
      selectorValue: '',
      injectType: 'class',
      injectValue: '',
      autoSend: false,
      buttonType: 'class',
      buttonValue: ''
    };
  }

  /**
   * Pick only the per-page settings fields out of a larger object.
   *
   * @param {object} source
   * @returns {object}
   */
  function pickPageSettings(source) {
    const out = emptyPageSettings();
    if (!source || typeof source !== 'object') return out;
    if (source.selectorType === 'id' || source.selectorType === 'class') out.selectorType = source.selectorType;
    if (typeof source.selectorValue === 'string') out.selectorValue = source.selectorValue;
    if (source.injectType === 'id' || source.injectType === 'class') out.injectType = source.injectType;
    if (typeof source.injectValue === 'string') out.injectValue = source.injectValue;
    out.autoSend = Boolean(source.autoSend);
    if (source.buttonType === 'id' || source.buttonType === 'class') out.buttonType = source.buttonType;
    if (typeof source.buttonValue === 'string') out.buttonValue = source.buttonValue;
    return out;
  }

  /**
   * Human-friendly label for a page key, e.g. "https://www.whatsapp.com" ->
   * "www.whatsapp.com".
   *
   * @param {string} pageKey
   * @returns {string}
   */
  function pageLabel(pageKey) {
    if (typeof pageKey !== 'string') return '';
    return pageKey.replace(/^https?:\/\//, '');
  }

  /**
   * Pick the best page tab from a list of chrome tabs. Skips tabs with no
   * usable http(s) origin (e.g. the extension's own options tab). Prefers an
   * active tab, then the most recently accessed.
   *
   * @param {Array<{id?:number,url?:string,active?:boolean,lastAccessed?:number}>} tabs
   * @returns {object|null}
   */
  function pickPageTab(tabs) {
    if (!Array.isArray(tabs)) return null;

    // Accept url or pendingUrl (a tab that is still loading may only expose
    // pendingUrl in some Chrome versions).
    const urlOf = (t) => (t && (t.url || t.pendingUrl)) || null;

    const usable = tabs.filter((t) => pageKeyFromUrl(urlOf(t)) !== null);
    if (usable.length === 0) return null;

    const active = usable.find((t) => t.active);
    if (active) return active;
    usable.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return usable[0];
  }

  const SelectorUtil = {
    SELECTOR_TYPES: SELECTOR_TYPES,
    PAGE_KEY_PREFIX: PAGE_KEY_PREFIX,
    PAGE_INDEX_KEY: PAGE_INDEX_KEY,
    normalizeType: normalizeType,
    normalizeValue: normalizeValue,
    buildSelector: buildSelector,
    buildInjectTarget: buildInjectTarget,
    buildButtonTarget: buildButtonTarget,
    shouldAutoClick: shouldAutoClick,
    composeContent: composeContent,
    buildTextareaTarget: buildTextareaTarget,
    pageKeyFromUrl: pageKeyFromUrl,
    pageSettingsKey: pageSettingsKey,
    emptyPageSettings: emptyPageSettings,
    pickPageSettings: pickPageSettings,
    pageLabel: pageLabel,
    pickPageTab: pickPageTab,
    shouldRun: shouldRun,
    canInject: canInject
  };

  root.SelectorUtil = SelectorUtil;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SelectorUtil;
  }
})(typeof self !== 'undefined' ? self : this);
