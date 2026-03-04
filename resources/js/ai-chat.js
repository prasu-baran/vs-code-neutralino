// ============================================================================
//  CodeXplorer — ai-chat.js
//  AI chat UI, code generation, quick-actions.
// ============================================================================

// ── Chat message rendering ────────────────────────────────────────────────────

function addChatMsg(role, htmlOrText) {
  const area = document.getElementById('aiChatArea');
  area.querySelector('.ai-welcome-msg')?.remove();

  const div = document.createElement('div');
  div.className = `ai-message ${role}`;
  div.innerHTML = role === 'assistant' ? parseAiResponse(htmlOrText) : '';
  if (role !== 'assistant') div.textContent = htmlOrText;

  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return div;
}

function parseAiResponse(text) {
  let html = '';
  const tokens = text.split(/(```\w*\n?[\s\S]*?```)/g);

  for (const token of tokens) {
    if (token.startsWith('```')) {
      const firstNewline = token.indexOf('\n');
      const lang = token.slice(3, firstNewline).trim() || 'code';
      const code = token.slice(firstNewline + 1, token.lastIndexOf('```')).trimEnd();
      state.lastGeneratedCode = code;
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
  div.id        = 'aiLoadingMsg';
  div.innerHTML = '<div class="spinner"></div><span>Generating<span class="loading-dots"></span></span>';
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function removeLoadingMsg() {
  document.getElementById('aiLoadingMsg')?.remove();
}

// ── Code generation ───────────────────────────────────────────────────────────

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

  const messages = [
    {
      role:    'system',
      content: 'You are an expert coding assistant. Generate clean, working, well-commented code. ' +
               'Put every code snippet inside a fenced code block with the language identifier (e.g. ```python).',
    },
  ];
  if (state.activeTabPath) {
    const cur = editor.getValue();
    const ext = getExt(state.activeTabPath);
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

// ── Quick-actions (Explain / Fix / Refactor) ──────────────────────────────────

function aiQuickAction(type) {
  if (!editor) return;
  const selection = editor.getSelection();
  const ext       = getExt(state.activeTabPath || '');

  const target  = selection || null;
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
  if (state.aiPanelCollapsed) document.getElementById('collapseAiBtn').click();
  generateCode();
}
