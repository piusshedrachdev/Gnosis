importScripts('parser.js', 'capability_prompt.js');

/**
 * Background service worker.
 *
 * Flow:
 *   content.js  --CLASS_VALUE_EXTRACTED-->  background
 *                                              |
 *                                    ExtractorParser.parseExtraction()
 *                                              |
 *                          ok? forward to /execute : report mismatch
 *
 * The parser decides whether the extracted data matches what the server's
 * /execute endpoint needs. If it does, we forward the payload to the server.
 * If it does not, we surface a precise mismatch report instead of sending
 * garbage.
 */

const EXECUTE_URL = 'http://localhost:3000/execute';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  return false;
});

/**
 * Parse and, if valid, forward an extraction.
 */
async function handleExtraction(message) {
  const extraction = {
    className: message.className,
    value: message.value
  };

  // 1. Parse + validate against the /execute contract.
  const parsed = ExtractorParser.parseExtraction(extraction);

  console.log('[Class Extractor] Parser report:', parsed.report);

  // Always persist the latest extraction for the UI.
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
    // Mismatch: report, do NOT send to the server.
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
    console.warn(
      '[Class Extractor] Extracted data does NOT match /execute contract:',
      parsed.errors
    );
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
  } catch (error) {
    // Network/server unreachable — still a valid payload, just not delivered.
    await chrome.storage.local.set({
      lastExecuteOk: false,
      lastExecuteError: error instanceof Error ? error.message : String(error)
    });
    console.warn('[Class Extractor] Failed to reach /execute:', error);
  }
}
