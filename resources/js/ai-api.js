// ============================================================================
//  CodeXplorer — ai-api.js
//  HuggingFace Inference API client (via curl.exe to bypass CORS).
// ============================================================================

function setApiStatus(type, msg) {
  const el = document.getElementById('apiKeyStatus');
  el.className   = 'api-status ' + type;
  el.textContent = msg;
}

// ── HTTP via curl ─────────────────────────────────────────────────────────────
// fetch() is CORS-blocked in NeutralinoJS WebView for external APIs.
// Requests are routed through curl.exe (built into Windows 10+) via execCommand
// — runs as an OS process so CORS rules do not apply.

async function hfRequest(messages, { maxTokens = 4096, temperature = 0.7 } = {}) {
  const key = state.hfApiKey;
  if (!key) throw Object.assign(new Error('No API key'), { code: 'NO_KEY' });

  const payload = JSON.stringify({
    model: HF_MODEL, messages, max_tokens: maxTokens, temperature, stream: false,
  });

  // Forward slashes throughout — curl on Windows accepts them and avoids
  // backslash escape-sequence corruption in quoted config values (\t, \n …)
  const rawTmp  = await Neutralino.os.getEnv('TEMP');
  const tmpFwd  = rawTmp.replace(/\\/g, '/').replace(/\/$/, '');
  const bodyFwd = tmpFwd + '/cx_hf_body.json';
  const cfgFwd  = tmpFwd + '/cx_hf_cfg.txt';
  const respFwd = tmpFwd + '/cx_hf_resp.json';

  await Neutralino.filesystem.writeFile(bodyFwd, payload);

  // curl config file avoids ALL command-line quoting issues with auth headers
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

    // stdOut = HTTP status code from write-out; response body is in the output file
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
    if (status === 401) throw Object.assign(new Error('Invalid token'),    { code: 'UNAUTHORIZED' });
    if (status === 403) throw Object.assign(new Error('Access denied'),    { code: 'FORBIDDEN' });
    if (status === 429) throw Object.assign(new Error('Rate limited'),     { code: 'RATE_LIMITED' });
    if (status === 503) throw Object.assign(new Error('Model loading'),    { code: 'MODEL_LOADING' });
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

// ── API key management ────────────────────────────────────────────────────────

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
