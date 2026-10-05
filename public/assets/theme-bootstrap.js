(() => {
  try {
    const saved = window.glean?.preferences?.['glean-theme'] ?? localStorage.getItem('glean-theme');
    const theme = saved === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', theme === 'dark' ? '#050d0e' : '#f5f7f5');
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
