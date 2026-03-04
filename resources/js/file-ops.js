// ============================================================================
//  CodeXplorer — file-ops.js
//  Open, read, save files; image preview show/hide.
// ============================================================================

// ── Open ──────────────────────────────────────────────────────────────────────

async function openFile(filePath, fileName, handle = null) {
  const ext = getExt(fileName);

  if (VIDEO_EXTS.has(ext)) { playVideo(filePath, fileName); return; }

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

  if (!state.openTabs.find(t => t.path === filePath)) {
    state.openTabs.push({ path: filePath, name: fileName, modified: false });
  }
  setActiveTab(filePath);

  if (!state.fileContents.has(filePath)) {
    try {
      let content = '';
      if (isNL() && !handle) {
        content = await Neutralino.filesystem.readFile(filePath);
      } else if (handle) {
        content = await (await handle.getFile()).text();
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

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveCurrentFile() {
  if (!state.activeTabPath) return;
  await saveFile(state.activeTabPath, editor.getValue());
}

async function saveFile(filePath, content) {
  if (!isNL()) { terminalPrint('info', 'Save requires Neutralino runtime.'); return; }
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

// ── Image preview ─────────────────────────────────────────────────────────────

function showImagePreview(filePath, fileName) {
  document.getElementById('welcomeScreen').classList.add('hidden');
  const cm = document.querySelector('.CodeMirror');
  if (cm) cm.style.display = 'none';
  document.getElementById('imagePreview').style.display = 'flex';
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
