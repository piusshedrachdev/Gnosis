document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('className');
  const saveBtn = document.getElementById('save');
  const status = document.getElementById('status');
  const lastValueEl = document.getElementById('lastValue');
  const lastMetaEl = document.getElementById('lastMeta');

  // ---- Helpers ----
  function showStatus(message, isError = false) {
    if (!status) {
      console.warn('[Class Extractor] No #status element found:', message);
      return;
    }
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

  // ---- Load current class ----
  function loadCurrentClass() {
    chrome.storage.sync.get({ targetClass: '' }, (items) => {
      input.value = items.targetClass || '';
    });
  }

  // ---- Load latest extracted value ----
  function refreshLastValue() {
    chrome.storage.local.get(
      { lastValue: '', lastClassName: '', lastUpdated: 0 },
      (items) => {
        lastValueEl.textContent = items.lastValue || '(none yet)';
        lastMetaEl.textContent = items.lastUpdated
          ? `Class: ${items.lastClassName} • Updated: ${new Date(items.lastUpdated).toLocaleTimeString()}`
          : '';
      }
    );
  }

  // ---- Init ----
  loadCurrentClass();
  refreshLastValue();
  setInterval(refreshLastValue, 2000);

  // ---- Save ----
  saveBtn.addEventListener('click', () => {
    console.log('[Class Extractor] Save clicked');
    const targetClass = input.value.trim();
    console.log('[Class Extractor] Saving targetClass =', JSON.stringify(targetClass));

    if (!targetClass) {
      showStatus('Please enter a class name.', true);
      return;
    }

    chrome.storage.sync.set({ targetClass }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Class Extractor] Save error:', chrome.runtime.lastError);
        showStatus('Error saving: ' + chrome.runtime.lastError.message, true);
      } else {
        console.log('[Class Extractor] Saved successfully');
        showStatus('✓ Settings saved!');
      }
    });
  });

  // ---- Re-inject on active tab ----
  const reinjectBtn = document.getElementById('reinject');
  if (reinjectBtn) {
    reinjectBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        showStatus('No active tab found.', true);
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        showStatus('✓ Content script re-injected.');
      } catch (err) {
        showStatus('Error: ' + err.message, true);
      }
    });
  }

  // ---- Save on Enter ----
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });

  // ---- Sync input if changed elsewhere ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.targetClass) {
      input.value = changes.targetClass.newValue || '';
    }
  });
});