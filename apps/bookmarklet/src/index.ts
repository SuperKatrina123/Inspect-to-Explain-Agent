/**
 * Inspect-to-Explain Agent — Bookmarklet
 *
 * Self-contained inspector injectable into ANY page.
 * - Click the bookmark → floating panel appears + inspect mode activates
 * - Click again → toggles inspect mode ON/OFF
 * - Hover elements → orange highlight
 * - Click an element → context extracted (DOM + React Fiber + network matches)
 * - Click "Analyze" → POST to server → result shown in panel
 *
 * Built with esbuild into a single minified IIFE.
 * __SERVER_URL__ is replaced at build time (see build.ts).
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface RecordedRequest {
  method: string;
  endpoint: string;   // pathname only, e.g. "/api/v1/order/detail"
  body: any;          // raw parsed JSON response — server will mask before LLM
  timestamp: number;
}

/** SSR hydration data detected in the page (Next.js, Nuxt, custom BFF, etc.) */
interface SsrData {
  key: string;        // e.g. "__NEXT_DATA__", "__INITIAL_STATE__"
  data: any;
}

/**
 * Network context collected at click time.
 * Sent to server as-is; server masks sensitive fields before passing to LLM.
 */
interface NetworkContext {
  filter: string;              // URL path prefix filter the user set, e.g. "/api/"
  requests: RecordedRequest[]; // requests recorded since Inspect Mode was turned ON
  ssrData: SsrData[];          // SSR hydration objects found on the page
}

interface ElementContext {
  url: string;
  selectedElement: {
    tag: string;
    text: string;
    className: string;
    id: string;
    selector: string;
    xpath: string;
  };
  ancestors: Array<{ tag: string; className: string; id: string }>;
  siblings: Array<{ tag: string; text: string; className: string }>;
  nearbyTexts: string[];
  reactComponentStack: string[];
  networkContext: NetworkContext;
}

interface AnalysisResult {
  elementText: string;
  moduleName: string;
  candidateComponents: string[];
  sourceType: string;
  confidence: number;
  evidence: string[];
  explanation: string;
  codeReferences?: Array<{ file: string; line: number; snippet: string }>;
  soaReferences?: Array<{ endpoint: string; serviceId: string; methodName: string; file: string; line: number }>;
  analysisMode: string;
  modelUsed?: string;
}

// Replaced at build time by esbuild define
declare const __SERVER_URL__: string;

// ── Singleton guard ────────────────────────────────────────────────────────────
// Clicking the bookmarklet a second time toggles inspect mode instead of re-injecting

declare global {
  interface Window {
    __inspectAgent?: { toggle: () => void; destroy: () => void };
  }
}

if (window.__inspectAgent) {
  window.__inspectAgent.toggle();
} else {
  boot();
}

// ── Main ───────────────────────────────────────────────────────────────────────

