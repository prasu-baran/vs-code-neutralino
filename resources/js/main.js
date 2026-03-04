// ============================================================================
//  CodeXplorer — main.js
//  VS Code-like IDE powered by NeutralinoJS + HuggingFace AI
// ============================================================================

// ── State ──────────────────────────────────────────────────────────────────
const state = {
	// Workspace
  workspaceFolders: [],   // [{name, path}]  (neutralino) | [{name, handle}] (web)
  expandedNodes:    new Set(),

  // Editor / Tabs
  openTabs:       [],           // [{path, name, modified}]
  activeTabPath:  null,
  fileContents:   new Map(),    // path → string

  // UI
  theme:             localStorage.getItem('cxTheme') || 'dark',
  terminalCollapsed: false,
  aiPanelCollapsed:  false,

  // AI (HuggingFace)
  hfApiKey:          localStorage.getItem('hfApiKey') || '',
  lastGeneratedCode: '',

  // Context menu
  ctxTarget: null,   // {path, type:'file'|'dir', name}

  // Polling
  pollingTimer:      null,
  pollingSnapshot:   null,

  // Terminal history
  terminalHistory:      [],
  terminalHistoryIndex: -1,

  // Editor settings (persisted)
  editorFontSize: parseInt(localStorage.getItem('cxFontSize'), 10) || 14,
  wordWrap:       localStorage.getItem('cxWordWrap') === 'true',
};

// CodeMirror instance
let editor = null;
let editorBusy = false;   // guard to avoid recursive change events

// Find / Replace state
let findMarks   = [];
let findMatches = [];
let findIndex   = -1;

// ============================================================================
//  BOOTSTRAP
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

// ============================================================================
//  NEUTRALINO INIT
// ============================================================================

function isNL() {
  return typeof Neutralino !== 'undefined' &&
         (window.NL_PORT || window.NL_TOKEN || window.NL_CINJECTED);
}

function initNeutralino() {
  if (isNL()) {
    try {
      Neutralino.init();
      Neutralino.events.on('windowClose', () => {
        stopPolling();
        Neutralino.app.exit();
      });
    } catch (e) {
      console.warn('Neutralino.init() failed:', e);
    }
  } else {
    console.log('Running in browser mode (no Neutralino runtime).');
  }
}

// ============================================================================
//  THEME
// ============================================================================

function applyTheme(theme) {
  state.theme = theme;
  document.body.className = `theme-${theme}`;
  localStorage.setItem('cxTheme', theme);
  document.getElementById('themeToggleBtn').textContent = theme === 'dark' ? 'Light' : 'Dark';
  if (editor) editor.setOption('theme', theme === 'dark' ? 'one-dark' : 'eclipse');
}

function toggleTheme() { applyTheme(state.theme === 'dark' ? 'light' : 'dark'); }

// ============================================================================
//  CODEMIRROR
// ============================================================================

function initCodeMirror() {
	const textarea = document.getElementById('codeTextarea');
  if (!textarea) return;

  const cmTheme = state.theme === 'dark' ? 'one-dark' : 'eclipse';

  editor = CodeMirror.fromTextArea(document.getElementById('codeTextarea'), {
    lineNumbers:      true,
    theme:            cmTheme,
    matchBrackets:    true,
    autoCloseBrackets:true,
    styleActiveLine:  true,
    lineWrapping:     state.wordWrap,
    tabSize:          2,
    indentWithTabs:   false,
    mode:             'text/plain',
    foldGutter:       true,
    gutters:          ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    extraKeys: {
      'Ctrl-S':     () => saveCurrentFile(),
      'Ctrl-Enter': () => runCurrentFile(),
      'Ctrl-F':     () => openFindBar(false),
      'Ctrl-H':     () => openFindBar(true),
      'F3':         () => findNext(),
      'Shift-F3':   () => findPrev(),
      'Ctrl-Space': cm => CodeMirror.showHint(cm, CodeMirror.hint.anyword),
      'Alt-Z':      () => toggleWordWrap(),
      'Escape':     () => {
        if (document.getElementById('findBar').style.display !== 'none') closeFindBar();
      },
    },
  });

  // Apply saved font size
  requestAnimationFrame(() => {
    const cm = document.querySelector('.CodeMirror');
    if (cm && state.editorFontSize !== 14) cm.style.fontSize = state.editorFontSize + 'px';
    const wwBtn = document.getElementById('wordWrapBtn');
    if (wwBtn) wwBtn.classList.toggle('active-btn', state.wordWrap);
  });

  editor.on('change', () => {
    if (editorBusy || !state.activeTabPath) return;
    const content = editor.getValue();
    state.fileContents.set(state.activeTabPath, content);
    markTabModified(state.activeTabPath, true);
  });

  editor.on('cursorActivity', () => {
    const cur = editor.getCursor();
    document.getElementById('statusCursor').textContent =
      `Ln ${cur.line + 1}, Col ${cur.ch + 1}`;
  });
}

// ============================================================================
//  FILE TREE
// ============================================================================

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
    const key = folder.path || folder.name;
    state.expandedNodes.add(key);
    await renderFileTree();
    startPolling();
    document.getElementById('statusBranch').textContent = folder.name;
    saveSession();
  } catch (err) {
    if (err.name !== 'AbortError') terminalPrint('stderr', 'Open folder failed: ' + err.message);
  }
}

let _renderingTree = false;   // mutex — prevents concurrent tree renders

async function renderFileTree() {
  if (_renderingTree) return;   // drop concurrent calls; the in-flight one will finish
  _renderingTree = true;
  const treeEl = document.getElementById('fileTree');
  try {
    await _renderFileTreeInner(treeEl);
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
    const wsDiv = document.createElement('div');
    wsDiv.className = 'tree-workspace';

    const key = folder.path || folder.name;
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
  try {
    if (parentNode.path) {
      const raw = await Neutralino.filesystem.readDirectory(parentNode.path);
      entries = raw
        .filter(e => e.entry !== '.' && e.entry !== '..')
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'DIRECTORY' ? -1 : 1;
          return a.entry.localeCompare(b.entry, undefined, { sensitivity: 'base' });
        });
    } else if (parentNode.handle) {
      for await (const [name, handle] of parentNode.handle.entries()) {
        entries.push({ entry: name, type: handle.kind === 'directory' ? 'DIRECTORY' : 'FILE', handle });
      }
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'DIRECTORY' ? -1 : 1;
        return a.entry.localeCompare(b.entry, undefined, { sensitivity: 'base' });
      });
    }
  } catch (err) {
    console.error('readDirectory error:', err);
    return;
  }

  const sep = parentNode.path ? (parentNode.path.includes('\\') ? '\\' : '/') : '/';
  const basePath = parentNode.path || '';

  for (const entry of entries) {
    const isDir   = entry.type === 'DIRECTORY';
    const entryPath = basePath ? basePath + sep + entry.entry : entry.entry;
    const nodeKey   = entryPath;
    const isExpanded = state.expandedNodes.has(nodeKey);
    const extBadge = isDir ? '' : fileIcon(entry.entry);

    const row = document.createElement('div');
    row.className  = `tree-node${!isDir && state.activeTabPath === entryPath ? ' active' : ''}`;
    row.dataset.path = entryPath;
    row.dataset.type = isDir ? 'dir' : 'file';
    row.dataset.name = entry.entry;

    const indent = depth * 12;
    row.innerHTML = `
      <span class="tree-node-indent" style="width:${indent}px;flex-shrink:0"></span>
      <span class="tree-node-chevron ${isDir ? (isExpanded ? 'expanded' : '') : 'file-node'}">${isDir ? '›' : ''}</span>
      <span class="tree-node-ext">${extBadge}</span>
      <span class="tree-node-name">${entry.entry}</span>`;

    row.addEventListener('click', async e => {
      e.stopPropagation();
      if (isDir) {
        if (state.expandedNodes.has(nodeKey)) state.expandedNodes.delete(nodeKey);
        else state.expandedNodes.add(nodeKey);
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
        path: entryPath,
        type: isDir ? 'dir' : 'file',
        name: entry.entry,
        handle: entry.handle || null,
        parentPath: basePath,
      };
      showContextMenu(e.clientX, e.clientY, isDir);
    });

    container.appendChild(row);

    if (isDir && isExpanded) {
      const sub = document.createElement('div');
      const childNode = parentNode.path
        ? { path: entryPath }
        : { handle: entry.handle };
      await buildTreeChildren(sub, childNode, depth + 1);
      container.appendChild(sub);
    }
  }
}

