// ============================================================================
//  CodeXplorer — session.js
//  Persist and restore workspace/tab state across app launches.
// ============================================================================

const SESSION_KEY = 'cxSession';

function saveSession() {
  if (!isNL()) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      folders:  state.workspaceFolders
        .filter(f => f.path)
        .map(f => ({ name: f.name, path: f.path })),
      tabs:     state.openTabs.map(t => ({ path: t.path, name: t.name })),
      active:   state.activeTabPath,
      expanded: [...state.expandedNodes],
    }));
  } catch (_) {}
}

async function restoreSession() {
  if (!isNL()) return;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);

    // Restore expanded nodes BEFORE rendering so tree opens correctly
    for (const key of (session.expanded || [])) {
      state.expandedNodes.add(key);
    }

    // Restore workspace folders
    for (const f of (session.folders || [])) {
      if (!state.workspaceFolders.find(w => w.path === f.path)) {
        state.workspaceFolders.push(f);
        state.expandedNodes.add(f.path);   // root is always expanded
        document.getElementById('statusBranch').textContent = f.name;
      }
    }
    if (state.workspaceFolders.length) {
      await renderFileTree();
      startPolling();
    }

    // Reopen tabs (silently skip deleted files)
    for (const tab of (session.tabs || [])) {
      try { await openFile(tab.path, tab.name); } catch (_) {}
    }

    // Restore active tab
    if (session.active) {
      const t = state.openTabs.find(t => t.path === session.active);
      if (t) {
        setActiveTab(t.path);
        loadEditorContent(t.path, t.name);
      }
    }
  } catch (_) {}
}