function boot() {
  // Server URL is editable in the panel and persisted to localStorage.
  // __SERVER_URL__ (build-time) is used only as the initial default.
  const LS_KEY = '__ia_server';
  let SERVER: string = localStorage.getItem(LS_KEY) || __SERVER_URL__;

  // Custom component blacklist (comma-separated, persisted to localStorage)
  const LS_BLACKLIST = '__ia_blacklist';
  let componentBlacklist: string[] = (localStorage.getItem(LS_BLACKLIST) || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  let inspectActive = false;
  let lastHighlighted: Element | null = null;
  let currentContext: ElementContext | null = null;

  // ── Network recorder ─────────────────────────────────────────────────────────
  // Recording only starts when the user turns Inspect Mode ON (not on injection).
  // Only requests whose path matches `networkFilter` are recorded (default /api/).
  // Capped at MAX_RECORDS; oldest entry dropped when full.

  const MAX_RECORDS = 30;
  let networkFilter = '/api/';
  let networkLog: RecordedRequest[] = [];

  const _origFetch = window.fetch.bind(window);
  const _origXhrOpen = XMLHttpRequest.prototype.open;
  const _origXhrSend = XMLHttpRequest.prototype.send;

  function pathMatches(url: string): boolean {
    try {
      const path = new URL(url, window.location.href).pathname;
      return path.includes(networkFilter);
    } catch { return false; }
  }

  /**
   * Recursively trim a JSON object/array to keep payload small.
   * Arrays are capped at maxArr items; strings longer than 300 chars are truncated.
   */
  function trimBody(val: any, depth: number, maxArr: number): any {
    if (depth > 4) return '…';
    if (typeof val === 'string') return val.length > 300 ? val.slice(0, 300) + '…' : val;
    if (Array.isArray(val)) return val.slice(0, maxArr).map(v => trimBody(v, depth + 1, maxArr));
    if (val && typeof val === 'object') {
      const out: Record<string, any> = {};
      for (const k of Object.keys(val).slice(0, 40)) out[k] = trimBody(val[k], depth + 1, maxArr);
      return out;
    }
    return val;
  }

  function pushRecord(method: string, url: string, body: any) {
    if (!inspectActive) return;              // only record while inspect is ON
    if (!pathMatches(url)) return;           // only record matching paths
    const endpoint = (() => { try { return new URL(url, window.location.href).pathname; } catch { return url; } })();
    // Truncate large response bodies to keep payload manageable
    const trimmed = trimBody(body, 0, 30);
    networkLog.push({ method, endpoint, body: trimmed, timestamp: Date.now() });
    if (networkLog.length > MAX_RECORDS) networkLog.shift();
  }

  // Patch fetch
  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const res = await _origFetch(input, init);
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      res.clone().json().then((body: any) => pushRecord(method, url, body)).catch(() => {});
    }
    return res;
  } as typeof fetch;

  // Patch XHR
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest & { __ia_m?: string; __ia_u?: string },
    method: string, url: string | URL, ...rest: any[]
  ) {
    this.__ia_m = method.toUpperCase();
    this.__ia_u = url.toString();
    return (_origXhrOpen as Function).call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest & { __ia_m?: string; __ia_u?: string },
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    this.addEventListener('load', function () {
      const ct = this.getResponseHeader('content-type') ?? '';
      if (ct.includes('application/json') && this.responseText) {
        try { pushRecord(this.__ia_m ?? 'GET', this.__ia_u ?? '', JSON.parse(this.responseText)); }
        catch { /* ignore */ }
      }
    });
    return _origXhrSend.call(this, body);
  };

  function restoreNetwork() {
    window.fetch = _origFetch;
    XMLHttpRequest.prototype.open = _origXhrOpen;
    XMLHttpRequest.prototype.send = _origXhrSend;
  }

  // ── SSR hydration scanner ─────────────────────────────────────────────────────
  // Scans well-known window keys and inline <script> tags for hydration data.
  // Called once at click time so we always get the latest state.

  const SSR_KEYS = [
    '__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APP_STATE__',
    '__REDUX_STATE__', '__PRELOADED_STATE__', '__SERVER_DATA__',
  ];

  function scanSsrData(): SsrData[] {
    const results: SsrData[] = [];

    // 1. Well-known window globals
    for (const key of SSR_KEYS) {
      const val = (window as any)[key];
      if (val && typeof val === 'object') {
        results.push({ key, data: val });
      }
    }

    // 2. Inline <script type="application/json"> tags (common in custom BFF setups)
    document.querySelectorAll('script[type="application/json"]').forEach((el) => {
      const id = el.id || el.getAttribute('data-id') || `inline-json-${results.length}`;
      try {
        const data = JSON.parse(el.textContent ?? '');
        results.push({ key: id, data });
      } catch { /* skip malformed */ }
    });

    return results;
  }

  // ── Inject styles ────────────────────────────────────────────────────────────

  const styleEl = document.createElement('style');
  styleEl.id = '__ia-style';
  styleEl.textContent = `
    .__ia-hl {
      outline: 2px solid #f59e0b !important;
      outline-offset: 2px;
      background: rgba(245,158,11,0.08) !important;
    }
    body.__ia-mode, body.__ia-mode * { cursor: crosshair !important; }
    #__ia-panel {
      position: fixed; top: 16px; right: 16px;
      width: 300px; max-height: calc(100vh - 32px); overflow-y: auto;
      background: #1e1e2e; color: #cdd6f4;
      border-radius: 10px; border: 1px solid #313244;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      font: 12px/1.5 'SF Mono','Fira Code',monospace;
      z-index: 2147483647;
    }
    .__ia-hd {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #313244; font-weight: 700;
      cursor: move; user-select: none;
    }
    .__ia-x {
      cursor: pointer; background: none; border: none; color: #6c7086;
      font-size: 15px; padding: 2px 6px; border-radius: 4px; line-height: 1;
    }
    .__ia-x:hover { color: #cdd6f4; background: #313244; }
    .__ia-sec { padding: 10px 14px; border-bottom: 1px solid #313244; }
    .__ia-sec:last-child { border-bottom: none; }
    .__ia-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6c7086; margin-bottom: 6px; }
    .__ia-row { display: flex; align-items: center; justify-content: space-between; }
    .__ia-tbtn {
      padding: 4px 10px; border-radius: 5px; border: none;
      font: 600 11px/1 monospace; cursor: pointer;
    }
    .__ia-tbtn.off { background: #313244; color: #cdd6f4; }
    .__ia-tbtn.on  { background: #f59e0b; color: #1e1e2e; }
    .__ia-st { font-size: 12px; color: #6c7086; }
    .__ia-kv { margin-bottom: 3px; }
    .__ia-k  { color: #6c7086; margin-right: 4px; }
    .__ia-v  { color: #cdd6f4; word-break: break-all; }
    .__ia-chip {
      display: inline-block; padding: 1px 6px; background: #313244;
      border-radius: 3px; font-size: 11px; margin: 2px 2px 0 0; color: #89b4fa;
    }
    .__ia-btn {
      width: 100%; padding: 8px; background: #89b4fa; color: #1e1e2e;
      border: none; border-radius: 6px; font: 600 12px/1 monospace; cursor: pointer;
    }
    .__ia-btn:hover { background: #b4d4ff; }
    .__ia-btn:disabled { opacity: .5; cursor: not-allowed; }
    .__ia-mod { font-size: 14px; font-weight: 700; color: #a6e3a1; margin-bottom: 5px; }
    .__ia-badge {
      display: inline-block; padding: 2px 7px; border-radius: 3px;
      font-size: 10px; font-weight: 600; margin-bottom: 6px;
    }
    .__ia-badge.frontend_static   { background:#313244;color:#cdd6f4; }
    .__ia-badge.api_response      { background:rgba(137,180,250,.18);color:#89b4fa; }
    .__ia-badge.config_driven     { background:rgba(166,227,161,.18);color:#a6e3a1; }
    .__ia-badge.derived_field     { background:rgba(249,226,175,.18);color:#f9e2af; }
    .__ia-badge.unknown_candidate { background:rgba(243,139,168,.18);color:#f38ba8; }
    .__ia-llm { font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(137,180,250,.15);color:#89b4fa;margin-left:4px; }
    .__ia-conf-wrap { height:3px;background:#313244;border-radius:2px;margin:5px 0; }
    .__ia-conf-bar  { height:3px;border-radius:2px;background:#a6e3a1; }
    .__ia-expl { font-size:11px;color:#bac2de;line-height:1.6;margin-top:6px; }
    .__ia-err  { font-size:11px;color:#f38ba8; }
    .__ia-empty { font-size:11px;color:#6c7086;font-style:italic; }
    .__ia-filter-row { display:flex; align-items:center; gap:6px; margin-top:8px; }
    .__ia-filter-lbl { font-size:10px; color:#6c7086; white-space:nowrap; }
    .__ia-filter-input {
      flex:1; background:#313244; border:1px solid #45475a; border-radius:4px;
      color:#cdd6f4; font:11px/1 monospace; padding:3px 6px; outline:none;
    }
    .__ia-filter-input:focus { border-color:#89b4fa; }
    .__ia-net-row { margin-top:4px; padding:4px 6px; background:#181825; border-radius:4px; }
    .__ia-net-ep   { font-size:10px; color:#89b4fa; }
    .__ia-net-count { font-size:10px; color:#a6e3a1; margin-left:4px; }
    .__ia-net-ssr  { font-size:10px; color:#f9e2af; margin-top:2px; }

    /* Settings collapse */
    .__ia-settings { margin-top:6px; }
    .__ia-settings > summary {
      font-size:10px; color:#6c7086; cursor:pointer; user-select:none;
      list-style:none; display:flex; align-items:center; gap:4px;
    }
    .__ia-settings > summary::-webkit-details-marker { display:none; }
    .__ia-settings > summary::before { content:'▸'; font-size:9px; transition:transform .15s; }
    .__ia-settings[open] > summary::before { transform:rotate(90deg); }

    /* Compact element summary */
    .__ia-el-summary { font-size:11px; color:#cdd6f4; word-break:break-all; }
    .__ia-el-tag { color:#89b4fa; font-weight:600; }
    .__ia-el-id  { color:#f9e2af; }
    .__ia-el-text { color:#a6adc8; }

    /* Result layers */
    .__ia-r-section { margin-top:8px; }
    .__ia-r-section:first-child { margin-top:0; }
    .__ia-r-divider { border:none; border-top:1px solid #313244; margin:8px 0; }
    .__ia-ev-item {
      font-size:11px; color:#bac2de; padding:3px 0 3px 8px;
      border-left:2px solid #45475a; margin:4px 0; line-height:1.5;
    }
    .__ia-code-file { font-size:10px; color:#89b4fa; margin-top:4px; }
    .__ia-code-snippet {
      font-size:10px; color:#a6adc8; background:#181825;
      padding:4px 6px; border-radius:3px; margin:2px 0 6px 0;
      overflow-x:auto; white-space:pre; max-height:60px;
    }
    .__ia-conf-pct { font-size:10px; color:#a6adc8; float:right; }

    /* More details collapse */
    .__ia-r-details { margin-top:8px; }
    .__ia-r-details > summary {
      font-size:10px; color:#6c7086; cursor:pointer; user-select:none;
      list-style:none; display:flex; align-items:center; gap:4px;
    }
    .__ia-r-details > summary::-webkit-details-marker { display:none; }
    .__ia-r-details > summary::before { content:'▸'; font-size:9px; transition:transform .15s; }
    .__ia-r-details[open] > summary::before { transform:rotate(90deg); }
    .__ia-r-details-body { margin-top:6px; }
    .__ia-detail-sec { margin-top:8px; }
    .__ia-detail-sec:first-child { margin-top:0; }
  `;
  document.head.appendChild(styleEl);

  // ── Panel DOM ────────────────────────────────────────────────────────────────

  const panel = document.createElement('div');
  panel.id = '__ia-panel';
  panel.innerHTML = `
    <div class="__ia-hd">
      <span>Inspect Agent</span>
      <button class="__ia-x" id="__ia-x">&times;</button>
    </div>
    <div class="__ia-sec">
      <div class="__ia-row">
        <span class="__ia-st" id="__ia-st">Inspect OFF</span>
        <button class="__ia-tbtn off" id="__ia-tb">Enable</button>
      </div>
      <details class="__ia-settings">
        <summary>Settings</summary>
        <div class="__ia-filter-row">
          <span class="__ia-filter-lbl">server:</span>
          <input class="__ia-filter-input" id="__ia-server" placeholder="http://localhost:3001" title="Analyze server URL (saved to localStorage)" />
        </div>
        <div class="__ia-filter-row">
          <span class="__ia-filter-lbl">record path:</span>
          <input class="__ia-filter-input" id="__ia-filter" value="/api/" title="Only record XHR/fetch requests whose path contains this string" />
        </div>
        <div style="font-size:10px;color:#6c7086;margin-top:4px" id="__ia-net-stat">Recording starts when Inspect is ON</div>
        <div class="__ia-filter-row">
          <span class="__ia-filter-lbl">blacklist:</span>
          <input class="__ia-filter-input" id="__ia-blacklist" placeholder="_XView, FlatList, …" title="Comma-separated component names to hide (saved to localStorage)" />
        </div>
      </details>
    </div>
    <div class="__ia-sec">
      <div class="__ia-lbl">Selected Element</div>
      <div class="__ia-empty" id="__ia-empty">Click an element to inspect</div>
      <div id="__ia-ctx" style="display:none"></div>
    </div>
    <div id="__ia-asec" style="display:none" class="__ia-sec">
      <button class="__ia-btn" id="__ia-abtn">Analyze</button>
    </div>
    <div id="__ia-rsec" style="display:none" class="__ia-sec">
      <div class="__ia-lbl">Result</div>
      <div id="__ia-rbody"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const elSt      = panel.querySelector('#__ia-st')      as HTMLElement;
  const elTb      = panel.querySelector('#__ia-tb')      as HTMLButtonElement;
  const elX       = panel.querySelector('#__ia-x')       as HTMLButtonElement;
  const elServer  = panel.querySelector('#__ia-server')  as HTMLInputElement;
  const elFilter  = panel.querySelector('#__ia-filter')  as HTMLInputElement;
  const elNetStat = panel.querySelector('#__ia-net-stat') as HTMLElement;
  const elEmpty   = panel.querySelector('#__ia-empty')   as HTMLElement;
  const elCtx     = panel.querySelector('#__ia-ctx')     as HTMLElement;
  const elAsec    = panel.querySelector('#__ia-asec')    as HTMLElement;
  const elAbtn    = panel.querySelector('#__ia-abtn')    as HTMLButtonElement;
  const elRsec    = panel.querySelector('#__ia-rsec')    as HTMLElement;
  const elRbody   = panel.querySelector('#__ia-rbody')   as HTMLElement;
  const elBlacklist = panel.querySelector('#__ia-blacklist') as HTMLInputElement;

  // Initialise server input from stored value
  elServer.value = SERVER;
  elServer.addEventListener('change', () => {
    SERVER = elServer.value.trim().replace(/\/$/, '');
    localStorage.setItem(LS_KEY, SERVER);
  });

  // Initialise blacklist input
  elBlacklist.value = componentBlacklist.join(', ');
  elBlacklist.addEventListener('change', () => {
    componentBlacklist = elBlacklist.value.split(',').map(s => s.trim()).filter(Boolean);
    localStorage.setItem(LS_BLACKLIST, componentBlacklist.join(','));
  });

  // Sync filter input → networkFilter state
  elFilter.addEventListener('input', () => { networkFilter = elFilter.value.trim() || '/'; });

  // ── Inspect toggle ───────────────────────────────────────────────────────────

  function toggle() {
    inspectActive ? deactivate() : activate();
  }

  function activate() {
    inspectActive = true;
    networkLog = [];   // fresh log every time inspect is turned ON
    document.body.classList.add('__ia-mode');
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('click', onClickEl, true);
    elSt.textContent = 'Inspect ON';
    elTb.textContent = 'Disable';
    elTb.className = '__ia-tbtn on';
    elNetStat.textContent = `Recording "${networkFilter}" requests…`;
  }

  function deactivate() {
    inspectActive = false;
    document.body.classList.remove('__ia-mode');
    document.removeEventListener('mouseover', onOver);
    document.removeEventListener('mouseout', onOut);
    document.removeEventListener('click', onClickEl, true);
    if (lastHighlighted) { lastHighlighted.classList.remove('__ia-hl'); lastHighlighted = null; }
    elSt.textContent = 'Inspect OFF';
    elTb.textContent = 'Enable';
    elTb.className = '__ia-tbtn off';
    elNetStat.textContent = `Recorded ${networkLog.length} request${networkLog.length !== 1 ? 's' : ''}`;
  }

  function destroy() {
    deactivate();
    restoreNetwork();
    panel.remove();
    styleEl.remove();
    delete window.__inspectAgent;
  }

  elTb.addEventListener('click', toggle);
  elX.addEventListener('click', destroy);

  // ── Drag to reposition panel ─────────────────────────────────────────────────
  // Drag from the header bar; position stored in localStorage so it persists.

  const LS_POS = '__ia_pos';
  const elHd = panel.querySelector('.__ia-hd') as HTMLElement;

  // Restore saved position
  try {
    const saved = JSON.parse(localStorage.getItem(LS_POS) ?? 'null');
    if (saved?.x != null && saved?.y != null) {
      panel.style.right = 'auto';
      panel.style.left = `${saved.x}px`;
      panel.style.top  = `${saved.y}px`;
    }
  } catch { /* ignore */ }

  let dragOffX = 0, dragOffY = 0, dragging = false;

  elHd.addEventListener('mousedown', (e: MouseEvent) => {
    // Don't drag when clicking the close button
    if ((e.target as Element).closest('.__ia-x')) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    const x = e.clientX - dragOffX;
    const y = e.clientY - dragOffY;
    // Clamp to viewport
    const maxX = window.innerWidth  - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;
    const cx = Math.max(0, Math.min(x, maxX));
    const cy = Math.max(0, Math.min(y, maxY));
    panel.style.right = 'auto';
    panel.style.left  = `${cx}px`;
    panel.style.top   = `${cy}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    // Persist position
    try {
      localStorage.setItem(LS_POS, JSON.stringify({ x: parseInt(panel.style.left), y: parseInt(panel.style.top) }));
    } catch { /* ignore */ }
  });

  // ── Mouse event handlers ─────────────────────────────────────────────────────

  function onOver(e: MouseEvent) {
    const t = e.target as Element;
    if (panel.contains(t)) return;
    if (lastHighlighted && lastHighlighted !== t) lastHighlighted.classList.remove('__ia-hl');
    t.classList.add('__ia-hl');
    lastHighlighted = t;
  }

  function onOut(e: MouseEvent) {
    const t = e.target as Element;
    if (panel.contains(t)) return;
    t.classList.remove('__ia-hl');
  }

  // 捕获页面元素，获取该元素信息
  function onClickEl(e: MouseEvent) {
    const t = e.target as Element;
    if (panel.contains(t)) return;
    e.preventDefault();
    e.stopPropagation();
    t.classList.remove('__ia-hl');
    if (lastHighlighted === t) lastHighlighted = null;
    // 
    currentContext = extractContext(t);
    renderContext(currentContext);
    elRsec.style.display = 'none';
    elAsec.style.display = '';
  }

  // ── Render context panel (compact) ────────────────────────────────────────────

  function renderContext(ctx: ElementContext) {
    const el = ctx.selectedElement;
    const stack = ctx.reactComponentStack ?? [];
    elEmpty.style.display = 'none';
    elCtx.style.display = '';

    const idPart = el.id ? `<span class="__ia-el-id">#${esc(el.id)}</span>` : '';
    const textPart = el.text
      ? ` <span class="__ia-el-text">"${esc(el.text.slice(0, 50))}${el.text.length > 50 ? '…' : ''}"</span>`
      : '';
    const maxChips = 4;
    const chipHtml = stack.slice(0, maxChips).map(n => `<span class="__ia-chip">${esc(n)}</span>`).join('');
    const overflowHtml = stack.length > maxChips ? `<span class="__ia-chip">+${stack.length - maxChips}</span>` : '';

    elCtx.innerHTML = `
      <div class="__ia-el-summary">
        <span class="__ia-el-tag">&lt;${esc(el.tag)}&gt;</span>${idPart}${textPart}
      </div>
      ${stack.length ? `<div style="margin-top:4px">${chipHtml}${overflowHtml}</div>` : ''}
    `;
  }

  // ── Analyze ──────────────────────────────────────────────────────────────────

  let analyzeController: AbortController | null = null;

  elAbtn.addEventListener('click', async () => {
    // If already analyzing, cancel the request
    if (analyzeController) {
      analyzeController.abort();
      analyzeController = null;
      return;
    }

    if (!currentContext) return;
    analyzeController = new AbortController();
    elAbtn.textContent = 'Cancel';
    elRsec.style.display = '';
    elRbody.innerHTML = '<div class="__ia-st">Analyzing…</div>';

    try {
      const res = await fetch(`${SERVER}/api/analyze-element`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentContext),
        signal: analyzeController.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { result } = (await res.json()) as { result: AnalysisResult };
      renderResult(result);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        elRbody.innerHTML = '<div class="__ia-st">Cancelled</div>';
      } else {
        elRbody.innerHTML = `<div class="__ia-err">Error: ${esc(err.message)}</div>`;
      }
    } finally {
      analyzeController = null;
      elAbtn.textContent = 'Analyze';
    }
  });

  // ── Render result sub-functions ───────────────────────────────────────────────

  function renderResultSummary(r: AnalysisResult): string {
    const pct = Math.round((r.confidence ?? 0) * 100);
    const modeTag = r.analysisMode === 'llm'
      ? `<span class="__ia-llm">${esc(r.modelUsed ?? 'LLM')}</span>`
      : `<span class="__ia-llm">mock</span>`;

    return `
      <div class="__ia-r-section">
        <div class="__ia-mod">${esc(r.moduleName ?? 'Unknown')}${modeTag}</div>
        <div><span class="__ia-badge ${r.sourceType ?? ''}">${esc(r.sourceType ?? 'unknown')}</span></div>
        <div class="__ia-conf-wrap"><div class="__ia-conf-bar" style="width:${pct}%"></div></div>
        <div class="__ia-kv"><span class="__ia-k">confidence</span><span class="__ia-v">${pct}%</span></div>
      </div>
    `;
  }

  function renderResultEvidence(r: AnalysisResult): string {
    const evidence = r.evidence ?? [];
    const components = r.candidateComponents ?? [];
    if (!evidence.length && !components.length) return '';

    const evidenceHtml = evidence.slice(0, 3)
      .map(e => `<div class="__ia-ev-item">${esc(e)}</div>`).join('');

    const chipHtml = components.length
      ? `<div style="margin-top:4px"><span class="__ia-k">components</span><br/>${components.map(c => `<span class="__ia-chip">${esc(c)}</span>`).join('')}</div>`
      : '';

    return `
      <div class="__ia-r-section">
        <hr class="__ia-r-divider"/>
        <div class="__ia-lbl">Evidence</div>
        ${evidenceHtml}
        ${chipHtml}
      </div>
    `;
  }

  function renderResultCode(r: AnalysisResult): string {
    const codeRefs = r.codeReferences ?? [];
    const soaRefs = r.soaReferences ?? [];
    if (!codeRefs.length && !soaRefs.length) return '';

    const codeHtml = codeRefs.slice(0, 3).map(ref =>
      `<div class="__ia-code-file">${esc(ref.file)}:${ref.line}</div>` +
      (ref.snippet ? `<div class="__ia-code-snippet">${esc(ref.snippet)}</div>` : '')
    ).join('');

    const soaHtml = soaRefs.slice(0, 3).map(ref =>
      `<div class="__ia-net-row">
        <div class="__ia-net-ep" title="${esc(ref.file)}:${ref.line}">${esc(ref.methodName)}</div>
        <div style="font-size:10px;color:#6c7086">${esc(ref.endpoint)}</div>
      </div>`
    ).join('');

    return `
      <div class="__ia-r-section">
        <hr class="__ia-r-divider"/>
        <div class="__ia-lbl">Code</div>
        ${codeHtml}
        ${soaHtml}
      </div>
    `;
  }

  function renderResultDetails(r: AnalysisResult, ctx: ElementContext | null): string {
    const parts: string[] = [];

    // Full explanation
    if (r.explanation) {
      parts.push(`<div class="__ia-detail-sec"><div class="__ia-lbl">Explanation</div><div class="__ia-expl">${esc(r.explanation)}</div></div>`);
    }

    // Full evidence list (if more than 3)
    const evidence = r.evidence ?? [];
    if (evidence.length > 3) {
      parts.push(`<div class="__ia-detail-sec"><div class="__ia-lbl">All Evidence (${evidence.length})</div>${evidence.map(e => `<div class="__ia-ev-item">${esc(e)}</div>`).join('')}</div>`);
    }

    // Element context details
    if (ctx) {
      const el = ctx.selectedElement;
      const stack = ctx.reactComponentStack ?? [];
      const net = ctx.networkContext;
      let ctxHtml = `
        <div class="__ia-kv"><span class="__ia-k">tag</span><span class="__ia-v">&lt;${esc(el.tag)}&gt;</span></div>
        ${el.text ? `<div class="__ia-kv"><span class="__ia-k">text</span><span class="__ia-v">"${esc(el.text.slice(0, 120))}"</span></div>` : ''}
        ${el.id ? `<div class="__ia-kv"><span class="__ia-k">id</span><span class="__ia-v">#${esc(el.id)}</span></div>` : ''}
        ${el.className ? `<div class="__ia-kv"><span class="__ia-k">class</span><span class="__ia-v">${esc(el.className.slice(0, 80))}</span></div>` : ''}
      `;
      if (stack.length) {
        ctxHtml += `<div class="__ia-kv" style="margin-top:4px"><span class="__ia-k">components</span><br/>${stack.map(n => `<span class="__ia-chip">${esc(n)}</span>`).join('')}</div>`;
      }
      ctxHtml += `
        <div style="margin-top:6px">
          <span class="__ia-k">network</span>
          <span class="__ia-net-count">${net.requests.length} request${net.requests.length !== 1 ? 's' : ''}</span>
          ${net.requests.slice(0, 5).map(r => `<div class="__ia-net-row"><div class="__ia-net-ep">${esc(r.method)} ${esc(r.endpoint)}</div></div>`).join('')}
          ${net.ssrData.length ? `<div class="__ia-net-ssr">SSR: ${net.ssrData.map(s => esc(s.key)).join(', ')}</div>` : ''}
        </div>
      `;
      parts.push(`<div class="__ia-detail-sec"><div class="__ia-lbl">Element Context</div>${ctxHtml}</div>`);
    }

    // All code references (if more than 3)
    const codeRefs = r.codeReferences ?? [];
    if (codeRefs.length > 3) {
      parts.push(`<div class="__ia-detail-sec"><div class="__ia-lbl">All Code References (${codeRefs.length})</div>${codeRefs.map(ref =>
        `<div class="__ia-code-file">${esc(ref.file)}:${ref.line}</div>` +
        (ref.snippet ? `<div class="__ia-code-snippet">${esc(ref.snippet)}</div>` : '')
      ).join('')}</div>`);
    }

    // All SOA references (if more than 3)
    const soaRefs = r.soaReferences ?? [];
    if (soaRefs.length > 3) {
      parts.push(`<div class="__ia-detail-sec"><div class="__ia-lbl">All SOA Endpoints (${soaRefs.length})</div>${soaRefs.map(ref =>
        `<div class="__ia-net-row">
          <div class="__ia-net-ep" title="${esc(ref.file)}:${ref.line}">${esc(ref.methodName)}</div>
          <div style="font-size:10px;color:#6c7086">${esc(ref.endpoint)}</div>
        </div>`
      ).join('')}</div>`);
    }

    if (!parts.length) return '';

    return `
      <details class="__ia-r-details">
        <summary>More details</summary>
        <div class="__ia-r-details-body">${parts.join('')}</div>
      </details>
    `;
  }

  // ── Render result (compositor) ────────────────────────────────────────────────

  function renderResult(r: AnalysisResult) {
    elRbody.innerHTML =
      renderResultSummary(r) +
      renderResultEvidence(r) +
      renderResultCode(r) +
      renderResultDetails(r, currentContext);
  }

  // ── HTML escaping ─────────────────────────────────────────────────────────────

  function esc(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── React Fiber component stack ───────────────────────────────────────────────

  function unwrapHOC(name: string): string | null {
    const m = name.match(/^(?:Memo|ForwardRef|WithRouter|Connect|Styled)\((.+)\)$/);
    return m ? m[1] : null;
  }

  /** Pattern-based filter for framework/library components (not project-specific) */
  function isFrameworkNoise(name: string): boolean {
    if (name.startsWith('React')) return true;
    // 只过滤"纯泛型"组件：名字本身就是 Provider/Wrapper 等，或只有一个短前缀（如 AppWrapper, ThemeProvider）
    // 像 StaticInfoWrapper、HotelInfoProvider 这种多段业务命名不过滤
    if (/^[A-Z][a-z]*(?:Provider|Consumer|Adapter|Boundary|Overlay|Wrapper|Context)$/.test(name)) return true;
    if (/^(?:Root|App|MyApp|Container|AppContainer)$/.test(name)) return true;
    if (componentBlacklist.length && componentBlacklist.some(b => name === b || name.startsWith(b))) return true;
    return false;
  }

  // 给定一个 DOM 元素，找出渲染它的 React 组件调用链
  function getReactComponentStack(el: Element): string[] {
    // step1: 找到 React 内部 Fiber 节点
    const key = Object.keys(el).find(
      k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    if (!key) return [];
    let fiber: any = (el as any)[key];
    const stack: string[] = [];
    // 沿 fiber.return 向上遍历组件树
    while (fiber) {
      const t = fiber.type;
      let name: string | undefined;

      if (typeof t === 'function') {
        // 普通 function / class component
        name = t.displayName || t.name;
      } else if (t && typeof t === 'object') {
        // React.memo() → { $$typeof, type: fn }
        // React.forwardRef() → { $$typeof, render: fn }
        name = t.displayName;
        if (!name) {
          const inner = t.type || t.render;
          if (typeof inner === 'function') {
            name = inner.displayName || inner.name;
          }
        }
      }

      if (name) {
        name = unwrapHOC(name) ?? name;
        const isMinified = name.length < 4 && name === name.toLowerCase();
        const isNoise = isFrameworkNoise(name);
        const isDup = stack.includes(name);
        const accepted = name.length > 1 && name !== 'Anonymous' && !isMinified && !isNoise && !isDup;
        if (accepted)
          stack.push(name);
      }
      fiber = fiber.return; // 向上遍历组件树
    }
    return stack;
  }

  // ── CSS Selector ──────────────────────────────────────────────────────────────

  function getCssSelector(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body) {
      if (cur.id) { parts.unshift(`#${cur.id}`); break; }
      let seg = cur.tagName.toLowerCase();
      const cls = Array.from(cur.classList).find(c => !c.startsWith('__ia-'));
      if (cls) seg += `.${cls}`;
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur!.tagName);
        if (same.length > 1) seg += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // ── XPath ─────────────────────────────────────────────────────────────────────

  function getXPath(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur!.tagName);
        parts.unshift(same.length > 1 ? `${tag}[${same.indexOf(cur) + 1}]` : tag);
      } else { parts.unshift(tag); }
      cur = cur.parentElement;
    }
    return `/${parts.join('/')}`;
  }

  // ── Extract full element context ──────────────────────────────────────────────
  // 返回四个维度的对象：ancestors / siblings / nearbyTexts / reactComponentStack
  function extractContext(el: Element): ElementContext {
    const ancestors: ElementContext['ancestors'] = [];
    let anc = el.parentElement;
    // 向上最多 5 层父元素的 tag / class / id --- 理解元素所在的 DOM 层级结构
    for (let i = 0; i < 5 && anc && anc !== document.body; i++) {
      ancestors.push({ tag: anc.tagName.toLowerCase(), className: anc.className ?? '', id: anc.id ?? '' });
      anc = anc.parentElement;
    }
    
    // 同级元素的 tag / text / class --- 理解元素所在的横向布局语义
    const siblings: ElementContext['siblings'] = [];
    if (el.parentElement) {
      Array.from(el.parentElement.children).forEach(s => {
        if (s !== el) siblings.push({
          tag: s.tagName.toLowerCase(),
          text: (s.textContent ?? '').trim().slice(0, 60),
          className: (s as HTMLElement).className ?? '',
        });
      });
    }

    // 父元素内所有子节点的文本（去重，1~120 字符，最多 10 条） --- 捕获周围的可读文字，提供语义线索
    const nearbyTexts: string[] = [];
    const selfText = (el.textContent ?? '').trim();
    if (el.parentElement) {
      el.parentElement.querySelectorAll('*').forEach(node => {
        const t = (node.textContent ?? '').trim();
        if (t && t !== selfText && t.length > 1 && t.length < 120 && !nearbyTexts.includes(t))
          nearbyTexts.push(t);
      });
    }

    return {
      url: window.location.href,
      selectedElement: {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? '').trim().slice(0, 200),
        className: (el as HTMLElement).className ?? '',
        id: el.id ?? '',
        selector: getCssSelector(el),
        xpath: getXPath(el),
      },
      ancestors,
      siblings,
      nearbyTexts: nearbyTexts.slice(0, 10),
      reactComponentStack: getReactComponentStack(el), // 组件调用栈
      networkContext: { // 当前网络过滤器 + 已记录的请求日志 + SSR 数据 --- 关联点击时刻的数据层状态
        filter: networkFilter,
        requests: [...networkLog],   // snapshot at click time
        ssrData: scanSsrData(),
      },
    };
  }

  // Register singleton so re-clicking the bookmarklet toggles instead of re-injects
  window.__inspectAgent = { toggle, destroy };
}
