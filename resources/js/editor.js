// ============================================================================
//  CodeXplorer — editor.js
//  CodeMirror initialisation, language mapping, content loading,
//  font zoom, and word-wrap toggle.
// ============================================================================

// ── Language maps ─────────────────────────────────────────────────────────────

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

// ── Initialisation ────────────────────────────────────────────────────────────

function initCodeMirror() {
  if (!document.getElementById('codeTextarea')) return;

  editor = CodeMirror.fromTextArea(document.getElementById('codeTextarea'), {
    lineNumbers:       true,
    theme:             state.theme === 'dark' ? 'one-dark' : 'eclipse',
    matchBrackets:     true,
    autoCloseBrackets: true,
    styleActiveLine:   true,
    lineWrapping:      state.wordWrap,
    tabSize:           2,
    indentWithTabs:    false,
    mode:              'text/plain',
    foldGutter:        true,
    gutters:           ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    extraKeys: {
      'Ctrl-S':     () => saveCurrentFile(),
      'Ctrl-Enter': () => runCurrentFile(),
      'Ctrl-F':     () => openFindBar(false),
      'Ctrl-H':     () => openFindBar(true),
      'F3':         () => findNext(),
      'Shift-F3':   () => findPrev(),
      'Ctrl-Space': cm  => CodeMirror.showHint(cm, CodeMirror.hint.anyword),
      'Alt-Z':      () => toggleWordWrap(),
      'Escape':     () => {
        if (document.getElementById('findBar').style.display !== 'none') closeFindBar();
      },
    },
  });

  // Apply saved font size on first paint
  requestAnimationFrame(() => {
    const cm = document.querySelector('.CodeMirror');
    if (cm && state.editorFontSize !== 14) cm.style.fontSize = state.editorFontSize + 'px';
    document.getElementById('wordWrapBtn')
      ?.classList.toggle('active-btn', state.wordWrap);
  });

  editor.on('change', () => {
    if (editorBusy || !state.activeTabPath) return;
    state.fileContents.set(state.activeTabPath, editor.getValue());
    markTabModified(state.activeTabPath, true);
  });

  editor.on('cursorActivity', () => {
    const cur = editor.getCursor();
    document.getElementById('statusCursor').textContent =
      `Ln ${cur.line + 1}, Col ${cur.ch + 1}`;
  });
}

// ── Content loading ───────────────────────────────────────────────────────────

function loadEditorContent(filePath, fileName) {
  const ext = getExt(fileName);

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

// ── Font zoom ─────────────────────────────────────────────────────────────────

function setEditorFontSize(delta) {
  state.editorFontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, state.editorFontSize + delta));
  const cm = document.querySelector('.CodeMirror');
  if (cm) cm.style.fontSize = state.editorFontSize + 'px';
  editor && editor.refresh();
  localStorage.setItem('cxFontSize', state.editorFontSize);
  setStatus(`Font: ${state.editorFontSize}px`);
}

// ── Word wrap ─────────────────────────────────────────────────────────────────

function toggleWordWrap() {
  state.wordWrap = !state.wordWrap;
  editor && editor.setOption('lineWrapping', state.wordWrap);
  document.getElementById('wordWrapBtn').classList.toggle('active-btn', state.wordWrap);
  localStorage.setItem('cxWordWrap', state.wordWrap);
  setStatus('Word wrap ' + (state.wordWrap ? 'on' : 'off'));
}
