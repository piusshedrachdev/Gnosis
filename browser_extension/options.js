document.addEventListener('DOMContentLoaded', () => {
  // selector.js must be loaded before this script (see options.html). If it is
  // missing, fail loudly with a clear message instead of an uncaught
  // ReferenceError deep in the page-resolution logic.
  if (typeof SelectorUtil === 'undefined') {
    console.error(
      '[Class Extractor] selector.js is not loaded. Add <script src="selector.js"></script> before options.js in options.html.'
    );
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = '#ffe5e5';
      statusEl.style.color = '#a00';
      statusEl.style.border = '1px solid #f5b5b5';
      statusEl.textContent = 'Extension misconfigured: selector.js did not load.';
    }
    return;
  }

  // Extraction (source) controls
  const selectorValueInput = document.getElementById('selectorValue');
  // Injection (destination) controls
  const injectValueInput = document.getElementById('injectValue');
  // Auto-send controls
  const autoSendInput = document.getElementById('autoSend');
  const buttonValueInput = document.getElementById('buttonValue');

  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const status = document.getElementById('status');
  const stateEl = document.getElementById('state');
  const lastValueEl = document.getElementById('lastValue');
  const lastMetaEl = document.getElementById('lastMeta');
  const parseReportEl = document.getElementById('parseReport');
  const pageLabelEl = document.getElementById('pageLabel');
  const savedPagesSelect = document.getElementById('savedPages');

  // The origin (e.g. https://www.whatsapp.com) currently shown in the form.
  let currentPageKey = null;

  // ---- Helpers ----
  function showStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message;
    status.style.display = 'block';
    status.style.background = isError ? '#ffe5e5' : '#e5f7e5';
    status.style.color = isError ? '#a00' : '#060';
    status.style.border = `1px solid ${isError ? '#f5b5b5' : '#b5e0b5'}`;

    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(() => {
      status.style.display = 'none';
    }, 2500);
  }

  function selectedRadioValue(name, fallback) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : fallback;
  }

  function setRadioValue(name, value) {
    const radio = document.querySelector(
      `input[name="${name}"][value="${value}"]`
    );
    if (radio) radio.checked = true;
  }

  function disableGroup(name, disabled) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
      el.disabled = disabled;
    });
  }

  function setState(running) {
    stateEl.textContent = running ? 'running' : 'waiting';
    stateEl.classList.toggle('running', running);
    stateEl.classList.toggle('waiting', !running);
    startBtn.disabled = running;
    stopBtn.disabled = !running;

    // Lock all inputs (source, destination, auto-send) while running.
    selectorValueInput.disabled = running;
    injectValueInput.disabled = running;
    autoSendInput.disabled = running;
    buttonValueInput.disabled = running;
    disableGroup('selectorType', running);
    disableGroup('injectType', running);
    disableGroup('buttonType', running);
  }

  /** Enable/disable the button selector fields based on the Auto toggle. */
  function syncAutoControls() {
    const on = autoSendInput.checked;
    buttonValueInput.disabled = !on;
    document.querySelectorAll('input[name="buttonType"]').forEach((el) => {
      el.disabled = !on;
    });
  }

  // ---- Per-page helpers ----

  /** Fill the form from a settings record. */
  function applySettingsToForm(settings) {
    const s = SelectorUtil.pickPageSettings(settings || {});

    selectorValueInput.value = s.selectorValue;
    setRadioValue('selectorType', s.selectorType);

    injectValueInput.value = s.injectValue;
    setRadioValue('injectType', s.injectType);

    autoSendInput.checked = s.autoSend;
    buttonValueInput.value = s.buttonValue;
    setRadioValue('buttonType', s.buttonType);
    syncAutoControls();
  }

  /** Read the current form values as a settings record. */
  function readFormSettings() {
    return {
      selectorType: selectedRadioValue('selectorType', 'class'),
      selectorValue: selectorValueInput.value.trim(),
      injectType: selectedRadioValue('injectType', 'class'),
      injectValue: injectValueInput.value.trim(),
      autoSend: autoSendInput.checked,
      buttonType: selectedRadioValue('buttonType', 'class'),
      buttonValue: buttonValueInput.value.trim()
    };
  }

  /**
   * Resolve the page tab the user is configuring.
   *
   * The options page can be opened as its own tab (open_in_tab: true) or as a
   * popup. In both cases we must NOT pick the options page's own
   * chrome-extension:// tab — we want the real web page tab. We therefore:
   *   1. look at the last focused normal window's active tab, and
   *   2. fall back to scanning all tabs for the most recently active http(s)
   *      tab, skipping extension pages.
   *
   * @returns {Promise<{id?:number, url?:string}|null>}
   */
  async function resolvePageTab() {
    // Try several strategies, most-specific first, and log what we found so a
    // failure is diagnosable. We must never pick our own chrome-extension://
    // options tab, and we must not require the page tab to be `active` (it
    // often isn't when the options page/popup has focus).
    const strategies = [
      { label: 'active+lastFocusedWindow', query: { active: true, lastFocusedWindow: true } },
      { label: 'active+currentWindow', query: { active: true, currentWindow: true } },
      { label: 'normal', query: { windowType: 'normal' } },
      { label: 'all', query: {} },
    ];

    for (const s of strategies) {
      let tabs = [];
      try {
        tabs = await chrome.tabs.query(s.query);
      } catch (err) {
        console.warn('[Class Extractor] tabs.query failed for', s.label, err);
        continue;
      }

      const picked = SelectorUtil.pickPageTab(tabs);
      if (picked) {
        console.log(
          '[Class Extractor] Resolved page tab via',
          s.label + ':',
          picked.url,
          '->',
          SelectorUtil.pageKeyFromUrl(picked.url)
        );
        return picked;
      }
    }

    console.warn(
      '[Class Extractor] No usable http(s) page tab found. Tabs seen: none usable.'
    );
    return null;
  }

  /** Resolve the active page's key and load its saved settings. */
  async function loadPageState() {
    let pageKey = null;
    try {
      const tab = await resolvePageTab();
      const url = tab && (tab.url || tab.pendingUrl);
      if (url) pageKey = SelectorUtil.pageKeyFromUrl(url);
    } catch (err) {
      console.warn('[Class Extractor] Could not resolve active tab:', err);
    }

    currentPageKey = pageKey;
    pageLabelEl.textContent = pageKey ? SelectorUtil.pageLabel(pageKey) : '(unsupported page)';

    const defaults = {
      extractorRunning: false,
      lastValue: '',
      lastUpdated: 0,
      lastClassName: '',
      lastParseOk: null,
      lastParseReport: ''
    };

    if (pageKey) {
      defaults[SelectorUtil.pageSettingsKey(pageKey)] = SelectorUtil.emptyPageSettings();
    }

    chrome.storage.local.get(defaults, (items) => {
      const settings = pageKey
        ? items[SelectorUtil.pageSettingsKey(pageKey)]
        : null;
      applySettingsToForm(settings);
      setState(Boolean(items.extractorRunning));
      renderLastValue(items);
    });

    refreshSavedPages();
  }

  /** Populate the "Saved pages" dropdown from the stored index. */
  function refreshSavedPages() {
    chrome.storage.local.get({ savedPages: [] }, (items) => {
      const pages = Array.isArray(items.savedPages) ? items.savedPages.slice() : [];
      pages.sort();

      const previous = savedPagesSelect.value;
      savedPagesSelect.innerHTML = '';

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '\u2014 select a page with saved settings \u2014';
      savedPagesSelect.appendChild(placeholder);

      for (const pageKey of pages) {
        const opt = document.createElement('option');
        opt.value = pageKey;
        opt.textContent = SelectorUtil.pageLabel(pageKey) +
          (pageKey === currentPageKey ? ' (current)' : '');
        savedPagesSelect.appendChild(opt);
      }

      // Pre-select the current page if it is saved.
      if (currentPageKey && pages.indexOf(currentPageKey) !== -1) {
        savedPagesSelect.value = currentPageKey;
      } else if (previous) {
        savedPagesSelect.value = previous;
      }
    });
  }

  /** Load a saved page's settings into the form for viewing/applying. */
  async function selectSavedPage(pageKey) {
    if (!pageKey) return;
    chrome.storage.local.get(
      { [SelectorUtil.pageSettingsKey(pageKey)]: SelectorUtil.emptyPageSettings() },
      (items) => {
        applySettingsToForm(items[SelectorUtil.pageSettingsKey(pageKey)]);
        showStatus('Loaded settings for ' + SelectorUtil.pageLabel(pageKey) + '.');
      }
    );
  }

  function renderLastValue(items) {
    lastValueEl.textContent = items.lastValue || '(none yet)';

    // Reflect the settings currently loaded in the form (which belong to the
    // active page), so the meta line always matches what Start would use.
    const form = readFormSettings();
    const srcType = form.selectorType === 'id' ? '#' : '.';
    const dstType = form.injectType === 'id' ? '#' : '.';
    const btnType = form.buttonType === 'id' ? '#' : '.';
    const autoText = form.autoSend
      ? ` \u2022 Auto-click: ${btnType}${form.buttonValue || '(none)'}`
      : ' \u2022 Auto-click: off';
    lastMetaEl.textContent = items.lastUpdated
      ? `Extract: ${srcType}${form.selectorValue || items.lastClassName || ''} \u2022 Inject: ${dstType}${form.injectValue || '(none)'}${autoText} \u2022 Updated: ${new Date(items.lastUpdated).toLocaleTimeString()}`
      : '';

    if (items.lastParseOk === true) {
      parseReportEl.textContent = items.lastParseReport || 'OK: payload matches the /execute contract.';
      parseReportEl.className = 'ok';
    } else if (items.lastParseOk === false) {
      parseReportEl.textContent = items.lastParseReport || 'MISMATCH: extracted data does not match the /execute contract.';
      parseReportEl.className = 'error';
    } else {
      parseReportEl.textContent = '';
      parseReportEl.className = '';
    }
  }

  // ---- Start ----
  startBtn.addEventListener('click', async () => {
    const selectorType = selectedRadioValue('selectorType', 'class');
    const selectorValue = selectorValueInput.value.trim();

    const injectType = selectedRadioValue('injectType', 'class');
    const injectValue = injectValueInput.value.trim();

    const autoSend = autoSendInput.checked;
    const buttonType = selectedRadioValue('buttonType', 'class');
    const buttonValue = buttonValueInput.value.trim();

    if (!selectorValue) {
      showStatus('Please enter a class or id to extract from.', true);
      return;
    }

    if (!injectValue) {
      showStatus('Please enter a class or id to inject the prompt/response into.', true);
      return;
    }

    if (autoSend && !buttonValue) {
      showStatus('Auto is on — please enter the class or id of the button to click.', true);
      return;
    }

    const settings = {
      selectorType,
      selectorValue,
      injectType,
      injectValue,
      autoSend,
      buttonType,
      buttonValue
    };

    // Re-resolve the page key right now (do not rely on the value captured at
    // load time, which may be stale if the user switched tabs).
    const tab = await resolvePageTab();
    const pageUrl = tab && (tab.url || tab.pendingUrl);
    const pageKey = pageUrl ? SelectorUtil.pageKeyFromUrl(pageUrl) : null;

    if (pageKey) {
      currentPageKey = pageKey;
      pageLabelEl.textContent = SelectorUtil.pageLabel(pageKey);
    }

    // Persist the session config under the CURRENT PAGE's key, and keep the
    // global running flag + latest-value fields.
    const toStore = {
      extractorRunning: true,
      lastValue: '',
      lastUpdated: 0,
      lastParseOk: null,
      lastParseReport: ''
    };

    if (pageKey) {
      toStore[SelectorUtil.pageSettingsKey(pageKey)] = settings;
    }

    await chrome.storage.local.set(toStore);

    // If we could not resolve a real page (e.g. the options tab is focused on
    // a chrome-extension:// page), say so instead of silently not saving.
    if (!pageKey) {
      showStatus(
        'Could not determine the page to save settings for. Open this on a normal http(s) tab.',
        true
      );
      return;
    }

    // Add the page to the saved-pages index (deduped).
    {
      const existing = await chrome.storage.local.get({ savedPages: [] });
      const pages = Array.isArray(existing.savedPages) ? existing.savedPages.slice() : [];
      if (pages.indexOf(pageKey) === -1) {
        pages.push(pageKey);
        await chrome.storage.local.set({ savedPages: pages });
      }
      refreshSavedPages();
    }

    // Ask the page tab's content script to (re)arm with the new target.
    try {
      if (tab && tab.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['selector.js', 'parser.js', 'content.js']
          });
        } catch (err) {
          // Already injected is fine; only surface real failures.
          if (!/cannot be injected|already/i.test(err.message || '')) {
            console.warn('[Class Extractor] Re-inject note:', err.message);
          }
        }

        await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACTOR_START',
          selectorType,
          selectorValue,
          injectType,
          injectValue,
          autoSend,
          buttonType,
          buttonValue
        });

        // Ask the background worker to build the capability prompt and write
        // it into the destination element right away, so the agent sees it on
        // Start rather than only after the first extraction/response.
        const injectResult = await chrome.runtime.sendMessage({
          type: 'EXTRACTOR_INJECT_PROMPT'
        });

        if (!injectResult || !injectResult.ok) {
          showStatus(
            'Started. Could not inject the prompt — is the destination element present on the page?',
            true
          );
        }
      }
    } catch (err) {
      showStatus('Started, but could not reach the active tab: ' + err.message, true);
    }

    setState(true);
    showStatus('\u2713 Parsing started (prompt injected, extract + inject set).');
  });

  // ---- Stop ----
  stopBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ extractorRunning: false });

    try {
      const tab = await resolvePageTab();
      if (tab && tab.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACTOR_STOP' });
      }
    } catch (err) {
      // Tab may be gone; stopping locally is enough.
      console.warn('[Class Extractor] Stop note:', err.message);
    }

    setState(false);
    showStatus('Parsing stopped. Waiting.');
  });

  // ---- Save on Enter (starts the session) ----
  selectorValueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !startBtn.disabled) startBtn.click();
  });
  injectValueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !startBtn.disabled) startBtn.click();
  });
  buttonValueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !startBtn.disabled) startBtn.click();
  });

  // Toggle the button-selector fields when Auto is switched on/off.
  autoSendInput.addEventListener('change', () => {
    if (!stateEl.classList.contains('running')) syncAutoControls();
  });

  // ---- Saved-pages dropdown ----
  savedPagesSelect.addEventListener('change', () => {
    if (savedPagesSelect.value) selectSavedPage(savedPagesSelect.value);
  });

  // ---- Keep the UI in sync with storage ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.extractorRunning) {
      setState(Boolean(changes.extractorRunning.newValue));
    }

    if (changes.savedPages) {
      refreshSavedPages();
    }

    // Re-render the latest-value block whenever any of its fields change.
    const valueKeys = [
      'lastValue', 'lastUpdated', 'lastClassName', 'lastParseOk', 'lastParseReport'
    ];
    if (valueKeys.some((k) => changes[k])) {
      chrome.storage.local.get(
        { lastValue: '', lastUpdated: 0, lastClassName: '', lastParseOk: null, lastParseReport: '' },
        renderLastValue
      );
    }
  });

  // ---- React to tab changes so the page label/settings follow the tab ----
  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(() => loadPageState());
    chrome.tabs.onUpdated.addListener((_tabId, info) => {
      if (info.status === 'complete' || info.url) loadPageState();
    });
  }

  // ---- Init ----
  loadPageState();
  setInterval(() => {
    chrome.storage.local.get(
      { lastValue: '', lastUpdated: 0, lastClassName: '', lastParseOk: null, lastParseReport: '' },
      renderLastValue
    );
  }, 2000);
});