function fileIcon(name) {
  // Returns a short monospace extension label instead of emoji
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!ext || ext === name.toLowerCase()) return '';
  return ext.length <= 4 ? ext : ext.slice(0, 4);
}

// ============================================================================
//  OPEN / READ FILE
// ============================================================================

const VIDEO_EXTS  = new Set(['mp4','avi','mkv','webm','mov','flv','m4v','wmv','3gp','ogv']);
const IMAGE_EXTS  = new Set(['png','jpg','jpeg','gif','bmp','ico','webp','svg']);
const BINARY_EXTS = new Set(['zip','rar','tar','gz','exe','dll','so','pdf','mp3','wav','flac']);

async function openFile(filePath, fileName, handle = null) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  if (VIDEO_EXTS.has(ext))  { playVideo(filePath, fileName); return; }
  if (IMAGE_EXTS.has(ext)) {
    if (!state.openTabs.find(t => t.path === filePath)) {
      state.openTabs.push({ path: filePath, name: fileName, modified: false });
    }
    setActiveTab(filePath);
    showImagePreview(filePath, fileName);
    saveSession();
    return;
  }
  if (BINARY_EXTS.has(ext)) {
    terminalPrint('info', `Binary file — cannot display in editor: ${fileName}`);
    return;
  }

  // Add tab (if not already open)
  if (!state.openTabs.find(t => t.path === filePath)) {
    state.openTabs.push({ path: filePath, name: fileName, modified: false });
  }
  setActiveTab(filePath);

  // Load content if not cached
  if (!state.fileContents.has(filePath)) {
    try {
      let content = '';
      if (isNL() && !handle) {
        content = await Neutralino.filesystem.readFile(filePath);
      } else if (handle) {
        const file = await handle.getFile();
        content = await file.text();
      }
      state.fileContents.set(filePath, content);
    } catch (err) {
      terminalPrint('stderr', 'Read error: ' + err.message);
      return;
    }
  }

  loadEditorContent(filePath, fileName);
  saveSession();
}

function loadEditorContent(filePath, fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  // Image files: show preview instead of code editor
  if (IMAGE_EXTS.has(ext)) {
    showImagePreview(filePath, fileName);
    return;
  }

  hideImagePreview();

  const content = state.fileContents.get(filePath) || '';
  editorBusy = true;
  editor.setValue(content);
  editor.setOption('mode', cmMode(ext));
  editor.clearHistory();
  editorBusy = false;

  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('statusLang').textContent = langName(ext);
  editor.refresh();
  editor.focus();
}

function cmMode(ext) {
  return ({
    js:'javascript', jsx:'javascript', ts:'javascript', tsx:'javascript',
    py:'python',
    c:'text/x-csrc', cpp:'text/x-c++src', cc:'text/x-c++src',
    java:'text/x-java', cs:'text/x-csharp',
    html:'htmlmixed', htm:'htmlmixed',
    css:'css', scss:'css', less:'css',
    xml:'xml', svg:'xml',
    sh:'shell', bash:'shell',
    rs:'rust',
    go:'go',
    md:'markdown',
    json:{ name:'javascript', json:true },
  })[ext] || 'text/plain';
}

function langName(ext) {
  return ({
    js:'JavaScript', jsx:'JSX', ts:'TypeScript', tsx:'TSX',
    py:'Python', rb:'Ruby', go:'Go', rs:'Rust',
    java:'Java', cs:'C#', cpp:'C++', c:'C',
    html:'HTML', htm:'HTML', css:'CSS', scss:'SCSS', less:'LESS',
    json:'JSON', xml:'XML', yaml:'YAML', yml:'YAML', toml:'TOML',
    md:'Markdown', txt:'Plain Text', sh:'Shell', bash:'Shell', bat:'Batch',
    sql:'SQL',
  })[ext] || 'Plain Text';
}

// ============================================================================
//  TABS
// ============================================================================

function setActiveTab(filePath) {
  state.activeTabPath = filePath;
  renderTabs();
  document.getElementById('titleFilePath').textContent = filePath;
  // Highlight active file in tree
  document.querySelectorAll('.tree-node').forEach(n => {
    n.classList.toggle('active', n.dataset.path === filePath);
  });
  updateBreadcrumbs(filePath);
}

function renderTabs() {
  const list = document.getElementById('tabsList');
  list.innerHTML = '';
  for (const tab of state.openTabs) {
    const div = document.createElement('div');
    div.className = `tab${tab.path === state.activeTabPath ? ' active' : ''}${tab.modified ? ' modified' : ''}`;
    div.innerHTML = `<span class="tab-name">${tab.name}</span>
                     <button class="tab-close" title="Close">×</button>`;

    div.addEventListener('click', e => {
      if (e.target.classList.contains('tab-close')) return;
      setActiveTab(tab.path);
      loadEditorContent(tab.path, tab.name);
    });
    div.querySelector('.tab-close').addEventListener('click', e => {
      e.stopPropagation();
      closeTab(tab.path);
    });
    list.appendChild(div);
  }
}

function closeTab(filePath) {
  const tab = state.openTabs.find(t => t.path === filePath);
  if (tab && tab.modified) {
    const save = confirm(`Save changes to "${tab.name}" before closing?`);
    if (save) saveFile(filePath, state.fileContents.get(filePath));
  }
  state.openTabs     = state.openTabs.filter(t => t.path !== filePath);
  state.fileContents.delete(filePath);

  if (state.activeTabPath === filePath) {
    const next = state.openTabs[state.openTabs.length - 1];
    if (next) {
      setActiveTab(next.path);
      loadEditorContent(next.path, next.name);
    } else {
      state.activeTabPath = null;
      editorBusy = true;
      editor.setValue('');
      editorBusy = false;
      hideImagePreview();
      document.getElementById('welcomeScreen').classList.remove('hidden');
      document.getElementById('titleFilePath').textContent = '';
      document.getElementById('statusLang').textContent    = 'Plain Text';
      updateBreadcrumbs(null);
    }
  }
  renderTabs();
  saveSession();
}

function markTabModified(filePath, modified) {
  const tab = state.openTabs.find(t => t.path === filePath);
  if (tab) { tab.modified = modified; renderTabs(); }
}

// ============================================================================
//  SAVE
// ============================================================================

async function saveCurrentFile() {
  if (!state.activeTabPath) return;
  await saveFile(state.activeTabPath, editor.getValue());
}

