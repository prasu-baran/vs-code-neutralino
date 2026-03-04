// ============================================================================
//  CodeXplorer — context-menu.js
//  Right-click context menu and file/folder CRUD operations.
// ============================================================================

// ── Show / hide ───────────────────────────────────────────────────────────────

function showContextMenu(x, y, isDir) {
  const menu        = document.getElementById('contextMenu');
  const isWorkspace = state.ctxTarget?.type === 'workspace';
  menu.style.display = 'block';

  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = 185, mh = isWorkspace ? 60 : 200;
  menu.style.left = Math.min(x, vw - mw) + 'px';
  menu.style.top  = Math.min(y, vh - mh) + 'px';

  document.getElementById('ctxRemoveFolder').style.display = isWorkspace ? 'flex'  : 'none';
  document.getElementById('ctxRemoveSep').style.display    = isWorkspace ? 'block' : 'none';
  document.getElementById('ctxOpen').style.display        = isWorkspace || isDir ? 'none' : 'flex';

  ['ctxNewFile', 'ctxNewFolder', 'ctxRename', 'ctxDelete'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isWorkspace ? 'none' : '';
  });
  menu.querySelectorAll('.ctx-separator:not(#ctxRemoveSep)').forEach(sep => {
    sep.style.display = isWorkspace ? 'none' : '';
  });
}

function hideContextMenu() {
  document.getElementById('contextMenu').style.display = 'none';
  state.ctxTarget = null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function ctxOpenFile() {
  if (state.ctxTarget?.type === 'file') {
    await openFile(state.ctxTarget.path, state.ctxTarget.name, state.ctxTarget.handle);
  }
}

async function ctxRename() {
  if (!state.ctxTarget) return;
  const { path, name, type } = state.ctxTarget;
  const newName = prompt(`Rename "${name}" to:`, name);
  if (!newName || !newName.trim() || newName.trim() === name) return;

  const sep     = getSep(path);
  const dir     = path.substring(0, path.lastIndexOf(sep));
  const newPath = dir + sep + newName.trim();

  if (!isNL()) { terminalPrint('info', 'Rename requires Neutralino runtime.'); return; }
  try {
    if (type === 'file') {
      const content = await Neutralino.filesystem.readFile(path);
      await Neutralino.filesystem.writeFile(newPath, content);
      await Neutralino.filesystem.remove(path);
      const tab = state.openTabs.find(t => t.path === path);
      if (tab) {
        tab.path = newPath;
        tab.name = newName.trim();
        if (state.activeTabPath === path) state.activeTabPath = newPath;
        const c = state.fileContents.get(path);
        state.fileContents.delete(path);
        state.fileContents.set(newPath, c);
        renderTabs();
      }
    } else {
      alert('Folder renaming is not supported — please use your system file manager.');
      return;
    }
    renderFileTree();
  } catch (err) { terminalPrint('stderr', 'Rename failed: ' + err.message); }
}

async function ctxDelete() {
  if (!state.ctxTarget) return;
  const { path, name, type } = state.ctxTarget;
  if (!confirm(`Delete "${name}"?  This cannot be undone.`)) return;
  if (!isNL()) { terminalPrint('info', 'Delete requires Neutralino runtime.'); return; }

  try {
    const sep = getSep(path);
    if (type === 'dir') await deleteRecursive(path, sep);
    else await Neutralino.filesystem.remove(path);

    state.openTabs = state.openTabs.filter(t => {
      if (t.path === path || t.path.startsWith(path + sep)) {
        state.fileContents.delete(t.path);
        return false;
      }
      return true;
    });

    if (!state.openTabs.find(t => t.path === state.activeTabPath)) {
      const last = state.openTabs[state.openTabs.length - 1];
      if (last) { setActiveTab(last.path); loadEditorContent(last.path, last.name); }
      else       { resetEditorToWelcome(); }
    }
    renderTabs();
    renderFileTree();
    terminalPrint('success', `Deleted: ${name}`);
  } catch (err) { terminalPrint('stderr', 'Delete failed: ' + err.message); }
}

async function deleteRecursive(dirPath, sep) {
  const entries = await Neutralino.filesystem.readDirectory(dirPath);
  for (const e of entries) {
    if (e.entry === '.' || e.entry === '..') continue;
    const fp = dirPath + sep + e.entry;
    if (e.type === 'DIRECTORY') await deleteRecursive(fp, sep);
    else await Neutralino.filesystem.remove(fp);
  }
  await Neutralino.filesystem.remove(dirPath);
}

function removeWorkspaceFolder() {
  const target = state.ctxTarget;
  hideContextMenu();
  if (!target || target.type !== 'workspace') return;

  const prefix = target.path;
  const sep    = getSep(prefix);

  state.openTabs = state.openTabs.filter(t => {
    if (t.path && (t.path === prefix || t.path.startsWith(prefix + sep))) {
      state.fileContents.delete(t.path);
      return false;
    }
    return true;
  });

  if (state.activeTabPath &&
      (state.activeTabPath === prefix || state.activeTabPath.startsWith(prefix + sep))) {
    resetEditorToWelcome();
  }

  state.workspaceFolders = state.workspaceFolders.filter(f => f.path !== prefix);
  renderTabs();
  renderFileTree();
  saveSession();
  setStatus('Folder removed from workspace');
}

// ── Create file / folder ──────────────────────────────────────────────────────

async function ctxNewFile() {
  if (!state.ctxTarget || !isNL()) return;
  const { path, type } = state.ctxTarget;
  const dir = type === 'dir' ? path : path.substring(0, path.lastIndexOf(getSep(path)));
  const sep = getSep(dir);
  const name = prompt('New file name:');
  if (!name?.trim()) return;
  const fp = dir + sep + name.trim();
  try {
    await Neutralino.filesystem.writeFile(fp, '');
    await renderFileTree();
    await openFile(fp, name.trim());
  } catch (err) { terminalPrint('stderr', 'Create file failed: ' + err.message); }
}

async function ctxNewFolder() {
  if (!state.ctxTarget || !isNL()) return;
  const { path, type } = state.ctxTarget;
  const dir = type === 'dir' ? path : path.substring(0, path.lastIndexOf(getSep(path)));
  const sep = getSep(dir);
  const name = prompt('New folder name:');
  if (!name?.trim()) return;
  try {
    await Neutralino.filesystem.createDirectory(dir + sep + name.trim());
    state.expandedNodes.add(path);
    renderFileTree();
  } catch (err) { terminalPrint('stderr', 'Create folder failed: ' + err.message); }
}

// ── New file from sidebar header button ───────────────────────────────────────

async function newFileInRoot() {
  if (state.workspaceFolders.length === 0) { alert('Please open a folder first.'); return; }
  if (!isNL()) { terminalPrint('info', 'File creation requires Neutralino runtime.'); return; }
  const folder = state.workspaceFolders[0];
  const sep    = getSep(folder.path);
  const name   = prompt('New file name:');
  if (!name?.trim()) return;
  const fp = folder.path + sep + name.trim();
  try {
    await Neutralino.filesystem.writeFile(fp, '');
    await renderFileTree();
    await openFile(fp, name.trim());
  } catch (err) { terminalPrint('stderr', 'Create failed: ' + err.message); }
}
