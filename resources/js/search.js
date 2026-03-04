// ============================================================================
//  CodeXplorer — search.js
//  Find/Replace bar and Search-in-Files panel.
// ============================================================================

// ── Find / Replace bar ────────────────────────────────────────────────────────

function openFindBar(showReplace = false) {
  const bar       = document.getElementById('findBar');
  const findInput = document.getElementById('findInput');
  bar.style.display = 'flex';

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

  const cursor = editor.getSearchCursor(query, { line: 0, ch: 0 }, { caseFold: true });
  while (cursor.findNext()) {
    const from = cursor.from(), to = cursor.to();
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
  const query       = document.getElementById('findInput').value;
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

// ── Search in files ───────────────────────────────────────────────────────────

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

  // PowerShell Select-String: recursive search, outputs path|||line|||content
  const qPS = query.replace(/'/g, "''");
  const fPS = folder.path.replace(/'/g, "''");
  const cmd = `powershell -NoProfile -Command "` +
    `Get-ChildItem -Path '${fPS}' -Recurse -File -ErrorAction SilentlyContinue | ` +
    `Select-String -Pattern '${qPS}' -SimpleMatch -ErrorAction SilentlyContinue | ` +
    `Select-Object -First ${SEARCH_RESULT_LIMIT} | ` +
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
      const sep  = line.indexOf('|||');
      const sep2 = line.indexOf('|||', sep + 3);
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
      fileHeader.className   = 'search-file-header';
      fileHeader.textContent = `${fileName}  (${hits.length})`;
      fileHeader.title       = fp;
      fileGroup.appendChild(fileHeader);

      for (const hit of hits) {
        const row = document.createElement('div');
        row.className = 'search-result-row';
        row.innerHTML =
          `<span class="search-line-num">${hit.lineNum}</span>` +
          `<span class="search-line-content">${escHtml(hit.content.slice(0, SEARCH_CONTENT_CHARS))}</span>`;
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
    resultsEl.innerHTML =
      `<div class="search-no-results">Search error: ${escHtml(err.message.slice(0, 120))}</div>`;
  }
}