async function saveFile(filePath, content) {
  if (!isNL()) {
    terminalPrint('info', 'Save requires Neutralino runtime.');
    return;
  }
  try {
    await Neutralino.filesystem.writeFile(filePath, content);
    state.fileContents.set(filePath, content);
    markTabModified(filePath, false);
    setStatus('Saved ' + filePath.split(/[\\/]/).pop());
    terminalPrint('success', `Saved: ${filePath}`);
  } catch (err) {
    terminalPrint('stderr', 'Save failed: ' + err.message);
  }
}

// ============================================================================
//  RUN FILE
// ============================================================================

async function runCurrentFile() {
  if (!state.activeTabPath) {
    terminalPrint('info', 'No file open to run.');
    return;
  }
  if (!isNL()) {
    terminalPrint('info', 'Code execution requires Neutralino runtime.');
    return;
  }

  await saveCurrentFile();

  const fp   = state.activeTabPath;
  const ext  = (fp.split('.').pop() || '').toLowerCase();
  const sep  = fp.includes('\\') ? '\\' : '/';
  const dir  = fp.substring(0, fp.lastIndexOf(sep));
  const fname = fp.split(sep).pop();                         // just filename.ext
  const bare  = fname.replace(/\.[^.]+$/, '');               // filename without ext

  // Interpreted languages: single execCommand call (cwd sets working dir).
  const interpretedCmds = {
    py:   `python -u "${fname}"`,
    js:   `node "${fname}"`,
    ts:   `npx ts-node "${fname}"`,
    go:   `go run "${fname}"`,
    rb:   `ruby "${fname}"`,
    php:  `php "${fname}"`,
    sh:   `bash "${fname}"`,
    bat:  `cmd /c "${fname}"`,
    html: `start "" "${fp}"`,
  };

  // Backslash-normalised full paths (needed for Windows compiler args).
  const fpNative  = fp.replace(/\//g, '\\');
  const dirNative = dir.replace(/\//g, '\\');
  const exePath   = `${dirNative}\\${bare}.exe`;

  // PowerShell single-quote-escaped versions of paths ('' escapes a literal ' in PS).
  const fpPS  = fpNative.replace(/'/g, "''");
  const exePS = exePath.replace(/'/g, "''");
  const dirPS = dirNative.replace(/'/g, "''");

  // Compiled languages: TWO separate execCommand calls — compile, then run.
  //
  // Both steps use { cwd: dir } — this is CreateProcess mode in Neutralino, which
  // correctly pipes stdout/stderr (same mode that makes Python work).
  //
  // Compile commands are wrapped in PowerShell with an explicit PATH reset from the
  // Windows registry. This ensures compilers installed via MSYS2/MinGW (which add
  // to the USER registry PATH) are found even when Neutralino inherits a stale or
  // system-only PATH. `2>&1` merges compiler stderr into stdout for capture.
  const psPath = `$env:PATH=[System.Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[System.Environment]::GetEnvironmentVariable('PATH','User')`;
  const compiledSteps = {
    c:    { compile: `powershell -NoProfile -Command "${psPath}; gcc '${fpPS}' -o '${exePS}' 2>&1"`,   run: `"${exePath}"` },
    cpp:  { compile: `powershell -NoProfile -Command "${psPath}; g++ '${fpPS}' -o '${exePS}' 2>&1"`,   run: `"${exePath}"` },
    cc:   { compile: `powershell -NoProfile -Command "${psPath}; g++ '${fpPS}' -o '${exePS}' 2>&1"`,   run: `"${exePath}"` },
    java: { compile: `powershell -NoProfile -Command "${psPath}; javac '${fpPS}' 2>&1"`,                run: `powershell -NoProfile -Command "${psPath}; java -cp '${dirPS}' ${bare} 2>&1"` },
    rs:   { compile: `powershell -NoProfile -Command "${psPath}; rustc '${fpPS}' -o '${exePS}' 2>&1"`, run: `"${exePath}"` },
  };

  // Shown when compilation exits non-zero AND produces no output (compiler not found).
  const COMPILER_NOT_FOUND = {
    c:    'gcc not found.  Install MinGW-w64 (https://www.msys2.org) and add its bin directory to PATH.',
    cpp:  'g++ not found.  Install MinGW-w64 (https://www.msys2.org) and add its bin directory to PATH.',
    cc:   'g++ not found.  Install MinGW-w64 (https://www.msys2.org) and add its bin directory to PATH.',
    java: 'javac not found.  Install JDK from https://adoptium.net and ensure JAVA_HOME/bin is in PATH.',
    rs:   'rustc not found.  Install Rust via rustup: https://rustup.rs',
  };

  try {
    if (compiledSteps[ext]) {
      const { compile, run } = compiledSteps[ext];

      // --- Compile step (CreateProcess mode via cwd — same as Python, captures output) ---
      const compileDisplay = compile.replace(/^powershell -NoProfile -Command ".+?; (.+) 2>&1"$/, '$1').replace(/'/g, '"');
      terminalPrint('command', `> Compiling: ${compileDisplay}`);
      setStatus('Compiling…');
      const compileResult = await Neutralino.os.execCommand(compile, { cwd: dir });
      const compileOut = (compileResult.stdOut || '').trim();
      const compileErr = (compileResult.stdErr || '').trim();
      if (compileOut) compileOut.split('\n').forEach(l => l.trim() && terminalPrint('stderr', l));
      if (compileErr) compileErr.split('\n').forEach(l => l.trim() && terminalPrint('stderr', l));

      if (compileResult.exitCode !== 0) {
        if (!compileOut && !compileErr) {
          terminalPrint('warn', COMPILER_NOT_FOUND[ext] || 'Compiler not found. Ensure it is installed and in PATH.');
        }
        terminalPrint('stderr', `Compilation failed (exit code ${compileResult.exitCode})`);
        setStatus(`Compile error (code ${compileResult.exitCode})`);
        return;
      }
      terminalPrint('info', 'Compilation successful.');

      // --- Run step (cwd so program's working directory is the source folder) ---
      terminalPrint('command', `> Running: ${run}`);
      setStatus('Running…');
      const runResult = await Neutralino.os.execCommand(run, { cwd: dir });
      const runOut = (runResult.stdOut || '').trim();
      const runErr = (runResult.stdErr || '').trim();
      if (runOut) runOut.split('\n').forEach(l => l.trim() && terminalPrint('stdout', l));
      if (runErr) runErr.split('\n').forEach(l => l.trim() && terminalPrint('stderr', l));

      if (runResult.exitCode === 0) {
        terminalPrint('success', `Process exited with code 0`);
        setStatus('Done');
      } else {
        terminalPrint('stderr', `Process exited with code ${runResult.exitCode}`);
        setStatus(`Error (code ${runResult.exitCode})`);
      }

    } else if (interpretedCmds[ext]) {
      const cmd = interpretedCmds[ext];
      terminalPrint('command', `> ${fname}  [${cmd}]`);
      setStatus('Running…');
      const result  = await Neutralino.os.execCommand(cmd, { cwd: dir });
      const rOut = (result.stdOut || '').trim();
      const rErr = (result.stdErr || '').trim();
      if (rOut) rOut.split('\n').forEach(l => l.trim() && terminalPrint('stdout', l));
      if (rErr) rErr.split('\n').forEach(l => l.trim() && terminalPrint('stderr', l));

      if (result.exitCode === 0) {
        terminalPrint('success', `Process exited with code 0`);
        setStatus('Done');
      } else {
        terminalPrint('stderr', `Process exited with code ${result.exitCode}`);
        setStatus(`Error (code ${result.exitCode})`);
      }

    } else {
      terminalPrint('warn', `No runner configured for .${ext} files.`);
    }
  } catch (err) {
    terminalPrint('stderr', 'Execution failed: ' + err.message);
    setStatus('Run failed');
  }
}

// ============================================================================
//  TERMINAL
// ============================================================================

function terminalPrint(type, text) {
  const out  = document.getElementById('terminalOutput');
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.textContent = text;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function clearTerminal() { document.getElementById('terminalOutput').innerHTML = ''; }

function toggleTerminal() {
  state.terminalCollapsed = !state.terminalCollapsed;
  document.getElementById('terminalPanel')
          .classList.toggle('collapsed', state.terminalCollapsed);
  document.getElementById('toggleTermBtn').textContent =
    state.terminalCollapsed ? '^' : 'v';
}

async function runTerminalCommand(cmd) {
  if (!cmd.trim()) return;
  terminalPrint('command', '$ ' + cmd);
  if (!isNL()) { terminalPrint('info', 'Shell commands require Neutralino runtime.'); return; }
  try {
    // Use cwd of the active file's directory, or the first workspace folder as fallback.
    const cwd = state.activeTabPath
      ? state.activeTabPath.substring(0, state.activeTabPath.lastIndexOf(state.activeTabPath.includes('\\') ? '\\' : '/'))
      : (state.workspaceFolders[0]?.path || undefined);

    const r = await Neutralino.os.execCommand(cmd, cwd ? { cwd } : {});
    // Neutralino returns stdOut / stdErr (camelCase)
    if (r.stdOut) r.stdOut.split('\n').forEach(l => l && terminalPrint('stdout', l));
    if (r.stdErr) r.stdErr.split('\n').forEach(l => l && terminalPrint('stderr', l));
    if (r.exitCode !== 0) terminalPrint('warn', `Exit code: ${r.exitCode}`);
  } catch (err) {
    terminalPrint('stderr', err.message);
  }
}

// ============================================================================
//  GEMINI AI
// ============================================================================

function setApiStatus(type, msg) {
  const el = document.getElementById('apiKeyStatus');
  el.className = 'api-status ' + type;
  el.textContent = msg;
}

// HuggingFace model used for all AI features
// Endpoint migrated from api-inference.huggingface.co → router.huggingface.co (deprecated in 2025)
const HF_MODEL = 'Qwen/Qwen2.5-Coder-32B-Instruct';
const HF_API   = 'https://router.huggingface.co/v1/chat/completions';

// ── Native HTTP via curl ──────────────────────────────────────────────────────
// fetch() is CORS-blocked in NeutralinoJS WebView for external APIs.
// Instead, route requests through curl.exe (built into Windows 10+) via
// execCommand — runs in the OS process so CORS does not apply.
async function hfRequest(messages, { maxTokens = 4096, temperature = 0.7 } = {}) {
  const key = state.hfApiKey;
  if (!key) throw Object.assign(new Error('No API key'), { code: 'NO_KEY' });

  const payload = JSON.stringify({
    model: HF_MODEL, messages, max_tokens: maxTokens, temperature, stream: false,
  });

  // Use forward slashes everywhere — curl on Windows accepts them, and they avoid
  // backslash escape-sequence corruption in curl config quoted string values (\t, \n etc.)
  const rawTmp  = await Neutralino.os.getEnv('TEMP');
  const tmpFwd  = rawTmp.replace(/\\/g, '/').replace(/\/$/, '');
  const bodyFwd = tmpFwd + '/cx_hf_body.json';
  const cfgFwd  = tmpFwd + '/cx_hf_cfg.txt';
  const respFwd = tmpFwd + '/cx_hf_resp.json';

  // Write JSON payload
  await Neutralino.filesystem.writeFile(bodyFwd, payload);

  // Build curl config file — avoids ALL command-line quoting issues with auth headers.
  // Paths use forward slashes; curl handles them fine on Windows.
  const curlCfg = [
    `url = "${HF_API}"`,
    `request = "POST"`,
    `header = "Authorization: Bearer ${key}"`,
    `header = "Content-Type: application/json"`,
    `data-binary = "@${bodyFwd}"`,
    `output = "${respFwd}"`,
    `write-out = "%{http_code}"`,
    `silent`,
  ].join('\n');

  await Neutralino.filesystem.writeFile(cfgFwd, curlCfg);

  try {
    // curl.exe is built into Windows 10+ (1803+) at System32 — no PATH lookup needed
    const r = await Neutralino.os.execCommand(
      `"C:\\Windows\\System32\\curl.exe" -K "${cfgFwd}"`,
      { cwd: tmpFwd }
    );

    // stdOut = just the HTTP status code from write-out; response body is in the output file
    const status = parseInt((r.stdOut || '').trim(), 10) || 0;

    let data = {};
    try {
      const body = await Neutralino.filesystem.readFile(respFwd);
      data = JSON.parse(body);
    } catch (_) { /* no body or non-JSON */ }

    if (r.exitCode !== 0 && status === 0) {
      throw Object.assign(
        new Error(`curl error: ${(r.stdErr || 'network error').substring(0, 200)}`),
        { code: 'CURL_ERROR' }
      );
    }
    if (status === 401) throw Object.assign(new Error('Invalid token'), { code: 'UNAUTHORIZED' });
    if (status === 403) throw Object.assign(new Error('Access denied'), { code: 'FORBIDDEN' });
    if (status === 429) throw Object.assign(new Error('Rate limited'), { code: 'RATE_LIMITED' });
    if (status === 503) throw Object.assign(new Error('Model loading'), { code: 'MODEL_LOADING' });
    if (status < 200 || status >= 300) {
      const msg = data?.error?.message || data?.error || data?.message || `HTTP ${status}`;
      throw Object.assign(new Error(String(msg).substring(0, 200)), { code: 'API_ERROR', status });
    }

    return data;
  } finally {
    Neutralino.filesystem.remove(cfgFwd).catch(() => {});
    Neutralino.filesystem.remove(bodyFwd).catch(() => {});
    Neutralino.filesystem.remove(respFwd).catch(() => {});
  }
}

async function saveApiKey() {
  const key = document.getElementById('hfApiKey').value.trim();
  if (!key) { setApiStatus('err', 'Enter a HuggingFace API key (starts with hf_)'); return; }
  if (!key.startsWith('hf_')) {
    setApiStatus('err', 'HuggingFace tokens start with "hf_"');
    return;
  }
  state.hfApiKey = key;
  localStorage.setItem('hfApiKey', key);
  setApiStatus('ok', 'Saved — verifying…');

  try {
    await hfRequest([{ role: 'user', content: 'Hi' }], { maxTokens: 1 });
    setApiStatus('ok', `Key valid — model: ${HF_MODEL}`);
  } catch (err) {
    switch (err.code) {
      case 'UNAUTHORIZED':
        setApiStatus('err', 'Invalid token — check hf.co/settings/tokens');
        state.hfApiKey = '';
        localStorage.removeItem('hfApiKey');
        break;
      case 'FORBIDDEN':
        setApiStatus('warn', 'Token valid but model access denied — accept the model license on HuggingFace');
        break;
      case 'RATE_LIMITED':
        setApiStatus('warn', 'Key valid — rate limited (free tier). Try again shortly.');
        break;
      case 'MODEL_LOADING':
        setApiStatus('ok', 'Key saved — model is loading, first request may be slow');
        break;
      case 'CURL_ERROR':
        setApiStatus('warn', `curl failed: ${err.message.substring(0, 80)}`);
        break;
      default:
        setApiStatus('warn', `Saved (check: ${err.message.substring(0, 60)})`);
    }
  }
}

function addChatMsg(role, htmlOrText) {
  const area = document.getElementById('aiChatArea');
  area.querySelector('.ai-welcome-msg')?.remove();

  const div = document.createElement('div');
  div.className = `ai-message ${role}`;

  if (role === 'assistant') {
    div.innerHTML = parseAiResponse(htmlOrText);
  } else {
    div.textContent = htmlOrText;
  }

  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return div;
}

function parseAiResponse(text) {
  // Split on ``` code blocks and render them nicely
  let   html   = '';
  const tokens = text.split(/(```\w*\n?[\s\S]*?```)/g);

  for (const token of tokens) {
    if (token.startsWith('```')) {
      const firstNewline = token.indexOf('\n');
      const lang = token.slice(3, firstNewline).trim() || 'code';
      const code = token.slice(firstNewline + 1, token.lastIndexOf('```')).trimEnd();
      state.lastGeneratedCode = code;   // always track latest block
      document.getElementById('insertCodeBtn').disabled = false;

      html += `<div class="ai-code-block">
        <div class="ai-code-header">
          <span class="ai-code-lang">${escHtml(lang)}</span>
          <button class="copy-code-btn" onclick="copyAiCode(this)">Copy</button>
        </div>
        <div class="ai-code-body">${escHtml(code)}</div>
      </div>`;
    } else {
      const escaped = escHtml(token).replace(/\n/g, '<br>');
      if (escaped.trim()) html += `<p>${escaped}</p>`;
    }
  }
  return html;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function copyAiCode(btn) {
  const code = btn.closest('.ai-code-block').querySelector('.ai-code-body').textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

function addLoadingMsg() {
  const area = document.getElementById('aiChatArea');
  const div  = document.createElement('div');
  div.className = 'ai-message loading';
  div.id = 'aiLoadingMsg';
  div.innerHTML = '<div class="spinner"></div><span>Generating<span class="loading-dots"></span></span>';
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function removeLoadingMsg() {
  document.getElementById('aiLoadingMsg')?.remove();
}

async function generateCode() {
  const prompt = document.getElementById('aiPromptInput').value.trim();
  if (!prompt) return;

  if (!state.hfApiKey) {
    addChatMsg('assistant', 'Please enter and save your HuggingFace API key above.\nGet one free at hf.co/settings/tokens');
    return;
  }

  const genBtn = document.getElementById('generateCodeBtn');
  addChatMsg('user', prompt);
  document.getElementById('aiPromptInput').value = '';
  addLoadingMsg();
  genBtn.disabled    = true;
  genBtn.textContent = 'Generating...';

  // Build system + user messages; include current file as context if open
  const messages = [
    {
      role:    'system',
      content: 'You are an expert coding assistant. Generate clean, working, well-commented code. ' +
               'Put every code snippet inside a fenced code block with the language identifier (e.g. ```python).',
    },
  ];
  if (state.activeTabPath) {
    const cur = editor.getValue();
    const ext = (state.activeTabPath.split('.').pop() || '').toLowerCase();
    messages.push({
      role:    'user',
      content: `I have this file open (${state.activeTabPath}):\n\`\`\`${ext}\n${cur}\n\`\`\``,
    });
    messages.push({ role: 'assistant', content: 'Got it, I can see your file.' });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    const data = await hfRequest(messages);
    removeLoadingMsg();
    const text = data?.choices?.[0]?.message?.content || 'No response received.';
    addChatMsg('assistant', text);
  } catch (err) {
    removeLoadingMsg();
    switch (err.code) {
      case 'UNAUTHORIZED':
        addChatMsg('assistant', 'Invalid API token. Re-enter your key and click Save.');
        setApiStatus('err', 'Invalid token — re-enter and save');
        break;
      case 'FORBIDDEN':
        addChatMsg('assistant', 'Access denied. Accept the model license at huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct');
        setApiStatus('warn', 'Accept model license on HuggingFace');
        break;
      case 'RATE_LIMITED':
        addChatMsg('assistant', 'Rate limited (free tier). Wait a moment and try again.');
        setApiStatus('warn', 'Rate limited — try again shortly');
        break;
      case 'MODEL_LOADING':
        addChatMsg('assistant', 'Model is loading (cold start). Wait 20–30 seconds and try again.');
        break;
      case 'CURL_ERROR':
        addChatMsg('assistant', `Network error: ${err.message}`);
        break;
      default:
        addChatMsg('assistant', `Error (${err.code || 'unknown'}): ${err.message}`);
    }
  } finally {
    genBtn.disabled    = false;
    genBtn.textContent = 'Generate';
  }
}

function insertCodeToEditor() {
  if (!state.lastGeneratedCode) return;
  if (state.activeTabPath) {
    const cursor = editor.getCursor();
    editor.getDoc().replaceRange(state.lastGeneratedCode, cursor);
    editor.focus();
  } else {
    editorBusy = true;
    editor.setValue(state.lastGeneratedCode);
    editorBusy = false;
    document.getElementById('welcomeScreen').classList.add('hidden');
  }
}

function clearAiChat() {
  document.getElementById('aiChatArea').innerHTML = `
    <div class="ai-welcome-msg">
      <p>AI coding assistant powered by <strong>HuggingFace</strong>.</p>
      <p>Describe what code you want, ask me to explain or debug existing code, and I'll help.</p>
      <p class="hint">Get a free API key at <strong>hf.co/settings/tokens</strong></p>
      <p class="hint">Tip: Use <strong>Ctrl+Enter</strong> in the prompt box to generate.</p>
    </div>`;
  state.lastGeneratedCode = '';
  document.getElementById('insertCodeBtn').disabled = true;
}

// ============================================================================
//  CONTEXT MENU
// ============================================================================

function showContextMenu(x, y, isDir) {
  const menu = document.getElementById('contextMenu');
  const isWorkspace = state.ctxTarget?.type === 'workspace';
  menu.style.display = 'block';
  // Clamp to viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = 185, mh = isWorkspace ? 60 : 200;
  menu.style.left = Math.min(x, vw - mw) + 'px';
  menu.style.top  = Math.min(y, vh - mh) + 'px';
  document.getElementById('ctxRemoveFolder').style.display = isWorkspace ? 'flex' : 'none';
  document.getElementById('ctxRemoveSep').style.display    = isWorkspace ? 'block' : 'none';
  document.getElementById('ctxOpen').style.display        = isWorkspace || isDir ? 'none' : 'flex';
  // Hide file/folder actions when right-clicking workspace root
  ['ctxNewFile','ctxNewFolder','ctxRename','ctxDelete'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isWorkspace ? 'none' : '';
  });
  // Hide separators when workspace
  menu.querySelectorAll('.ctx-separator:not(#ctxRemoveSep)').forEach(sep => {
    sep.style.display = isWorkspace ? 'none' : '';
  });
}

function hideContextMenu() {
  document.getElementById('contextMenu').style.display = 'none';
  state.ctxTarget = null;
}

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

  const sep    = path.includes('\\') ? '\\' : '/';
  const dir    = path.substring(0, path.lastIndexOf(sep));
  const newPath = dir + sep + newName.trim();

  if (!isNL()) { terminalPrint('info', 'Rename requires Neutralino runtime.'); return; }

  try {
    if (type === 'file') {
      const content = await Neutralino.filesystem.readFile(path);
      await Neutralino.filesystem.writeFile(newPath, content);
      await Neutralino.filesystem.remove(path);
      // Update open tabs
      const tab = state.openTabs.find(t => t.path === path);
      if (tab) {
        tab.path = newPath; tab.name = newName.trim();
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
    const sep = path.includes('\\') ? '\\' : '/';
    if (type === 'dir') await deleteRecursive(path, sep);
    else await Neutralino.filesystem.remove(path);

    // Close any open tabs for this path
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
      else {
        state.activeTabPath = null;
        editorBusy = true; editor.setValue(''); editorBusy = false;
        document.getElementById('welcomeScreen').classList.remove('hidden');
        document.getElementById('titleFilePath').textContent = '';
      }
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
  const sep = prefix.includes('\\') ? '\\' : '/';

  // Close all tabs belonging to this folder
  state.openTabs = state.openTabs.filter(t => {
    if (t.path && (t.path === prefix || t.path.startsWith(prefix + sep))) {
      state.fileContents.delete(t.path);
      return false;
    }
    return true;
  });

  // If active tab was in removed folder, reset editor
  if (state.activeTabPath && (state.activeTabPath === prefix || state.activeTabPath.startsWith(prefix + sep))) {
    state.activeTabPath = null;
    editorBusy = true; editor.setValue(''); editorBusy = false;
    hideImagePreview();
    updateBreadcrumbs(null);
    document.getElementById('titleFilePath').textContent = '';
    document.getElementById('welcomeScreen').classList.remove('hidden');
  }

  state.workspaceFolders = state.workspaceFolders.filter(f => f.path !== prefix);
  renderTabs();
  renderFileTree();
  saveSession();
  setStatus('Folder removed from workspace');
}

async function ctxNewFile() {
  if (!state.ctxTarget || !isNL()) return;
  const { path, type } = state.ctxTarget;
  const dir = type === 'dir' ? path : path.substring(0, path.lastIndexOf(path.includes('\\') ? '\\' : '/'));
  const sep = dir.includes('\\') ? '\\' : '/';
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
  const dir = type === 'dir' ? path : path.substring(0, path.lastIndexOf(path.includes('\\') ? '\\' : '/'));
  const sep = dir.includes('\\') ? '\\' : '/';
  const name = prompt('New folder name:');
  if (!name?.trim()) return;
  try {
    await Neutralino.filesystem.createDirectory(dir + sep + name.trim());
    state.expandedNodes.add(path);
    renderFileTree();
  } catch (err) { terminalPrint('stderr', 'Create folder failed: ' + err.message); }
}

// ============================================================================
//  STATUS BAR
// ============================================================================

function setStatus(msg) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = 'Ready'; }, 3500);
}

// ============================================================================
//  VIDEO PLAYER
// ============================================================================

function playVideo(videoPath, fileName) {
  document.getElementById('videoSource').src =
    `file:///${videoPath.replace(/\\/g, '/')}`;
  const v = document.getElementById('videoPlayer');
  v.load(); v.play();
  document.getElementById('videoTitle').textContent = 'Now Playing: ' + fileName;
  document.getElementById('videoModal').classList.add('active');
}

function closeVideoPlayer() {
  const v = document.getElementById('videoPlayer');
  v.pause(); v.currentTime = 0;
  document.getElementById('videoModal').classList.remove('active');
}

// ============================================================================
//  POLLING (lightweight — watches top-level folder for changes)
// ============================================================================

function startPolling() {
  stopPolling();
  if (!isNL() || state.workspaceFolders.length === 0) return;
  state.pollingTimer = setInterval(async () => {
    try {
      const folder = state.workspaceFolders[0];
      if (!folder?.path) return;
      const raw  = await Neutralino.filesystem.readDirectory(folder.path);
      const snap = raw.map(e => e.entry).sort().join(',');
      if (state.pollingSnapshot !== null && state.pollingSnapshot !== snap) {
        renderFileTree();
      }
      state.pollingSnapshot = snap;
    } catch (_) {}
  }, 3000);
}

function stopPolling() {
  if (state.pollingTimer) { clearInterval(state.pollingTimer); state.pollingTimer = null; }
}

// ============================================================================
//  NEW-FILE FROM SIDEBAR HEADER BUTTON
// ============================================================================

async function newFileInRoot() {
  if (state.workspaceFolders.length === 0) {
    alert('Please open a folder first.');
    return;
  }
  if (!isNL()) { terminalPrint('info', 'File creation requires Neutralino runtime.'); return; }
  const folder = state.workspaceFolders[0];
  const sep    = folder.path.includes('\\') ? '\\' : '/';
  const name   = prompt('New file name:');
  if (!name?.trim()) return;
  const fp = folder.path + sep + name.trim();
  try {
    await Neutralino.filesystem.writeFile(fp, '');
    await renderFileTree();
    await openFile(fp, name.trim());
  } catch (err) { terminalPrint('stderr', 'Create failed: ' + err.message); }
}

// ============================================================================
//  EVENT BINDING
// ============================================================================

function bindAllEvents() {
  // Theme
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

  // Sidebar
  document.getElementById('addFolderBtn').addEventListener('click', addWorkspaceFolder);
  document.getElementById('newFileBtn').addEventListener('click', newFileInRoot);
  document.getElementById('refreshTreeBtn').addEventListener('click', renderFileTree);
	document.getElementById('openFolderEmptyBtn')?.addEventListener('click', addWorkspaceFolder);

  // Welcome screen
  document.getElementById('welcomeOpenFolder').addEventListener('click', addWorkspaceFolder);

  // Tabs / editor actions
  document.getElementById('saveFileBtn').addEventListener('click', saveCurrentFile);
  document.getElementById('runFileBtn').addEventListener('click', runCurrentFile);
  document.getElementById('runCurrentBtn').addEventListener('click', runCurrentFile);

  // Terminal
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

  // AI panel
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
      panel.style.width   = '0';
      panel.style.minWidth = '0';
      panel.style.overflow = 'hidden';
      handle.style.display = 'none';
      btn.textContent = '▶';
    } else {
      panel.style.width    = '';
      panel.style.minWidth = '';
      panel.style.overflow = '';
      handle.style.display = '';
      btn.textContent = '◀';
    }
  });

  // Context menu
  document.getElementById('ctxRemoveFolder').addEventListener('click', removeWorkspaceFolder);
  document.getElementById('ctxOpen').addEventListener('click', async () => {
    await ctxOpenFile(); hideContextMenu();
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

  // Video modal
  document.getElementById('closeVideoBtn').addEventListener('click', closeVideoPlayer);
  document.getElementById('videoModal').addEventListener('click', e => {
    if (e.target.id === 'videoModal') closeVideoPlayer();
  });

  // Activity bar: switch between Explorer and Search panels
  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const panel = btn.dataset.panel;
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

  // Search in files
  let _searchDebounce = null;
  document.getElementById('searchFilesInput').addEventListener('input', e => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => searchInFiles(e.target.value), 400);
  });
  document.getElementById('searchFilesInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(_searchDebounce); searchInFiles(e.target.value); }
  });

  // Word wrap + zoom
  document.getElementById('wordWrapBtn').addEventListener('click', toggleWordWrap);
  document.getElementById('zoomInBtn').addEventListener('click',  () => setEditorFontSize(+2));
  document.getElementById('zoomOutBtn').addEventListener('click', () => setEditorFontSize(-2));

  // Find / Replace bar
  document.getElementById('findPrevBtn').addEventListener('click',    findPrev);
  document.getElementById('findNextBtn').addEventListener('click',    findNext);
  document.getElementById('replaceOneBtn').addEventListener('click',  replaceOne);
  document.getElementById('replaceAllBtn').addEventListener('click',  replaceAll);
  document.getElementById('closeFindBtn').addEventListener('click',   closeFindBar);
  document.getElementById('findInput').addEventListener('input',      performFind);
  document.getElementById('findInput').addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.shiftKey ? findPrev() : findNext(); }
    if (e.key === 'Escape') { closeFindBar(); }
  });
  document.getElementById('replaceInput').addEventListener('keydown', e => {
    if (e.key === 'Escape') closeFindBar();
  });

  // AI quick-actions
  document.getElementById('aiExplainBtn').addEventListener('click',  () => aiQuickAction('explain'));
  document.getElementById('aiFixBtn').addEventListener('click',      () => aiQuickAction('fix'));
  document.getElementById('aiRefactorBtn').addEventListener('click', () => aiQuickAction('refactor'));

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 's')  { e.preventDefault(); saveCurrentFile(); }
    if (e.ctrlKey && e.key === '`')  { e.preventDefault(); toggleTerminal(); }
    // Find/Replace (only when editor doesn't already handle it)
    if (e.ctrlKey && e.key === 'f' && !editor?.hasFocus()) { e.preventDefault(); openFindBar(false); }
    if (e.ctrlKey && e.key === 'h' && !editor?.hasFocus()) { e.preventDefault(); openFindBar(true); }
    // Ctrl+Shift+F → switch to Search panel
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      document.querySelector('.activity-btn[data-panel="search"]')?.click();
    }
    // F3 / Shift+F3 — navigate find results
    if (e.key === 'F3' && !e.ctrlKey) { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
    // Font zoom
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); setEditorFontSize(+2); }
    if (e.ctrlKey && e.key === '-')  { e.preventDefault(); setEditorFontSize(-2); }
    if (e.ctrlKey && e.key === '0')  { e.preventDefault(); setEditorFontSize(14 - state.editorFontSize); }
    if (e.key === 'Escape') {
      hideContextMenu();
      if (document.getElementById('findBar').style.display !== 'none') closeFindBar();
    }
  });

  // Sidebar resize drag
  setupResizeDrag(
    document.getElementById('sidebarResizeHandle'),
    document.getElementById('sidebar'),
    'width',
    120, 500
  );

  // AI panel resize drag
  setupResizeDrag(
    document.getElementById('aiResizeHandle'),
    document.getElementById('aiPanel'),
    'width',
    200, 600,
    true   // drag direction is inverted (drag left = bigger)
  );
}

