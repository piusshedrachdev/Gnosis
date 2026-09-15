(function () {
  // ---- Re-injection guard ----
  if (window.__classExtractorLoaded) {
    chrome.storage.sync.get({ targetClass: '' }, (items) => {
      window.__classExtractorTargetClass = items.targetClass || '';
      if (window.__classExtractorTargetClass && typeof window.__classExtractorInit === 'function') {
        window.__classExtractorInit();
      }
    });
    return;
  }
  window.__classExtractorLoaded = true;

  // ---- State ----
  let debounceTimer = null;
  const DEBOUNCE_DELAY = 1500; // ms of quiet before extracting

  // Page-load guard: skip early noise, arm after first real settle
  let armed = false;
  const PAGE_LOAD_GRACE_MS = 3000; // ignore mutations for 3s after content script starts
  const pageLoadedAt = Date.now();

  // ---- Load target class ----
  chrome.storage.sync.get({ targetClass: '' }, (items) => {
    window.__classExtractorTargetClass = items.targetClass || '';
    if (window.__classExtractorTargetClass) {
      initObserver();
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.targetClass) {
      window.__classExtractorTargetClass = changes.targetClass.newValue || '';
      if (window.__classExtractorTargetClass) {
        initObserver();
      }
    }
  });

  // ---- Does a node match the target class (self or descendant)? ----
  function nodeMatchesTarget(node, targetClass) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    try {
      if (node.classList && node.classList.contains(targetClass)) return true;
      if (node.querySelector && node.querySelector('.' + CSS.escape(targetClass))) return true;
    } catch (e) {
      // CSS.escape may throw on invalid selectors; fail safe
    }
    return false;
  }

  // ---- Is a node inside (or is) a target element? ----
  function isInsideTarget(node, targetClass) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      if (el.classList && el.classList.contains(targetClass)) return true;
      el = el.parentElement;
    }
    return false;
  }

  // ---- Extraction ----
    // Track last reported value per element so we don't spam duplicates,
  // and so we can emit the FULL final text once streaming stops.
  const lastReported = new WeakMap();

  function extractValue() {
    const targetClass = window.__classExtractorTargetClass;
    if (!targetClass) return;

    let elements;
    try {
      elements = document.querySelectorAll('.' + CSS.escape(targetClass));
    } catch (e) {
      console.warn('[Class Extractor] Invalid selector for class:', targetClass);
      return;
    }

    if (elements.length === 0) return;

    const lastElement = elements[elements.length - 1];
    const value = (lastElement.innerText || '').trim();
    if (!value) return;

    // Skip if this element's text hasn't changed since last emit
    if (lastReported.get(lastElement) === value) return;

    lastReported.set(lastElement, value);

    console.log(`[Class Extractor] Extracted (${value.length} chars):`, value);

    chrome.runtime.sendMessage({
      type: 'CLASS_VALUE_EXTRACTED',
      className: targetClass,
      value: value
    });
  }

    // Streaming-safe debounce: after DEBOUNCE_DELAY of quiet, wait a bit more
  // and confirm the text hasn't changed, then emit.
  let pendingElement = null;
  let pendingValue = '';
  let confirmTimer = null;
  const CONFIRM_DELAY = 700; // extra wait to confirm stream has really stopped

  function debouncedExtract() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Still inside the post-load grace window
      if (Date.now() - pageLoadedAt < PAGE_LOAD_GRACE_MS) {
        console.log('[Class Extractor] Skipping — still in page-load grace period');
        return;
      }

      // First quiet period after grace — arm but don't extract yet
      if (!armed) {
        armed = true;
        console.log('[Class Extractor] Page settled. Extractor armed.');
        return;
      }

      // Capture current value
      const targetClass = window.__classExtractorTargetClass;
      if (!targetClass) return;

      let elements;
      try {
        elements = document.querySelectorAll('.' + CSS.escape(targetClass));
      } catch (e) { return; }
      if (elements.length === 0) return;

      const el = elements[elements.length - 1];
      const currentValue = (el.innerText || '').trim();
      if (!currentValue) return;

      // If the value is the same as what we already captured for this element,
      // confirm and emit.
      if (pendingElement === el && pendingValue === currentValue) {
        // Stable — emit
        clearTimeout(confirmTimer);
        extractValue();
        return;
      }

      // Otherwise, store and wait for confirmation
      pendingElement = el;
      pendingValue = currentValue;

      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        const finalValue = (el.innerText || '').trim();
        if (finalValue === pendingValue) {
          extractValue();
        }
      }, CONFIRM_DELAY);
    }, DEBOUNCE_DELAY);
  }

  // ---- Observer: hybrid (new matching nodes OR text inside target) ----
  function initObserver() {
    if (window.__classExtractorObserver) {
      window.__classExtractorObserver.disconnect();
    }

    window.__classExtractorObserver = new MutationObserver((mutations) => {
      const targetClass = window.__classExtractorTargetClass;
      if (!targetClass) return;

      let relevant = false;

      for (const mutation of mutations) {
        // Case 1: new node(s) added — does any match (or wrap) the target?
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (nodeMatchesTarget(node, targetClass)) {
              relevant = true;
              break;
            }
          }
        }
        // Case 2: text changed in-place — but only if it happened INSIDE the target
        else if (mutation.type === 'characterData') {
          if (isInsideTarget(mutation.target, targetClass)) {
            relevant = true;
          }
        }
        // Case 3: text node added directly inside an existing target
        else if (mutation.type === 'childList') {
          if (isInsideTarget(mutation.target, targetClass)) {
            relevant = true;
          }
        }

        if (relevant) break;
      }

      if (relevant) {
        debouncedExtract();
      }
    });

    window.__classExtractorObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
      // attributes: false  → ignore attribute changes entirely
    });

    console.log(`[Class Extractor] Observer started for class: "${window.__classExtractorTargetClass}"`);

    // Initial extraction in case content is already on the page
    debouncedExtract();
  }

  window.__classExtractorInit = initObserver;

  // ---- Toast UI ----
  function showToast(text) {
    const existing = document.getElementById('__classExtractorToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = '__classExtractorToast';
    toast.textContent = text.slice(0, 500);
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      maxWidth: '400px',
      background: '#222',
      color: '#fff',
      padding: '12px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      fontFamily: 'system-ui, sans-serif',
      zIndex: 2147483647,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      opacity: '0',
      transition: 'opacity 0.3s'
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
})();