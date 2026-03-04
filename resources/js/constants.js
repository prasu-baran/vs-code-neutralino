// ============================================================================
//  CodeXplorer — constants.js
//  All magic numbers, strings, and sets in one place.
// ============================================================================

// ── File type sets ────────────────────────────────────────────────────────────
const VIDEO_EXTS  = new Set(['mp4','avi','mkv','webm','mov','flv','m4v','wmv','3gp','ogv']);
const IMAGE_EXTS  = new Set(['png','jpg','jpeg','gif','bmp','ico','webp','svg']);
const BINARY_EXTS = new Set(['zip','rar','tar','gz','exe','dll','so','pdf','mp3','wav','flac']);

// ── AI ────────────────────────────────────────────────────────────────────────
// Endpoint migrated from api-inference.huggingface.co → router.huggingface.co (2025)
const HF_MODEL = 'Qwen/Qwen2.5-Coder-32B-Instruct';
const HF_API   = 'https://router.huggingface.co/v1/chat/completions';

// ── Timing ────────────────────────────────────────────────────────────────────
const POLLING_INTERVAL = 3000;   // ms between file-tree refresh checks
const STATUS_TIMEOUT   = 3500;   // ms before status bar resets to "Ready"

// ── Editor ───────────────────────────────────────────────────────────────────
const FONT_MIN = 10;   // px
const FONT_MAX = 32;   // px

// ── Search ───────────────────────────────────────────────────────────────────
const SEARCH_RESULT_LIMIT  = 200;   // max results from PowerShell Select-String
const SEARCH_CONTENT_CHARS = 120;   // max chars of matching line shown in results

// ── Resize drag bounds ───────────────────────────────────────────────────────
const SIDEBAR_MIN   = 120;   // px
const SIDEBAR_MAX   = 500;   // px
const AI_PANEL_MIN  = 200;   // px
const AI_PANEL_MAX  = 600;   // px
