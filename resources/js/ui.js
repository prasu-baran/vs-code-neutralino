// ============================================================================
//  CodeXplorer — ui.js
//  Video player, breadcrumbs, and file-system polling.
// ============================================================================

// ── Video player ──────────────────────────────────────────────────────────────

function playVideo(videoPath, fileName) {
  document.getElementById('videoSource').src =
    `file:///${videoPath.replace(/\\/g, '/')}`;
  const v = document.getElementById('videoPlayer');
  v.load();
  v.play();
  document.getElementById('videoTitle').textContent = 'Now Playing: ' + fileName;
  document.getElementById('videoModal').classList.add('active');
}

function closeVideoPlayer() {
  const v = document.getElementById('videoPlayer');
  v.pause();
  v.currentTime = 0;
  document.getElementById('videoModal').classList.remove('active');
}

// ── Breadcrumbs ───────────────────────────────────────────────────────────────

function updateBreadcrumbs(filePath) {
  const bar = document.getElementById('breadcrumbBar');
  if (!bar) return;
  if (!filePath) { bar.innerHTML = ''; return; }

  const sep   = getSep(filePath);
  const parts = filePath.split(sep).filter(Boolean);

  bar.innerHTML = parts.map((part, i) => {
    const isLast = i === parts.length - 1;
    return (i > 0 ? '<span class="crumb-sep">›</span>' : '') +
      `<span class="crumb${isLast ? '' : ' crumb-link'}">${escHtml(part)}</span>`;
  }).join('');
}

// ── File-system polling ───────────────────────────────────────────────────────
// Lightweight: watches only the top-level folder listing for changes.

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
  }, POLLING_INTERVAL);
}

function stopPolling() {
  if (state.pollingTimer) {
    clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }
}
