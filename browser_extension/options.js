document.addEventListener('DOMContentLoaded', () => {
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

  // ---- Load persisted session state ----
  function loadState() {
    chrome.storage.local.get(
      {
        extractorRunning: false,

        // Extraction (source) selector
        selectorType: 'class',
        selectorValue: '',

        // Injection (destination) selector
        injectType: 'class',
        injectValue: '',

        // Auto-send config
        autoSend: false,
        buttonType: 'class',
        buttonValue: '',

        lastValue: '',
        lastUpdated: 0,
        lastClassName: '',
        lastParseOk: null,
        lastParseReport: ''
      },
      (items) => {
        // Source
        selectorValueInput.value = items.selectorValue || '';
        setRadioValue('selectorType', items.selectorType || 'class');

        // Destination
        injectValueInput.value = items.injectValue || '';
        setRadioValue('injectType', items.injectType || 'class');

        // Auto-send
        autoSendInput.checked = Boolean(items.autoSend);
        buttonValueInput.value = items.buttonValue || '';
        setRadioValue('buttonType', items.buttonType || 'class');
        syncAutoControls();

        setState(Boolean(items.extractorRunning));
        renderLastValue(items);
      }
    );
  }

  function renderLastValue(items) {
    lastValueEl.textContent = items.lastValue || '(none yet)';

    const srcType = items.selectorType === 'id' ? '#' : '.';
    const dstType = items.injectType === 'id' ? '#' : '.';
    const btnType = items.buttonType === 'id' ? '#' : '.';
    const autoText = items.autoSend
      ? ` \u2022 Auto-click: ${btnType}${items.buttonValue || '(none)'}`
      : ' \u2022 Auto-click: off';
    lastMetaEl.textContent = items.lastUpdated
      ? `Extract: ${srcType}${items.selectorValue || items.lastClassName || ''} \u2022 Inject: ${dstType}${items.injectValue || '(none)'}${autoText} \u2022 Updated: ${new Date(items.lastUpdated).toLocaleTimeString()}`
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

    // Persist the full session config (source + destination + auto-send).
    await chrome.storage.local.set({
      extractorRunning: true,

      selectorType,
      selectorValue,

      injectType,
      injectValue,

      autoSend,
      buttonType,
      buttonValue,

      lastValue: '',
      lastUpdated: 0,
      lastParseOk: null,
      lastParseReport: ''
    });

    // Ask the active tab's content script to (re)arm with the new target.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

  // ---- Keep the UI in sync with storage ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.extractorRunning) {
      setState(Boolean(changes.extractorRunning.newValue));
    }

    const keys = [
      'lastValue', 'lastUpdated', 'lastClassName', 'lastParseOk', 'lastParseReport',
      'selectorType', 'selectorValue', 'injectType', 'injectValue'
    ];
    if (keys.some((k) => changes[k])) {
      chrome.storage.local.get(
        {
          lastValue: '', lastUpdated: 0, lastClassName: '', lastParseOk: null, lastParseReport: '',
          selectorType: 'class', selectorValue: '', injectType: 'class', injectValue: ''
        },
        renderLastValue
      );
    }
  });

  // ---- Init ----
  loadState();
  setInterval(() => {
    chrome.storage.local.get(
      {
        lastValue: '', lastUpdated: 0, lastClassName: '', lastParseOk: null, lastParseReport: '',
        selectorType: 'class', selectorValue: '', injectType: 'class', injectValue: ''
      },
      renderLastValue
    );
  }, 2000);
});
