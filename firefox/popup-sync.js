// Syncs the new visual controls (segmented buttons, toggle switches, placement chips)
// with the hidden form elements that popup.js reads for export options.
// Must load before popup.js so listeners are in place when popup.js attaches its own.
document.addEventListener('DOMContentLoaded', () => {
  function syncSeg(segId, selectId) {
    const seg = document.getElementById(segId);
    const sel = document.getElementById(selectId);
    if (!seg || !sel) return;
    const initVal = sel.value;
    seg.querySelectorAll('button').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.dataset.value === initVal ? 'true' : 'false');
    });
    seg.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        sel.value = btn.dataset.value;
        sel.dispatchEvent(new Event('change'));
      });
    });
  }

  function syncToggle(optId, cbId) {
    const opt = document.getElementById(optId);
    const cb = document.getElementById(cbId);
    if (!opt || !cb) return;
    opt.setAttribute('aria-checked', cb.checked ? 'true' : 'false');
    opt.addEventListener('click', () => {
      if (opt.getAttribute('aria-disabled') === 'true') return;
      const next = opt.getAttribute('aria-checked') !== 'true';
      opt.setAttribute('aria-checked', next ? 'true' : 'false');
      cb.checked = next;
      cb.dispatchEvent(new Event('change'));
    });
    opt.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); opt.click(); }
    });
  }

  function syncChip(chipId, cbId) {
    const chip = document.getElementById(chipId);
    const cb = document.getElementById(cbId);
    if (!chip || !cb) return;
    chip.setAttribute('aria-pressed', cb.checked ? 'true' : 'false');
    chip.addEventListener('click', () => {
      const next = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', next ? 'true' : 'false');
      cb.checked = next;
      cb.dispatchEvent(new Event('change'));
    });
    chip.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); chip.click(); }
    });
  }

  syncSeg('seg-format', 'format');
  syncSeg('seg-artifactFormat', 'artifactFormat');
  syncToggle('opt-includeChats', 'includeChats');
  syncToggle('opt-includeThinking', 'includeThinking');
  syncToggle('opt-includeMetadata', 'includeMetadata');
  syncChip('chip-includeArtifacts', 'includeArtifacts');
  syncChip('chip-extractArtifacts', 'extractArtifacts');
  syncChip('chip-flattenArtifacts', 'flattenArtifacts');

  // After popup.js's updateCheckboxStates() runs and sets .disabled on hidden checkboxes,
  // reflect that disabled state back onto the visual toggles/chips.
  function syncDisabledState() {
    ['includeThinking', 'includeMetadata'].forEach(id => {
      const cb = document.getElementById(id);
      const opt = document.getElementById('opt-' + id);
      if (!cb || !opt) return;
      if (cb.disabled) {
        opt.setAttribute('aria-disabled', 'true');
        opt.setAttribute('aria-checked', 'false');
      } else {
        opt.removeAttribute('aria-disabled');
      }
    });
    const cbA = document.getElementById('includeArtifacts');
    const chipA = document.getElementById('chip-includeArtifacts');
    if (cbA && chipA) {
      if (cbA.disabled) {
        chipA.style.opacity = '0.4';
        chipA.style.pointerEvents = 'none';
        chipA.setAttribute('aria-pressed', 'false');
      } else {
        chipA.style.opacity = '';
        chipA.style.pointerEvents = '';
      }
    }
  }

  // setTimeout(0) defers until after popup.js's updateCheckboxStates handler runs
  document.getElementById('includeChats').addEventListener('change', () => {
    setTimeout(syncDisabledState, 0);
  });
});
