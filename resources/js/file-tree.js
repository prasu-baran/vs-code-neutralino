// ============================================================================
//  CodeXplorer — file-tree.js
//  Workspace folder management and file-tree rendering.
// ============================================================================

// ── Workspace folder ──────────────────────────────────────────────────────────

async function addWorkspaceFolder() {
  try {
    let folder;
    if (isNL()) {
      const path = await Neutralino.os.showFolderDialog('Open Folder', { defaultPath: 'C:\\Users' });
      if (!path) return;
      folder = { name: path.split(/[\\/]/).pop(), path };
    } else if (window.showDirectoryPicker) {
      const handle = await window.showDirectoryPicker();
      folder = { name: handle.name, handle };
    } else {
      throw new Error('No folder picker available');
    }

    state.workspaceFolders.push(folder);
    state.expandedNodes.add(folder.path || folder.name);
    await renderFileTree();
    startPolling();
    updateGitStatus(folder.path);
    document.getElementById('statusBranch').textContent = folder.name;
    saveSession();
  } catch (err) {
    if (err.name !== 'AbortError') terminalPrint('stderr', 'Open folder failed: ' + err.message);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

async function renderFileTree() {
  if (_renderingTree) return;
  _renderingTree = true;
  try {
    await _renderFileTreeInner(document.getElementById('fileTree'));
  } finally {
    _renderingTree = false;
  }
}

async function _renderFileTreeInner(treeEl) {
  if (state.workspaceFolders.length === 0) {
    treeEl.innerHTML = `
      <div class="no-folder-msg">
        <p>No folder opened</p>
        <button id="openFolderEmptyBtn" class="btn-primary">Open Folder</button>
      </div>`;
    document.getElementById('openFolderEmptyBtn')
      .addEventListener('click', addWorkspaceFolder);
    return;
  }

  treeEl.innerHTML = '';
  for (const folder of state.workspaceFolders) {
    const key        = folder.path || folder.name;
    const isExpanded = state.expandedNodes.has(key);

    const header = document.createElement('div');
    header.className = 'tree-workspace-header';
    header.innerHTML = `
      <span class="tree-node-chevron ${isExpanded ? 'expanded' : ''}">›</span>
      <span style="margin-left:4px">${folder.name.toUpperCase()}</span>`;

    header.addEventListener('click', () => {
      if (state.expandedNodes.has(key)) state.expandedNodes.delete(key);
      else state.expandedNodes.add(key);
      renderFileTree();
      saveSession();
    });
    header.addEventListener('contextmenu', e => {
      e.preventDefault();
      state.ctxTarget = { path: folder.path, type: 'workspace', name: folder.name };
      showContextMenu(e.clientX, e.clientY, true);
    });

    const wsDiv = document.createElement('div');
    wsDiv.className = 'tree-workspace';
    wsDiv.appendChild(header);

    if (isExpanded) {
      const childContainer = document.createElement('div');
      await buildTreeChildren(childContainer, folder, 1);
      wsDiv.appendChild(childContainer);
    }

    treeEl.appendChild(wsDiv);
  }
}

async function buildTreeChildren(container, parentNode, depth) {
  let entries = [];
  const sortEntries = arr =>
    arr.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'DIRECTORY' ? -1 : 1;
      return a.entry.localeCompare(b.entry, undefined, { sensitivity: 'base' });
    });

  try {
    if (parentNode.path) {
      const raw = await Neutralino.filesystem.readDirectory(parentNode.path);
      entries = sortEntries(raw.filter(e => e.entry !== '.' && e.entry !== '..'));
    } else if (parentNode.handle) {
      for await (const [name, handle] of parentNode.handle.entries()) {
        entries.push({ entry: name, type: handle.kind === 'directory' ? 'DIRECTORY' : 'FILE', handle });
      }
      sortEntries(entries);
    }
  } catch (err) {
    console.error('readDirectory error:', err);
    return;
  }

  const sep      = parentNode.path ? getSep(parentNode.path) : '/';
  const basePath = parentNode.path || '';

  for (const entry of entries) {
    const isDir      = entry.type === 'DIRECTORY';
    const entryPath  = basePath ? basePath + sep + entry.entry : entry.entry;
    const isExpanded = state.expandedNodes.has(entryPath);

    const row = document.createElement('div');
    row.className    = `tree-node${!isDir && state.activeTabPath === entryPath ? ' active' : ''}`;
    row.dataset.path = entryPath;
    row.dataset.type = isDir ? 'dir' : 'file';
    row.dataset.name = entry.entry;
    row.innerHTML = `
      <span class="tree-node-indent" style="width:${depth * 12}px;flex-shrink:0"></span>
      <span class="tree-node-chevron ${isDir ? (isExpanded ? 'expanded' : '') : 'file-node'}">${isDir ? '›' : ''}</span>
      <span class="tree-node-ext">${isDir ? '' : fileIcon(entry.entry)}</span>
      <span class="tree-node-name">${entry.entry}</span>`;

    row.addEventListener('click', async e => {
      e.stopPropagation();
      if (isDir) {
        if (state.expandedNodes.has(entryPath)) state.expandedNodes.delete(entryPath);
        else state.expandedNodes.add(entryPath);
        renderFileTree();
        saveSession();
      } else {
        await openFile(entryPath, entry.entry, entry.handle || null);
      }
    });

    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      state.ctxTarget = {
        path: entryPath, type: isDir ? 'dir' : 'file',
        name: entry.entry, handle: entry.handle || null, parentPath: basePath,
      };
      showContextMenu(e.clientX, e.clientY, isDir);
    });

    container.appendChild(row);

    if (isDir && isExpanded) {
      const sub      = document.createElement('div');
      const childNode = parentNode.path ? { path: entryPath } : { handle: entry.handle };
      await buildTreeChildren(sub, childNode, depth + 1);
      container.appendChild(sub);
    }
  }
}

// ── File icon ─────────────────────────────────────────────────────────────────

function fileIcon(name) {
  const ext = getExt(name);
  if (!ext || ext === name.toLowerCase()) return '';
  return ext.length <= 4 ? ext : ext.slice(0, 4);
}
