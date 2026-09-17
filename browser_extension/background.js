importScripts('selector.js', 'parser.js', 'capability_prompt.js');

/**
 * Background service worker.
 *
 * Flow (only active after the user clicks Start on the options page):
 *
 *   options  --EXTRACTOR_START-->  content.js  (arms the observer)
 *   content  --CLASS_VALUE_EXTRACTED-->  background
 *                                              |
 *                                    ExtractorParser.parseExtraction()
 *                                              |
 *                          ok? forward to /execute : report mismatch
 *
 * While the session is idle (extractorRunning === false), extractions are
 * ignored so nothing is parsed or forwarded until the user starts a session.
 */

const EXECUTE_URL = 'http://localhost:3000/execute';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'CLASS_VALUE_EXTRACTED') {
    handleExtraction(message);
    return false;
  }

  if (message.type === 'GET_CAPABILITY_PROMPT') {
    sendResponse({
      prompt: CapabilityPrompt.buildCapabilityPrompt({ baseUrl: 'http://localhost:3000' }),
      compact: CapabilityPrompt.buildCompactPrompt({ baseUrl: 'http://localhost:3000' })
    });
    return true;
  }

  // Options page asks us to write the capability prompt into the destination
  // element as soon as a session starts.
  if (message.type === 'EXTRACTOR_INJECT_PROMPT') {
    injectPromptIntoPage()
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

/**
 * Build the capability-discovery prompt and inject it into the destination
 * element of the active tab. Used on Start so the agent sees the prompt
 * immediately, before any extraction happens.
 */
async function injectPromptIntoPage() {
  const prompt = CapabilityPrompt.buildCapabilityPrompt({
    baseUrl: 'http://localhost:3000'
  });

  // Prompt replaces any prior content so the agent starts from a clean slate.
  const ok = await injectIntoPage(prompt, 'replace');
  await chrome.storage.local.set({ lastInjectedPrompt: ok, lastInjectedAt: Date.now() });

  if (ok) {
    console.log('[Class Extractor] Capability prompt injected into destination.');
  } else {
    console.warn('[Class Extractor] Could not inject capability prompt (destination element missing?).');
  }

  return ok;
}

/**
 * Parse and, if valid and a session is running, forward an extraction.
 */
async function handleExtraction(message) {
  // Ignore stray extractions when no session is active.
  const state = await chrome.storage.local.get({ extractorRunning: false });
  if (!state.extractorRunning) {
    console.log('[Class Extractor] Ignoring extraction; no active session.');
    return;
  }

  const extraction = {
    className: message.selectorValue || message.className,
    value: message.value
  };

  // 1. Parse + validate against the /execute contract.
  const parsed = ExtractorParser.parseExtraction(extraction);

  console.log('[Class Extractor] Parser report:', parsed.report);

  await chrome.storage.local.set({
    lastValue: extraction.value,
    lastClassName: extraction.className,
    lastUpdated: Date.now(),
    lastParseOk: parsed.ok,
    lastParseReport: parsed.report,
    lastParseErrors: parsed.errors
  });

  const short = (extraction.value || '').trim().slice(0, 4) || '✓';

  if (!parsed.ok) {
    // Not a capability call (or invalid arguments): report, do NOT send to the
    // server and do NOT inject anything into the destination element.
    const isToolCall = !/^NOT_A_TOOL_CALL/.test(parsed.report || '');

    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });

    if (isToolCall) {
      console.warn(
        '[Class Extractor] Extracted capability call has invalid arguments:',
        parsed.errors
      );
    } else {
      // Show enough of the text to diagnose why it was rejected. If this looks
      // like a real tool call, the gate is too strict or the JSON was partial.
      const preview = (extraction.value || '').slice(0, 300);
      console.warn(
        '[Class Extractor] Extracted text is not a tool call; nothing sent or injected. Reason:',
        parsed.errors && parsed.errors[0],
        '\nPreview:',
        preview
      );
    }
    return;
  }

  // 2. Valid: forward to the runtime.
  chrome.action.setBadgeText({ text: short });
  chrome.action.setBadgeBackgroundColor({ color: '#0a84ff' });

  try {
    const response = await fetch(EXECUTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.payload)
    });

    const result = await response.json().catch(() => null);

    await chrome.storage.local.set({
      lastExecuteStatus: response.status,
      lastExecuteOk: response.ok,
      lastExecuteResponse: result
    });

    if (!response.ok) {
      console.warn('[Class Extractor] /execute returned', response.status, result);
    } else {
      console.log('[Class Extractor] /execute ok:', result);
    }

    // 3. Append the API response below the prompt so the prompt stays visible.
    await injectIntoPage(formatResponse(result), 'append');

    // 4. If auto-send is on, click the configured button (only reached on a
    //    matched, executed tool call — never for free-form text).
    await maybeAutoClick();
  } catch (error) {
    await chrome.storage.local.set({
      lastExecuteOk: false,
      lastExecuteError: error instanceof Error ? error.message : String(error)
    });
    console.warn('[Class Extractor] Failed to reach /execute:', error);

    // Surface the failure into the destination element too, when possible.
    await injectIntoPage(
      'ERROR: ' + (error instanceof Error ? error.message : String(error)),
      'append'
    );
  }
}

/**
 * Send text to the active tab's content script for injection into the
 * configured destination element. Safe no-op if there is no active tab or
 * the destination is not present.
 */
async function injectIntoPage(text, mode) {
  if (typeof text !== 'string' || !text) return false;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return false;

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXTRACTOR_INJECT',
      text,
      mode: mode === 'append' ? 'append' : 'replace'
    });

    return Boolean(response && response.ok);
  } catch (error) {
    // Content script may be absent on restricted pages; not fatal.
    console.warn('[Class Extractor] Injection skipped:', error);
    return false;
  }
}

/**
 * If auto-send is enabled, ask the content script to click the configured
 * button. Only called after a matched tool call is executed and injected, so
 * free-form text never triggers a click.
 */
async function maybeAutoClick() {
  const state = await chrome.storage.local.get({
    autoSend: false,
    buttonType: 'class',
    buttonValue: ''
  });

  if (!SelectorUtil.shouldAutoClick(state)) {
    if (state.autoSend) {
      console.warn('[Class Extractor] Auto-send on but no button selector configured.');
    } else {
      console.log('[Class Extractor] Auto-send off; waiting for manual send.');
    }
    await chrome.storage.local.set({ lastAutoClicked: false });
    return false;
  }

  const ok = await clickButtonInPage();
  await chrome.storage.local.set({ lastAutoClicked: ok, lastAutoClickedAt: Date.now() });

  if (ok) {
    console.log('[Class Extractor] Auto-send: button clicked.');
  } else {
    console.warn('[Class Extractor] Auto-send: could not click the button.');
  }

  return ok;
}

/**
 * Send the auto-click request to the active tab's content script.
 */
async function clickButtonInPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return false;

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXTRACTOR_CLICK_BUTTON'
    });

    return Boolean(response && response.ok);
  } catch (error) {
    console.warn('[Class Extractor] Auto-click skipped:', error);
    return false;
  }
}

/**
 * Render an /execute result (or the capability prompt) as injectable text.
 */
function formatResponse(result) {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch (e) {
    return String(result);
  }
}
