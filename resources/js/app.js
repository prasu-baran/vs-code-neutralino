// ============================================================================
//  CodeXplorer — app.js
//  Application bootstrap — entry point loaded last.
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(state.theme);
  initCodeMirror();
  initNeutralino();
  bindAllEvents();

  if (state.hfApiKey) {
    document.getElementById('hfApiKey').value = state.hfApiKey;
    setApiStatus('ok', 'API key loaded');
  }

  terminalPrint('info', 'CodeXplorer ready. Open a folder to get started.');
  terminalPrint('info', 'Ctrl+S  Save   |   Ctrl+Enter  Run   |   Ctrl+`  Terminal   |   Ctrl+F  Find');
  restoreSession();
});
