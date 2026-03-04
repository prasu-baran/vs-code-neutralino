// ============================================================================
//  CodeXplorer — state.js
//  Single source of truth for all runtime state.
//  Loaded before every other module.
// ============================================================================

const state = {
  // ── Workspace ─────────────────────────────────────────────────────────────
  workspaceFolders: [],   // [{name, path}] (Neutralino) | [{name, handle}] (web)
  expandedNodes:    new Set(),

  // ── Editor / Tabs ─────────────────────────────────────────────────────────
  openTabs:      [],           // [{path, name, modified}]
  activeTabPath: null,
  fileContents:  new Map(),    // path → string

  // ── UI ────────────────────────────────────────────────────────────────────
  theme:             localStorage.getItem('cxTheme') || 'dark',
  terminalCollapsed: false,
  aiPanelCollapsed:  false,

  // ── AI ────────────────────────────────────────────────────────────────────
  hfApiKey:          localStorage.getItem('hfApiKey') || '',
  lastGeneratedCode: '',

  // ── Context menu ──────────────────────────────────────────────────────────
  ctxTarget: null,   // {path, type: 'file'|'dir'|'workspace', name}

  // ── Polling ───────────────────────────────────────────────────────────────
  pollingTimer:    null,
  pollingSnapshot: null,

  // ── Terminal ──────────────────────────────────────────────────────────────
  terminalHistory:      [],
  terminalHistoryIndex: -1,

  // ── Editor settings (persisted to localStorage) ───────────────────────────
  editorFontSize: parseInt(localStorage.getItem('cxFontSize'), 10) || 14,
  wordWrap:       localStorage.getItem('cxWordWrap') === 'true',
};

// ── CodeMirror instance ───────────────────────────────────────────────────────
let editor     = null;
let editorBusy = false;   // prevents recursive change events

// ── Find / Replace ────────────────────────────────────────────────────────────
let findMarks   = [];
let findMatches = [];
let findIndex   = -1;

// ── File-tree render mutex ────────────────────────────────────────────────────
let _renderingTree = false;
