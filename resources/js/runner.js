// ============================================================================
//  CodeXplorer — runner.js
//  Compile and run the active file in the integrated terminal.
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

  const fp    = state.activeTabPath;
  const ext   = getExt(fp);
  const sep   = getSep(fp);
  const dir   = getDir(fp);
  const fname = fp.split(sep).pop();
  const bare  = fname.replace(/\.[^.]+$/, '');

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

  // Backslash-normalised paths for Windows compiler args
  const fpNative  = fp.replace(/\//g, '\\');
  const dirNative = dir.replace(/\//g, '\\');
  const exePath   = `${dirNative}\\${bare}.exe`;

  // PowerShell single-quote-escaped versions
  const fpPS  = fpNative.replace(/'/g, "''");
  const exePS = exePath.replace(/'/g, "''");
  const dirPS = dirNative.replace(/'/g, "''");

  // PATH reset ensures MSYS2/MinGW compilers are found from registry
  const psPath = `$env:PATH=[System.Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[System.Environment]::GetEnvironmentVariable('PATH','User')`;

  const compiledSteps = {
    c:    { compile: `powershell -NoProfile -Command "${psPath}; gcc '${fpPS}' -o '${exePS}' 2>&1"`,   run: `"${exePath}"` },
    cpp:  { compile: `powershell -NoProfile -Command "${psPath}; g++ '${fpPS}' -o '${exePS}' 2>&1"`,   run: `"${exePath}"` },
    cc:   { compile: `powershell -NoProfile -Command "${psPath}; g++ '${fpPS}' -o '${exePS}' 2>&1"`,   run: `"${exePath}"` },
    java: { compile: `powershell -NoProfile -Command "${psPath}; javac '${fpPS}' 2>&1"`,                run: `powershell -NoProfile -Command "${psPath}; java -cp '${dirPS}' ${bare} 2>&1"` },
    rs:   { compile: `powershell -NoProfile -Command "${psPath}; rustc '${fpPS}' -o '${exePS}' 2>&1"`, run: `"${exePath}"` },
  };

  const COMPILER_NOT_FOUND = {
    c:    'gcc not found. Install MinGW-w64 (https://www.msys2.org) and add its bin directory to PATH.',
    cpp:  'g++ not found. Install MinGW-w64 (https://www.msys2.org) and add its bin directory to PATH.',
    cc:   'g++ not found. Install MinGW-w64 (https://www.msys2.org) and add its bin directory to PATH.',
    java: 'javac not found. Install JDK from https://adoptium.net and ensure JAVA_HOME/bin is in PATH.',
    rs:   'rustc not found. Install Rust via rustup: https://rustup.rs',
  };

  try {
    if (compiledSteps[ext]) {
      await _runCompiled(compiledSteps[ext], ext, dir, COMPILER_NOT_FOUND[ext]);
    } else if (interpretedCmds[ext]) {
      await _runInterpreted(interpretedCmds[ext], fname, dir);
    } else {
      terminalPrint('warn', `No runner configured for .${ext} files.`);
    }
  } catch (err) {
    terminalPrint('stderr', 'Execution failed: ' + err.message);
    setStatus('Run failed');
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _runCompiled({ compile, run }, ext, dir, notFoundMsg) {
  const compileDisplay = compile
    .replace(/^powershell -NoProfile -Command ".+?; (.+) 2>&1"$/, '$1')
    .replace(/'/g, '"');

  terminalPrint('command', `> Compiling: ${compileDisplay}`);
  setStatus('Compiling…');

  const compileResult = await Neutralino.os.execCommand(compile, { cwd: dir });
  // Compile output comes through stdOut (PowerShell 2>&1 merges stderr into stdout)
  printExecOutput(compileResult, 'stderr');

  if (compileResult.exitCode !== 0) {
    const hasOutput = (compileResult.stdOut || '').trim() || (compileResult.stdErr || '').trim();
    if (!hasOutput && notFoundMsg) terminalPrint('warn', notFoundMsg);
    terminalPrint('stderr', `Compilation failed (exit code ${compileResult.exitCode})`);
    setStatus(`Compile error (code ${compileResult.exitCode})`);
    return;
  }
  terminalPrint('info', 'Compilation successful.');

  terminalPrint('command', `> Running: ${run}`);
  setStatus('Running…');
  const runResult = await Neutralino.os.execCommand(run, { cwd: dir });
  printExecOutput(runResult);
  _reportExit(runResult.exitCode);
}

async function _runInterpreted(cmd, fname, dir) {
  terminalPrint('command', `> ${fname}  [${cmd}]`);
  setStatus('Running…');
  const result = await Neutralino.os.execCommand(cmd, { cwd: dir });
  printExecOutput(result);
  _reportExit(result.exitCode);
}

function _reportExit(code) {
  if (code === 0) {
    terminalPrint('success', 'Process exited with code 0');
    setStatus('Done');
  } else {
    terminalPrint('stderr', `Process exited with code ${code}`);
    setStatus(`Error (code ${code})`);
  }
}
