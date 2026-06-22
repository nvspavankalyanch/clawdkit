// Theme initialization for popup — syncs with browse window theme preference.
// Convention: data-theme="dark" on <html> for dark; no attribute (or "light") for light.
(function () {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    // Fall back to system preference — default to light
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  // Sync when the browse window changes theme
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme') {
      if (e.newValue) {
        document.documentElement.setAttribute('data-theme', e.newValue);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    }
  });

  // Follow system changes when no saved preference
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
})();
