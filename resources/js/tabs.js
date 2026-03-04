// ============================================================================
//  CodeXplorer — tabs.js
//  Tab bar: open, activate, close, and modified-state tracking.
// ============================================================================

function setActiveTab(filePath) {
  state.activeTabPath = filePath;
  renderTabs();
  document.getElementById('titleFilePath').textContent = filePath;
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
    div.className =
      `tab${tab.path === state.activeTabPath ? ' active' : ''}${tab.modified ? ' modified' : ''}`;
    div.innerHTML =
      `<span class="tab-name">${tab.name}</span>
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
  if (tab?.modified) {
    if (confirm(`Save changes to "${tab.name}" before closing?`)) {
      saveFile(filePath, state.fileContents.get(filePath));
    }
  }

  state.openTabs = state.openTabs.filter(t => t.path !== filePath);
  state.fileContents.delete(filePath);

  if (state.activeTabPath === filePath) {
    const next = state.openTabs[state.openTabs.length - 1];
    if (next) {
      setActiveTab(next.path);
      loadEditorContent(next.path, next.name);
    } else {
      resetEditorToWelcome();
    }
  }

  renderTabs();
  saveSession();
}

function markTabModified(filePath, modified) {
  const tab = state.openTabs.find(t => t.path === filePath);
  if (tab) { tab.modified = modified; renderTabs(); }
}
