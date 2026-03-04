// ============================================================================
//  CodeXplorer — theme.js
//  Dark / light theme switching.
// ============================================================================

function applyTheme(theme) {
  state.theme = theme;
  document.body.className = `theme-${theme}`;
  localStorage.setItem('cxTheme', theme);
  document.getElementById('themeToggleBtn').textContent = theme === 'dark' ? 'Light' : 'Dark';
  if (editor) editor.setOption('theme', theme === 'dark' ? 'one-dark' : 'eclipse');
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}
