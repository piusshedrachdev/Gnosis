/*
 * content.js — Start-gated element extractor.
 *
 * Behaviour:
 *   - The extension does NOTHING until the user opens the options page, enters a
 *     target class or id, and clicks Start.
 *   - Start sends an EXTRACTOR_START message with { selectorType, selectorValue }.
 *   - Only then does the observer arm and extraction begin.
 *   - Stop (EXTRACTOR_STOP) tears the observer down and returns to idle.
 *
 * Extraction supports either a CSS class (".foo") or an element id ("#foo").
 * The extracted text is handed to parser.js, which decides whether it matches
 * the server's /execute contract before it is forwarded.
 */
(function () {
  'use strict';

  // ---- State ----
  let running = false;
  let debounceTimer = null;
  let confirmTimer = null;
  let pendingElement = null;
  let pendingValue = '';
  let armed = false;

  const DEBOUNCE_DELAY = 1500; // ms of quiet before extracting
  const CONFIRM_DELAY = 700;   // extra wait to confirm a stream has stopped
  const PAGE_LOAD_GRACE_MS = 3000;

  const pageLoadedAt = Date.now();
  const lastReported = new WeakMap();

  // ---- Selector helpers ----
  function currentTarget() {
    return {
      type: window.__extractorSelectorType || 'class',
      value: window.__extractorSelectorValue || ''
    };
  }

  function currentInjectTarget() {
    return {
      type: window.__extractorInjectType || 'class',
      value: window.__extractorInjectValue || ''
    };
  }

  /** Build a safe CSS selector from the configured type + value. */
  function buildSelector(type, value) {
    if (window.SelectorUtil && typeof window.SelectorUtil.buildSelector === 'function') {
      return window.SelectorUtil.buildSelector(type, value);
    }
    // Fallback when selector.js has not loaded yet.
    if (!value) return null;
    try {
      return (type === 'id' ? '#' : '.') + CSS.escape(value);
    } catch (e) {
      return null;
    }
  }

  function queryTargets() {
    const { type, value } = currentTarget();
    const selector = buildSelector(type, value);
    if (!selector) return null;
    try {
      return document.querySelectorAll(selector);
    } catch (e) {
      console.warn('[Class Extractor] Invalid selector:', selector);
      return null;
    }
  }

  // ---- Does a node match the target (self or descendant)? ----
  function nodeMatchesTarget(node, selector) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE || !selector) return false;
    try {
      if (node.matches && node.matches(selector)) return true;
      if (node.querySelector && node.querySelector(selector)) return true;
    } catch (e) {
      // CSS.escape may throw on invalid selectors; fail safe
    }
    return false;
  }

  // ---- Is a node inside (or is) a target element? ----
  function isInsideTarget(node, selector) {
    if (!selector) return false;
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      try {
        if (el.matches && el.matches(selector)) return true;
      } catch (e) {
        return false;
      }
      el = el.parentElement;
    }
    return false;
  }

  // ---- Extraction ----
  function extractValue() {
    if (!running) return;

    const elements = queryTargets();
    if (!elements || elements.length === 0) {
      console.log('[Class Extractor] No matching element yet for the configured target.');
      return;
    }

    const lastElement = elements[elements.length - 1];
    const value = (lastElement.innerText || '').trim();
    if (!value) return;

    if (lastReported.get(lastElement) === value) return;
    lastReported.set(lastElement, value);

    console.log(`[Class Extractor] Extracted (${value.length} chars):`, value);

    const { type, value: selValue } = currentTarget();
    chrome.runtime.sendMessage({
      type: 'CLASS_VALUE_EXTRACTED',
      className: selValue,        // kept for backward compatibility
      selectorType: type,
      selectorValue: selValue,
      value: value
    });
  }

  // Streaming-safe debounce: after quiet, wait a bit more and confirm.
  function debouncedExtract() {
    if (!running) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!running) return;

      if (Date.now() - pageLoadedAt < PAGE_LOAD_GRACE_MS) {
        return;
      }

      if (!armed) {
        armed = true;
        return;
      }

      const elements = queryTargets();
      if (!elements || elements.length === 0) return;

      const el = elements[elements.length - 1];
      const currentValue = (el.innerText || '').trim();
      if (!currentValue) return;

      if (pendingElement === el && pendingValue === currentValue) {
        clearTimeout(confirmTimer);
        extractValue();
        return;
      }

      pendingElement = el;
      pendingValue = currentValue;

      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        if (!running) return;
        const finalValue = (el.innerText || '').trim();
        if (finalValue === pendingValue) {
          extractValue();
        }
      }, CONFIRM_DELAY);
    }, DEBOUNCE_DELAY);
  }

  // ---- Observer ----
  function stopObserver() {
    if (window.__extractorObserver) {
      window.__extractorObserver.disconnect();
      window.__extractorObserver = null;
    }
    clearTimeout(debounceTimer);
    clearTimeout(confirmTimer);
  }

  function startObserver() {
    if (!running) return;

    const { type, value } = currentTarget();
    if (!value) return;

    stopObserver();

    // Reset per-session extraction state.
    armed = false;
    pendingElement = null;
    pendingValue = '';

    const selector = buildSelector(type, value);

    window.__extractorObserver = new MutationObserver((mutations) => {
      if (!running) return;

      let relevant = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (nodeMatchesTarget(node, selector)) { relevant = true; break; }
          }
          if (!relevant && isInsideTarget(mutation.target, selector)) {
            relevant = true;
          }
        } else if (mutation.type === 'characterData') {
          if (isInsideTarget(mutation.target, selector)) relevant = true;
        }

        if (relevant) break;
      }

      if (relevant) debouncedExtract();
    });

    window.__extractorObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log(`[Class Extractor] Observer started for ${type === 'id' ? '#' : '.'}${value}`);

    // Mark armed immediately for this explicit Start so the first quiet period
    // is allowed to extract. Without this, the very first debounce only arms
    // the extractor and returns, so a page whose content is already present
    // (and which then stays still) would never log or update the popup.
    armed = true;

    // Immediate initial extraction in case content is already on the page.
    // Run it right away so clicking Start produces a console log and a popup
    // update even when the DOM never mutates again.
    extractValue();

    // Also schedule a debounced extraction to catch content that renders a
    // moment after Start (e.g. late async renders).
    debouncedExtract();
  }

  // ---- Injection (destination) ----
  /**
   * Set the value of a textarea (or input) the way a user would, so that
   * frameworks such as React/Vue notice the change. Uses the native value
   * setter and dispatches an `input` event.
   */
  function setNativeValue(el, content) {
    const proto =
      el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement && window.HTMLInputElement.prototype;

    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');

    if (descriptor && descriptor.set) {
      descriptor.set.call(el, content);
    } else {
      el.value = content;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Find the textarea to write into.
   *
   * The user supplies the class/id of a CONTAINER. We look for a textarea
   * inside that container. If the container itself is a textarea, we use it
   * directly. Falls back to the container's first input[type=text] if no
   * textarea exists.
   */
  function findInjectElement(containerSelector) {
    let container = null;
    try {
      container = document.querySelector(containerSelector);
    } catch (e) {
      return { el: null, reason: 'invalid-selector' };
    }

    if (!container) {
      return { el: null, reason: 'container-missing' };
    }

    // Container is itself a textarea.
    if (container.tagName === 'TEXTAREA') {
      return { el: container, reason: 'ok-container-is-textarea' };
    }

    // Prefer a textarea inside the container.
    let textarea = null;
    try {
      textarea = container.querySelector('textarea');
    } catch (e) {
      textarea = null;
    }
    if (textarea) {
      return { el: textarea, reason: 'ok-textarea-inside' };
    }

    // Fall back to a single-line text input inside the container.
    let input = null;
    try {
      input = container.querySelector('input[type="text"]');
    } catch (e) {
      input = null;
    }
    if (input) {
      return { el: input, reason: 'ok-input-inside' };
    }

    return { el: null, reason: 'no-textarea-inside' };
  }

  /**
   * Write text into the textarea inside the configured destination container.
   *
   * Retries with backoff because the container (or its textarea) may render
   * slightly after Start is clicked, or after the page mutates. Resolves to
   * true when an element was found and updated.
   *
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  window.__extractorInject = function (text) {
    const { type, value } = currentInjectTarget();
    const containerSelector = buildSelector(type, value);
    if (!containerSelector) {
      console.warn('[Class Extractor] No inject target configured.');
      return Promise.resolve(false);
    }

    const content = typeof text === 'string' ? text : JSON.stringify(text, null, 2);

    // Retry schedule (ms): try immediately, then a few times as the page settles.
    const delays = [0, 150, 400, 900, 1800];

    return new Promise((resolve) => {
      let attempt = 0;

      function tryInject() {
        const { el, reason } = findInjectElement(containerSelector);

        if (el) {
          try {
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
              el.focus();
              setNativeValue(el, content);
            } else {
              el.textContent = content;
            }
            console.log(
              `[Class Extractor] Injected ${content.length} chars into ${containerSelector} (${reason})`
            );
            resolve(true);
            return;
          } catch (e) {
            console.warn('[Class Extractor] Injection failed:', e);
            resolve(false);
            return;
          }
        }

        attempt += 1;
        if (attempt >= delays.length) {
          console.warn(
            `[Class Extractor] Injection target not resolved for ${containerSelector} (${reason}).`
          );
          resolve(false);
          return;
        }

        setTimeout(tryInject, delays[attempt]);
      }

      tryInject();
    });
  };

  // ---- Public control surface (driven by options page / background) ----
  window.__extractorStart = function (selectorType, selectorValue, injectType, injectValue) {
    window.__extractorSelectorType = selectorType === 'id' ? 'id' : 'class';
    window.__extractorSelectorValue = selectorValue || '';
    window.__extractorInjectType = injectType === 'id' ? 'id' : 'class';
    window.__extractorInjectValue = injectValue || '';
    running = true;
    armed = false;
    startObserver();
  };

  window.__extractorStop = function () {
    running = false;
    stopObserver();
    console.log('[Class Extractor] Stopped. Waiting.');
  };

  // ---- Message handling ----
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'EXTRACTOR_START') {
      window.__extractorStart(
        message.selectorType,
        message.selectorValue,
        message.injectType,
        message.injectValue
      );
    } else if (message.type === 'EXTRACTOR_STOP') {
      window.__extractorStop();
    } else if (message.type === 'EXTRACTOR_INJECT') {
      window.__extractorInject(message.text)
        .then((ok) => sendResponse({ ok }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // keep the message channel open for the async reply
    }

    return false;
  });

  // ---- Resume a running session across page loads (no-op when idle) ----
  chrome.storage.local.get(
    {
      extractorRunning: false,
      selectorType: 'class',
      selectorValue: '',
      injectType: 'class',
      injectValue: ''
    },
    (items) => {
      if (items.extractorRunning && items.selectorValue) {
        window.__extractorStart(
          items.selectorType,
          items.selectorValue,
          items.injectType,
          items.injectValue
        );
      }
      // Otherwise: do nothing. The extension waits for the user to click Start.
    }
  );
})();
