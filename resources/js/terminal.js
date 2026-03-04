// ============================================================================
//  CodeXplorer — terminal.js
//  Integrated terminal UI and shell command execution.
// ============================================================================

// ── Output printing ───────────────────────────────────────────────────────────

function terminalPrint(type, text) {
  const out  = document.getElementById('terminalOutput');
  const line = document.createElement('div');
  line.className  = `terminal-line ${type}`;
  line.textContent = text;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function clearTerminal() {
  document.getElementById('terminalOutput').innerHTML = '';
}

// ── Panel toggle ──────────────────────────────────────────────────────────────

function toggleTerminal() {
  state.terminalCollapsed = !state.terminalCollapsed;
  document.getElementById('terminalPanel')
    .classList.toggle('collapsed', state.terminalCollapsed);
  document.getElementById('toggleTermBtn').textContent =
    state.terminalCollapsed ? '^' : 'v';
}

// ── Exec output helper ────────────────────────────────────────────────────────
// Replaces 4 repeated output-print blocks throughout runner.js

function printExecOutput(result, stdoutType = 'stdout') {
  const out = (result.stdOut || '').trim();
  const err = (result.stdErr || '').trim();
  if (out) out.split('\n').forEach(l => l.trim() && terminalPrint(stdoutType, l));
  if (err) err.split('\n').forEach(l => l.trim() && terminalPrint('stderr', l));
}

// ── Shell command runner ──────────────────────────────────────────────────────

async function runTerminalCommand(cmd) {
  if (!cmd.trim()) return;
  terminalPrint('command', '$ ' + cmd);
  if (!isNL()) {
    terminalPrint('info', 'Shell commands require Neutralino runtime.');
    return;
  }
  try {
    const cwd = state.activeTabPath
      ? getDir(state.activeTabPath)
      : (state.workspaceFolders[0]?.path || undefined);

    const r = await Neutralino.os.execCommand(cmd, cwd ? { cwd } : {});
    printExecOutput(r);
    if (r.exitCode !== 0) terminalPrint('warn', `Exit code: ${r.exitCode}`);
  } catch (err) {
    terminalPrint('stderr', err.message);
  }
}
