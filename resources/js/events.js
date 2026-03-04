// ============================================================================
//  CodeXplorer — events.js
//  All DOM event bindings. Called once from app.js after DOMContentLoaded.
// ============================================================================

function bindAllEvents() {
  _bindThemeEvents();
  _bindSidebarEvents();
  _bindEditorToolbarEvents();
  _bindTerminalEvents();
  _bindAiEvents();
  _bindContextMenuEvents();
  _bindVideoEvents();
  _bindActivityBarEvents();
  _bindFindReplaceEvents();
  _bindGlobalShortcuts();
  _bindResizeDrags();
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function _bindThemeEvents() {
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function _bindSidebarEvents() {
  document.getElementById('addFolderBtn').addEventListener('click', addWorkspaceFolder);
  document.getElementById('openFolderEmptyBtn').addEventListener('click', addWorkspaceFolder);
  document.getElementById('newFileBtn').addEventListener('click', newFileInRoot);
  document.getElementById('refreshTreeBtn').addEventListener('click', renderFileTree);
  document.getElementById('welcomeOpenFolder').addEventListener('click', addWorkspaceFolder);
}

// ── Editor toolbar ────────────────────────────────────────────────────────────

function _bindEditorToolbarEvents() {
  document.getElementById('saveFileBtn').addEventListener('click', saveCurrentFile);
  document.getElementById('runFileBtn').addEventListener('click', runCurrentFile);
  document.getElementById('runCurrentBtn').addEventListener('click', runCurrentFile);
  document.getElementById('wordWrapBtn').addEventListener('click', toggleWordWrap);
  document.getElementById('zoomInBtn').addEventListener('click',  () => setEditorFontSize(+2));
  document.getElementById('zoomOutBtn').addEventListener('click', () => setEditorFontSize(-2));
}

// ── Terminal ──────────────────────────────────────────────────────────────────

function _bindTerminalEvents() {
  document.getElementById('clearTermBtn').addEventListener('click', clearTerminal);
  document.getElementById('toggleTermBtn').addEventListener('click', toggleTerminal);

  document.getElementById('terminalInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const cmd = e.target.value.trim();
      e.target.value = '';
      if (cmd) {
        state.terminalHistory.push(cmd);
        state.terminalHistoryIndex = state.terminalHistory.length;
      }
      runTerminalCommand(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!state.terminalHistory.length) return;
      state.terminalHistoryIndex = Math.max(0, state.terminalHistoryIndex - 1);
      e.target.value = state.terminalHistory[state.terminalHistoryIndex] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.terminalHistoryIndex = Math.min(state.terminalHistory.length, state.terminalHistoryIndex + 1);
      e.target.value = state.terminalHistoryIndex < state.terminalHistory.length
        ? state.terminalHistory[state.terminalHistoryIndex] : '';
    }
  });
}

// ── AI panel ──────────────────────────────────────────────────────────────────

function _bindAiEvents() {
  document.getElementById('saveApiKeyBtn').addEventListener('click', saveApiKey);
  document.getElementById('generateCodeBtn').addEventListener('click', generateCode);
  document.getElementById('insertCodeBtn').addEventListener('click', insertCodeToEditor);
  document.getElementById('clearChatBtn').addEventListener('click', clearAiChat);

  document.getElementById('aiPromptInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); generateCode(); }
  });

  document.getElementById('collapseAiBtn').addEventListener('click', () => {
    const panel  = document.getElementById('aiPanel');
    const btn    = document.getElementById('collapseAiBtn');
    const handle = document.getElementById('aiResizeHandle');
    state.aiPanelCollapsed = !state.aiPanelCollapsed;
    if (state.aiPanelCollapsed) {
      panel.style.width    = '0';
      panel.style.minWidth = '0';
      panel.style.overflow = 'hidden';
      handle.style.display = 'none';
      btn.textContent      = '▶';
    } else {
      panel.style.width    = '';
      panel.style.minWidth = '';
      panel.style.overflow = '';
      handle.style.display = '';
      btn.textContent      = '◀';
    }
  });

  document.getElementById('aiExplainBtn').addEventListener('click',  () => aiQuickAction('explain'));
  document.getElementById('aiFixBtn').addEventListener('click',      () => aiQuickAction('fix'));
  document.getElementById('aiRefactorBtn').addEventListener('click', () => aiQuickAction('refactor'));
}

// ── Context menu ──────────────────────────────────────────────────────────────

function _bindContextMenuEvents() {
  document.getElementById('ctxRemoveFolder').addEventListener('click', removeWorkspaceFolder);
  document.getElementById('ctxOpen').addEventListener('click', async () => {
    await ctxOpenFile(); hideContextMenu();
  });
  document.getElementById('ctxOpenInExplorer').addEventListener('click', async () => {
    await ctxOpenInExplorer(); hideContextMenu();
  });
  document.getElementById('ctxRename').addEventListener('click', async () => {
    await ctxRename(); hideContextMenu();
  });
  document.getElementById('ctxDelete').addEventListener('click', async () => {
    await ctxDelete(); hideContextMenu();
  });
  document.getElementById('ctxNewFile').addEventListener('click', async () => {
    await ctxNewFile(); hideContextMenu();
  });
  document.getElementById('ctxNewFolder').addEventListener('click', async () => {
    await ctxNewFolder(); hideContextMenu();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#contextMenu')) hideContextMenu();
  });
}

