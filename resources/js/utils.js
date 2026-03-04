// ============================================================================
//  CodeXplorer — utils.js
//  Shared utility functions used across all modules.
// ============================================================================

// ── Runtime detection ─────────────────────────────────────────────────────────
function isNL() {
  return typeof Neutralino !== 'undefined' &&
    (window.NL_PORT || window.NL_TOKEN || window.NL_CINJECTED);
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Returns the lowercase file extension of a path or filename, e.g. "js", "py". */
function getExt(pathOrName) {
  const name = pathOrName.split(/[\\/]/).pop() || '';
  const dot  = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Returns the OS path separator detected from a path string. */
function getSep(path) {
  return path.includes('\\') ? '\\' : '/';
}

/** Returns the directory part of a file path. */
function getDir(filePath) {
  const sep = getSep(filePath);
  return filePath.substring(0, filePath.lastIndexOf(sep));
}

// ── String helpers ────────────────────────────────────────────────────────────

/** Escapes HTML special characters for safe DOM insertion. */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Status bar ────────────────────────────────────────────────────────────────

/** Shows a temporary message in the status bar, auto-resets after STATUS_TIMEOUT. */
function setStatus(msg) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = 'Ready'; }, STATUS_TIMEOUT);
}

// ── Editor reset helper ───────────────────────────────────────────────────────

/** Clears the editor and shows the welcome screen (called when no tabs remain). */
function resetEditorToWelcome() {
  state.activeTabPath = null;
  editorBusy = true;
  editor.setValue('');
  editorBusy = false;
  hideImagePreview();
  updateBreadcrumbs(null);
  document.getElementById('welcomeScreen').classList.remove('hidden');
  document.getElementById('titleFilePath').textContent = '';
  document.getElementById('statusLang').textContent    = 'Plain Text';
}
