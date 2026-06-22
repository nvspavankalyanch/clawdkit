// Initialises the redesigned browse page sidebar, export panel, filter sync,
// and theme controls. Loaded before browse.js so MutationObservers are in
// place when browse.js adds the initial `selected` class to filter-option.

// ── Rail branding ────────────────────────────────────────────────────────────
(function () {
  const m = chrome.runtime.getManifest();
  const nameEl = document.getElementById('rail-name');
  const verEl = document.getElementById('rail-version');
  if (nameEl) nameEl.textContent = m.name;
  if (verEl) verEl.textContent = 'v' + m.version + ' · beta';
})();

// ── Theme helpers ─────────────────────────────────────────────────────────────
function updateThemeButtons() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const isDark = theme === 'dark';
  const lb = document.getElementById('themeLightBtn');
  const db = document.getElementById('themeDarkBtn');
  if (lb) lb.classList.toggle('on', !isDark);
  if (db) db.classList.toggle('on', isDark);
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = isDark ? 'Dark' : 'Light';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  updateThemeButtons();
}

// Keep theme buttons in sync whenever browse.js (initTheme / toggleTheme) changes data-theme
new MutationObserver(updateThemeButtons)
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

document.addEventListener('DOMContentLoaded', () => {
  // ── Theme buttons ───────────────────────────────────────────────────────────
  const lb = document.getElementById('themeLightBtn');
  const db = document.getElementById('themeDarkBtn');
  if (lb) lb.addEventListener('click', () => setTheme('light'));
  if (db) db.addEventListener('click', () => setTheme('dark'));
  updateThemeButtons();

  // ── Export options panel toggle ─────────────────────────────────────────────
  const exportToggle = document.getElementById('exportOptionsToggle');
  const exportPanel = document.getElementById('exportOptionsPanel');
  if (exportToggle && exportPanel) {
    exportToggle.addEventListener('click', () => {
      const open = exportPanel.classList.toggle('show');
      exportToggle.style.background = open ? 'var(--accent-soft)' : '';
      exportToggle.style.borderColor = open ? 'var(--accent)' : '';
      exportToggle.style.color = open ? 'var(--accent-deep)' : '';
    });
  }

  // ── Sidebar nav shortcuts ───────────────────────────────────────────────────
  function activateNavItem(id) {
    document.querySelectorAll('.nav a').forEach(a => a.classList.remove('on'));
    const el = document.getElementById(id);
    if (el) el.classList.add('on');
  }

  const navAll = document.getElementById('nav-all');
  if (navAll) {
    navAll.addEventListener('click', e => {
      e.preventDefault();
      const opt = document.querySelector('.filter-option[data-value="all"]');
      if (opt) opt.click();
      activateNavItem('nav-all');
    });
  }

  const navExported = document.getElementById('nav-exported');
  if (navExported) {
    navExported.addEventListener('click', e => {
      e.preventDefault();
      const opt = document.querySelector('.filter-option[data-value="exported"]');
      if (opt) opt.click();
      activateNavItem('nav-exported');
    });
  }

  const navExportOpts = document.getElementById('nav-export-opts');
  if (navExportOpts) {
    navExportOpts.addEventListener('click', e => {
      e.preventDefault();
      const toggle = document.getElementById('exportOptionsToggle');
      if (toggle) toggle.click();
    });
  }

  // ── Visual filter segmented control ────────────────────────────────────────
  // Each visible button programmatically clicks the corresponding hidden
  // .filter-option element, which browse.js's click handler handles.
  document.querySelectorAll('#visFilters button').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.filter;
      const opt = document.querySelector('.filter-option[data-value="' + val + '"]');
      if (opt) opt.click();

      document.querySelectorAll('#visFilters button').forEach(b => b.classList.toggle('on', b === btn));

      // Sync nav active state
      const navMap = { all: 'nav-all', exported: 'nav-exported' };
      if (navMap[val]) activateNavItem(navMap[val]);
      else document.querySelectorAll('.nav a').forEach(a => a.classList.remove('on'));
    });
  });

  // Keep visual filter buttons in sync when browse.js updates .filter-option.selected
  const filterObserver = new MutationObserver(() => {
    const selected = document.querySelector('.filter-option.selected');
    const val = selected ? selected.dataset.value : 'all';
    document.querySelectorAll('#visFilters button').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.filter === val);
    });
  });
  document.querySelectorAll('.filter-option').forEach(opt => {
    filterObserver.observe(opt, { attributes: true, attributeFilter: ['class'] });
  });

  // ── Rail conversation count ─────────────────────────────────────────────────
  function updateRailCount(count) {
    const ct = document.getElementById('nav-count');
    if (ct) ct.textContent = count > 0 ? count.toLocaleString() : '';
    const uc = document.getElementById('usageCount');
    if (uc) uc.textContent = count > 0 ? count.toLocaleString() : '0';
  }
  const statsEl = document.getElementById('stats');
  if (statsEl) {
    new MutationObserver(() => {
      const text = statsEl.textContent || '';
      const m = text.match(/[\d,]+/);
      if (m) updateRailCount(parseInt(m[0].replace(/,/g, ''), 10));
    }).observe(statsEl, { childList: true, subtree: true, characterData: true });
  }
});