// ── Video modal ───────────────────────────────────────────────────────────────

function _bindVideoEvents() {
  document.getElementById('closeVideoBtn').addEventListener('click', closeVideoPlayer);
  document.getElementById('videoModal').addEventListener('click', e => {
    if (e.target.id === 'videoModal') closeVideoPlayer();
  });
}

// ── Activity bar (Explorer / Search) ─────────────────────────────────────────

function _bindActivityBarEvents() {
  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const panel      = btn.dataset.panel;
      const explorerEl = document.getElementById('explorerPanel');
      const searchEl   = document.getElementById('searchPanel');
      if (panel === 'explorer') {
        explorerEl.style.display = 'flex';
        searchEl.style.display   = 'none';
      } else if (panel === 'search') {
        explorerEl.style.display = 'none';
        searchEl.style.display   = 'flex';
        setTimeout(() => document.getElementById('searchFilesInput').focus(), 50);
      }
    });
  });

  let _searchDebounce = null;
  document.getElementById('searchFilesInput').addEventListener('input', e => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => searchInFiles(e.target.value), 400);
  });
  document.getElementById('searchFilesInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(_searchDebounce); searchInFiles(e.target.value); }
  });
}

// ── Find / Replace bar ────────────────────────────────────────────────────────

function _bindFindReplaceEvents() {
  document.getElementById('findPrevBtn').addEventListener('click',   findPrev);
  document.getElementById('findNextBtn').addEventListener('click',   findNext);
  document.getElementById('replaceOneBtn').addEventListener('click', replaceOne);
  document.getElementById('replaceAllBtn').addEventListener('click', replaceAll);
  document.getElementById('closeFindBtn').addEventListener('click',  closeFindBar);
  document.getElementById('findInput').addEventListener('input', performFind);
  document.getElementById('findInput').addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.shiftKey ? findPrev() : findNext(); }
    if (e.key === 'Escape') { closeFindBar(); }
  });
  document.getElementById('replaceInput').addEventListener('keydown', e => {
    if (e.key === 'Escape') closeFindBar();
  });
}

// ── Global keyboard shortcuts ─────────────────────────────────────────────────

function _bindGlobalShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 's')  { e.preventDefault(); saveCurrentFile(); }
    if (e.ctrlKey && e.key === 'n')  { e.preventDefault(); newFileInRoot(); }
    if (e.ctrlKey && e.key === 'w')  { e.preventDefault(); if (state.activeTabPath) closeTab(state.activeTabPath); }
    if (e.ctrlKey && e.key === '`')  { e.preventDefault(); toggleTerminal(); }
    if (e.ctrlKey && e.key === 'f' && !editor?.hasFocus()) { e.preventDefault(); openFindBar(false); }
    if (e.ctrlKey && e.key === 'h' && !editor?.hasFocus()) { e.preventDefault(); openFindBar(true);  }
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      document.querySelector('.activity-btn[data-panel="search"]')?.click();
    }
    if (e.key === 'F3' && !e.ctrlKey) { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); setEditorFontSize(+2); }
    if (e.ctrlKey && e.key === '-')  { e.preventDefault(); setEditorFontSize(-2); }
    if (e.ctrlKey && e.key === '0')  { e.preventDefault(); setEditorFontSize(14 - state.editorFontSize); }
    if (e.key === 'Escape') {
      hideContextMenu();
      if (document.getElementById('findBar').style.display !== 'none') closeFindBar();
    }
  });
}

// ── Resize drags ──────────────────────────────────────────────────────────────

function _bindResizeDrags() {
  setupResizeDrag(
    document.getElementById('sidebarResizeHandle'),
    document.getElementById('sidebar'),
    'width', SIDEBAR_MIN, SIDEBAR_MAX
  );
  setupResizeDrag(
    document.getElementById('aiResizeHandle'),
    document.getElementById('aiPanel'),
    'width', AI_PANEL_MIN, AI_PANEL_MAX,
    true   // inverted: drag left = wider
  );
}

// ── Resize drag helper ────────────────────────────────────────────────────────

function setupResizeDrag(handle, target, prop, min, max, inverted = false) {
  let startX = 0, startSize = 0;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX    = e.clientX;
    startSize = parseInt(getComputedStyle(target)[prop], 10);
    handle.classList.add('dragging');

    const onMove = e2 => {
      const delta   = inverted ? startX - e2.clientX : e2.clientX - startX;
      const newSize = Math.max(min, Math.min(max, startSize + delta));
      target.style[prop] = newSize + 'px';
      editor && editor.refresh();
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}