// Simple horizontal resize drag helper
function setupResizeDrag(handle, target, prop, min, max, inverted = false) {
  let startX = 0, startSize = 0;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX    = e.clientX;
    startSize = parseInt(getComputedStyle(target)[prop], 10);
    handle.classList.add('dragging');

    const onMove = e2 => {
      const delta = inverted ? startX - e2.clientX : e2.clientX - startX;
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

// ============================================================================
//  FIND / REPLACE
// ============================================================================

function openFindBar(showReplace = false) {
  const bar = document.getElementById('findBar');
  bar.style.display = 'flex';
  const findInput = document.getElementById('findInput');
  // Pre-fill with current selection if it's a single line
  if (editor) {
    const sel = editor.getSelection();
    if (sel && !sel.includes('\n')) findInput.value = sel;
  }
  findInput.focus();
  findInput.select();
  if (showReplace) document.getElementById('replaceInput').focus();
  performFind();
}

function closeFindBar() {
  document.getElementById('findBar').style.display = 'none';
  clearFindMarks();
  findMatches = [];
  findIndex   = -1;
  document.getElementById('findCount').textContent = '';
  document.getElementById('findInput').classList.remove('find-no-match');
  editor && editor.focus();
}

function clearFindMarks() {
  findMarks.forEach(m => m.clear());
  findMarks = [];
}

function performFind() {
  clearFindMarks();
  findMatches = [];
  findIndex   = -1;

  const query     = document.getElementById('findInput').value;
  const findInput = document.getElementById('findInput');

  if (!query || !editor) {
    document.getElementById('findCount').textContent = '';
    findInput.classList.remove('find-no-match');
    return;
  }

  // Collect all matches
  const cursor = editor.getSearchCursor(query, { line: 0, ch: 0 }, { caseFold: true });
  while (cursor.findNext()) {
    const from = cursor.from();
    const to   = cursor.to();
    findMatches.push({ from, to });
    findMarks.push(editor.markText(from, to, { className: 'cm-find-match' }));
  }

  if (findMatches.length === 0) {
    document.getElementById('findCount').textContent = 'No matches';
    findInput.classList.add('find-no-match');
    return;
  }

  findInput.classList.remove('find-no-match');
  findJumpTo(0);
}

function findJumpTo(idx) {
  if (!findMatches.length) return;
  findIndex = ((idx % findMatches.length) + findMatches.length) % findMatches.length;

  // Re-apply marks: active vs normal
  findMarks.forEach((mark, i) => {
    const pos = mark.find();
    if (!pos) return;
    mark.clear();
    findMarks[i] = editor.markText(pos.from, pos.to, {
      className: i === findIndex ? 'cm-find-active' : 'cm-find-match',
    });
  });

  const m = findMatches[findIndex];
  editor.scrollIntoView({ from: m.from, to: m.to }, 80);
  editor.setCursor(m.to);
  document.getElementById('findCount').textContent = `${findIndex + 1} / ${findMatches.length}`;
}

function findNext() {
  if (findMatches.length === 0) { performFind(); return; }
  findJumpTo(findIndex + 1);
}

function findPrev() {
  if (findMatches.length === 0) { performFind(); return; }
  findJumpTo(findIndex - 1);
}

function replaceOne() {
  if (!findMatches.length || findIndex < 0) return;
  const replacement = document.getElementById('replaceInput').value;
  const m = findMatches[findIndex];
  editor.replaceRange(replacement, m.from, m.to);
  performFind();
}

function replaceAll() {
  const query = document.getElementById('findInput').value;
  const replacement = document.getElementById('replaceInput').value;
  if (!query || !editor) return;

  let count = 0;
  editor.operation(() => {
    const cursor = editor.getSearchCursor(query, { line: 0, ch: 0 }, { caseFold: true });
    while (cursor.findNext()) { cursor.replace(replacement); count++; }
  });

  performFind();
  if (count) terminalPrint('info', `Replaced ${count} occurrence${count !== 1 ? 's' : ''}.`);
}

// ============================================================================
//  SEARCH IN FILES
// ============================================================================

async function searchInFiles(query) {
  const resultsEl = document.getElementById('searchResults');
  if (!query.trim()) { resultsEl.innerHTML = ''; return; }

  if (!isNL() || !state.workspaceFolders.length) {
    resultsEl.innerHTML = '<div class="search-no-results">Open a folder to search in files.</div>';
    return;
  }

  resultsEl.innerHTML = '<div class="search-no-results">Searching…</div>';

  const folder = state.workspaceFolders[0];
  if (!folder?.path) return;

  // PowerShell Select-String: robust recursive search, outputs path|||line|||content
  const qPS = query.replace(/'/g, "''");
  const fPS = folder.path.replace(/'/g, "''");
  const cmd = `powershell -NoProfile -Command "` +
    `Get-ChildItem -Path '${fPS}' -Recurse -File -ErrorAction SilentlyContinue | ` +
    `Select-String -Pattern '${qPS}' -SimpleMatch -ErrorAction SilentlyContinue | ` +
    `Select-Object -First 200 | ` +
    `ForEach-Object { ('{0}|||{1}|||{2}' -f $_.Path, $_.LineNumber, $_.Line.Trim()) }" 2>&1`;

  try {
    const r     = await Neutralino.os.execCommand(cmd);
    const lines = (r.stdOut || '').trim().split('\n').filter(l => l.includes('|||'));

    if (!lines.length) {
      resultsEl.innerHTML = '<div class="search-no-results">No results found.</div>';
      return;
    }

    // Group hits by file
    const byFile = new Map();
    for (const line of lines) {
      const sep   = line.indexOf('|||');
      const sep2  = line.indexOf('|||', sep + 3);
      if (sep < 0 || sep2 < 0) continue;
      const fp      = line.slice(0, sep).trim();
      const lineNum = parseInt(line.slice(sep + 3, sep2), 10);
      const content = line.slice(sep2 + 3);
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp).push({ lineNum, content });
    }

    resultsEl.innerHTML = '';
    for (const [fp, hits] of byFile) {
      const fileName  = fp.split(/[\\/]/).pop();
      const fileGroup = document.createElement('div');
      fileGroup.className = 'search-file-group';

      const fileHeader = document.createElement('div');
      fileHeader.className = 'search-file-header';
      fileHeader.textContent = `${fileName}  (${hits.length})`;
      fileHeader.title = fp;
      fileGroup.appendChild(fileHeader);

      for (const hit of hits) {
        const row = document.createElement('div');
        row.className = 'search-result-row';
        row.innerHTML =
          `<span class="search-line-num">${hit.lineNum}</span>` +
          `<span class="search-line-content">${escHtml(hit.content.slice(0, 120))}</span>`;
        row.addEventListener('click', async () => {
          await openFile(fp, fileName);
          setTimeout(() => {
            editor.setCursor({ line: hit.lineNum - 1, ch: 0 });
            editor.scrollIntoView({ line: hit.lineNum - 1, ch: 0 }, 80);
            editor.focus();
          }, 150);
        });
        fileGroup.appendChild(row);
      }
      resultsEl.appendChild(fileGroup);
    }
  } catch (err) {
    resultsEl.innerHTML = `<div class="search-no-results">Search error: ${escHtml(err.message.slice(0, 120))}</div>`;
  }
}

// ============================================================================
//  FONT ZOOM
// ============================================================================

function setEditorFontSize(delta) {
  state.editorFontSize = Math.max(10, Math.min(32, state.editorFontSize + delta));
  const cm = document.querySelector('.CodeMirror');
  if (cm) cm.style.fontSize = state.editorFontSize + 'px';
  editor && editor.refresh();
  localStorage.setItem('cxFontSize', state.editorFontSize);
  setStatus(`Font: ${state.editorFontSize}px`);
}

// ============================================================================
//  WORD WRAP TOGGLE
// ============================================================================

function toggleWordWrap() {
  state.wordWrap = !state.wordWrap;
  editor && editor.setOption('lineWrapping', state.wordWrap);
  document.getElementById('wordWrapBtn').classList.toggle('active-btn', state.wordWrap);
  localStorage.setItem('cxWordWrap', state.wordWrap);
  setStatus('Word wrap ' + (state.wordWrap ? 'on' : 'off'));
}

// ============================================================================
//  SESSION SAVE / RESTORE
// ============================================================================

function saveSession() {
  if (!isNL()) return;
  try {
    localStorage.setItem('cxSession', JSON.stringify({
      folders:  state.workspaceFolders.filter(f => f.path).map(f => ({ name: f.name, path: f.path })),
      tabs:     state.openTabs.map(t => ({ path: t.path, name: t.name })),
      active:   state.activeTabPath,
      expanded: [...state.expandedNodes],
    }));
  } catch (_) {}
}

async function restoreSession() {
  if (!isNL()) return;
  try {
    const raw = localStorage.getItem('cxSession');
    if (!raw) return;
    const session = JSON.parse(raw);

    // Restore expanded node state first (before tree render)
    for (const key of (session.expanded || [])) {
      state.expandedNodes.add(key);
    }

    // Restore workspace folders
    for (const f of (session.folders || [])) {
      if (!state.workspaceFolders.find(w => w.path === f.path)) {
        state.workspaceFolders.push(f);
        state.expandedNodes.add(f.path);  // ensure root is always expanded
        document.getElementById('statusBranch').textContent = f.name;
      }
    }
    if (state.workspaceFolders.length) {
      await renderFileTree();
      startPolling();
    }

    // Restore open tabs
    for (const tab of (session.tabs || [])) {
      try { await openFile(tab.path, tab.name); } catch (_) {}
    }

    // Restore active tab
    const active = session.active;
    if (active) {
      const t = state.openTabs.find(t => t.path === active);
      if (t) { setActiveTab(t.path); loadEditorContent(t.path, t.name); }
    }
  } catch (_) {}
}

// ============================================================================
//  IMAGE PREVIEW
// ============================================================================

function showImagePreview(filePath, fileName) {
  document.getElementById('welcomeScreen').classList.add('hidden');
  const cm = document.querySelector('.CodeMirror');
  if (cm) cm.style.display = 'none';
  const preview = document.getElementById('imagePreview');
  preview.style.display = 'flex';
  document.getElementById('previewImg').src = `file:///${filePath.replace(/\\/g, '/')}`;
  document.getElementById('imageInfo').textContent = fileName;
}

function hideImagePreview() {
  const preview = document.getElementById('imagePreview');
  if (preview) preview.style.display = 'none';
  const cm = document.querySelector('.CodeMirror');
  if (cm) cm.style.display = '';
  editor && editor.refresh();
}

// ============================================================================
//  AI QUICK-ACTIONS
// ============================================================================

function aiQuickAction(type) {
  if (!editor) return;
  const selection = editor.getSelection();
  const ext = state.activeTabPath
    ? (state.activeTabPath.split('.').pop() || '').toLowerCase()
    : '';

  const target = selection && !selection.includes('\n') === false
    ? selection  // multi-line selection
    : selection || null;

  const codeRef = target
    ? `the selected code:\n\`\`\`${ext}\n${target}\n\`\`\``
    : `the current file:\n\`\`\`${ext}\n${editor.getValue()}\n\`\`\``;

  const prompts = {
    explain:  `Explain ${codeRef}`,
    fix:      `Find and fix any bugs or issues in ${codeRef}`,
    refactor: `Refactor ${codeRef} to improve readability, maintainability, and best practices. Show the full improved version.`,
  };

  const prompt = prompts[type];
  if (!prompt) return;

  document.getElementById('aiPromptInput').value = prompt;
  // Expand AI panel if collapsed
  if (state.aiPanelCollapsed) {
    document.getElementById('collapseAiBtn').click();
  }
  generateCode();
}

// ============================================================================
//  BREADCRUMBS
// ============================================================================

function updateBreadcrumbs(filePath) {
  const bar = document.getElementById('breadcrumbBar');
  if (!bar) return;
  if (!filePath) { bar.innerHTML = ''; return; }

  const sep   = filePath.includes('\\') ? '\\' : '/';
  const parts = filePath.split(sep).filter(Boolean);
  // On Windows, first part is "C:" — keep it

  bar.innerHTML = parts.map((part, i) => {
    const isLast = i === parts.length - 1;
    return (i > 0 ? '<span class="crumb-sep">›</span>' : '') +
      `<span class="crumb${isLast ? '' : ' crumb-link'}">${escHtml(part)}</span>`;
  }).join('');
}
