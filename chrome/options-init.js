// Initialises the redesigned options page: theme, rail branding, radio card
// click handlers, and syncing the visual state with stored preferences.
// Loaded before options.js so the radio change events options.js listens for
// are dispatched correctly when a card is clicked.

// ── Theme init (runs immediately, before DOMContentLoaded) ────────────────────
(function () {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // ── Rail branding ───────────────────────────────────────────────────────────
  const m = chrome.runtime.getManifest();
  const nameEl = document.getElementById('rail-name');
  const verEl = document.getElementById('rail-version');
  if (nameEl) nameEl.textContent = m.name;
  if (verEl) verEl.textContent = 'v' + m.version + ' · beta';

  // ── Model display radio cards ───────────────────────────────────────────────
  // The actual <input type="radio"> elements are hidden; the .radio cards are
  // the only visible interaction surface. Clicking a card checks the hidden
  // radio and dispatches 'change' so options.js's storage-save handler fires.
  document.querySelectorAll('.radio').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.radio').forEach(r => r.classList.remove('on'));
      card.classList.add('on');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  // Restore visual .on state from storage (options.js only sets radio.checked,
  // not the .radio card's CSS class).
  chrome.storage.local.get(['modelDisplay'], result => {
    const val = result.modelDisplay === 'current' ? 'current' : 'original';
    document.querySelectorAll('.radio').forEach(r => {
      const inp = r.querySelector('input[type="radio"]');
      r.classList.toggle('on', !!(inp && inp.value === val));
    });
  });

  // ── Connection badge ────────────────────────────────────────────────────────
  chrome.storage.sync.get(['organizationId'], result => {
    const badge = document.getElementById('connStatusBadge');
    if (badge && result.organizationId) badge.style.display = 'inline-flex';
  });
});
