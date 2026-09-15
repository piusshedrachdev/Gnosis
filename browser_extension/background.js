chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CLASS_VALUE_EXTRACTED') {
    console.log(`[Class Extractor] ${message.className}:`, message.value);

    // Store the latest value for display in the popup/options page
    chrome.storage.local.set({
      lastValue: message.value,
      lastClassName: message.className,
      lastUpdated: Date.now()
    });

    // Update the extension badge with a short preview
    const short = (message.value || '').trim().slice(0, 4) || '✓';
    chrome.action.setBadgeText({ text: short });
    chrome.action.setBadgeBackgroundColor({ color: '#0a84ff' });
  }
});