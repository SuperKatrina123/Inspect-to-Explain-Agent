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

interface NetworkMatch {
  method: string;
  endpoint: string;       // e.g. "GET /api/v1/order/detail"
  fieldPath: string;      // e.g. "data.items[0].price"
  value: string;
  timestamp: number;
}

interface RecordedRequest {
  method: string;
  url: string;
  body: any;              // parsed JSON response body
  timestamp: number;
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
  networkMatches: NetworkMatch[];   // values found in recorded API responses
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
  const SERVER = __SERVER_URL__;

  let inspectActive = false;
  let lastHighlighted: Element | null = null;
  let currentContext: ElementContext | null = null;

  // ── Network interceptor ───────────────────────────────────────────────────────
  // Start recording immediately so we capture requests made before user clicks.
  // Capped at MAX_RECORDS entries (oldest dropped first).

  const MAX_RECORDS = 60;
  const networkLog: RecordedRequest[] = [];

  const _origFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const res = await _origFetch(input, init);
    // Clone so the original response body stream is untouched
    const clone = res.clone();
    const ct = clone.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      clone.json().then((body: any) => {
        networkLog.push({ method, url, body, timestamp: Date.now() });
        if (networkLog.length > MAX_RECORDS) networkLog.shift();
      }).catch(() => { /* non-JSON or parse error — ignore */ });
    }
    return res;
  } as typeof fetch;

  // XHR patch
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest & { __ia_method?: string; __ia_url?: string },
    method: string, url: string | URL, ...rest: any[]
  ) {
    this.__ia_method = method.toUpperCase();
    this.__ia_url = url.toString();
    return (_origOpen as Function).call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(
    this: XMLHttpRequest & { __ia_method?: string; __ia_url?: string },
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    this.addEventListener('load', function () {
      const ct = this.getResponseHeader('content-type') ?? '';
      if (ct.includes('application/json') && this.responseText) {
        try {
          const parsed = JSON.parse(this.responseText);
          networkLog.push({
            method: this.__ia_method ?? 'GET',
            url: this.__ia_url ?? '',
            body: parsed,
            timestamp: Date.now(),
          });
          if (networkLog.length > MAX_RECORDS) networkLog.shift();
        } catch { /* ignore */ }
      }
    });
    return _origSend.call(this, body);
  };

  // Restore original fetch/XHR on destroy
  function restoreNetwork() {
    window.fetch = _origFetch;
    XMLHttpRequest.prototype.open = _origOpen;
    XMLHttpRequest.prototype.send = _origSend;
  }

  // ── Find matching field paths in a recorded response body ─────────────────────
  // Recursively walks the JSON tree. Returns all paths where the value matches
  // the search string (case-insensitive, trimmed).

  function findInObject(obj: any, search: string, path = '', results: Array<{ path: string; value: string }> = []) {
    if (results.length >= 5) return results; // cap per-request matches
    if (obj === null || obj === undefined) return results;

    if (typeof obj === 'string' || typeof obj === 'number') {
      const val = String(obj).trim();
      if (val.length > 0 && search.length > 0 && val.toLowerCase().includes(search.toLowerCase())) {
        results.push({ path, value: val });
      }
      return results;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length && results.length < 5; i++) {
        findInObject(obj[i], search, `${path}[${i}]`, results);
      }
      return results;
    }

    if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (results.length >= 5) break;
        findInObject(obj[key], search, path ? `${path}.${key}` : key, results);
      }
    }

    return results;
  }

  // Search all recorded requests for a given text, return top matches
  function searchNetworkLog(text: string): NetworkMatch[] {
    if (!text || text.length < 2) return [];
    const matches: NetworkMatch[] = [];

    for (const record of [...networkLog].reverse()) { // most recent first
      if (matches.length >= 8) break;
      const hits = findInObject(record.body, text);
      for (const hit of hits) {
        const urlObj = (() => { try { return new URL(record.url); } catch { return null; } })();
        const endpoint = `${record.method} ${urlObj ? urlObj.pathname : record.url}`;
        matches.push({
          method: record.method,
          endpoint,
          fieldPath: hit.path,
          value: hit.value,
          timestamp: record.timestamp,
        });
      }
    }
    return matches;
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
  `;
  document.head.appendChild(styleEl);

  // ── Panel DOM ────────────────────────────────────────────────────────────────

  const panel = document.createElement('div');
  panel.id = '__ia-panel';
  panel.innerHTML = `
    <div class="__ia-hd">
      <span>🔍 Inspect Agent</span>
      <button class="__ia-x" id="__ia-x">✕</button>
    </div>
    <div class="__ia-sec">
      <div class="__ia-row">
        <span class="__ia-st" id="__ia-st">Inspect OFF</span>
        <button class="__ia-tbtn off" id="__ia-tb">Enable</button>
      </div>
    </div>
    <div class="__ia-sec">
      <div class="__ia-lbl">Selected Element</div>
      <div class="__ia-empty" id="__ia-empty">Click an element to inspect</div>
      <div id="__ia-ctx" style="display:none"></div>
    </div>
    <div id="__ia-asec" style="display:none" class="__ia-sec">
      <button class="__ia-btn" id="__ia-abtn">🔍 Analyze Element</button>
    </div>
    <div id="__ia-rsec" style="display:none" class="__ia-sec">
      <div class="__ia-lbl">Analysis Result</div>
      <div id="__ia-rbody"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const elSt    = panel.querySelector('#__ia-st')    as HTMLElement;
  const elTb    = panel.querySelector('#__ia-tb')    as HTMLButtonElement;
  const elX     = panel.querySelector('#__ia-x')     as HTMLButtonElement;
  const elEmpty = panel.querySelector('#__ia-empty') as HTMLElement;
  const elCtx   = panel.querySelector('#__ia-ctx')   as HTMLElement;
  const elAsec  = panel.querySelector('#__ia-asec')  as HTMLElement;
  const elAbtn  = panel.querySelector('#__ia-abtn')  as HTMLButtonElement;
  const elRsec  = panel.querySelector('#__ia-rsec')  as HTMLElement;
  const elRbody = panel.querySelector('#__ia-rbody') as HTMLElement;

  // ── Inspect toggle ───────────────────────────────────────────────────────────

  function toggle() {
    inspectActive ? deactivate() : activate();
  }

  function activate() {
    inspectActive = true;
    document.body.classList.add('__ia-mode');
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('click', onClickEl, true);
    elSt.textContent = 'Inspect ON';
    elTb.textContent = 'Disable';
    elTb.className = '__ia-tbtn on';
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

  function onClickEl(e: MouseEvent) {
    const t = e.target as Element;
    if (panel.contains(t)) return;
    e.preventDefault();
    e.stopPropagation();
    currentContext = extractContext(t);
    renderContext(currentContext);
    elRsec.style.display = 'none';
    elAsec.style.display = '';
  }

  // ── Render context panel ─────────────────────────────────────────────────────

  function renderContext(ctx: ElementContext) {
    const el = ctx.selectedElement;
    const stack = ctx.reactComponentStack;
    const nets = ctx.networkMatches;
    elEmpty.style.display = 'none';
    elCtx.style.display = '';
    elCtx.innerHTML = `
      <div class="__ia-kv"><span class="__ia-k">tag</span><span class="__ia-v">&lt;${esc(el.tag)}&gt;</span></div>
      ${el.text ? `<div class="__ia-kv"><span class="__ia-k">text</span><span class="__ia-v">"${esc(el.text.slice(0, 80))}"</span></div>` : ''}
      ${el.id ? `<div class="__ia-kv"><span class="__ia-k">id</span><span class="__ia-v">#${esc(el.id)}</span></div>` : ''}
      ${el.className ? `<div class="__ia-kv"><span class="__ia-k">class</span><span class="__ia-v">${esc(el.className.slice(0, 60))}</span></div>` : ''}
      ${stack.length ? `
        <div class="__ia-kv" style="margin-top:6px">
          <span class="__ia-k">components</span><br/>
          ${stack.map(n => `<span class="__ia-chip">${esc(n)}</span>`).join('')}
        </div>` : ''}
      ${nets.length ? `
        <div style="margin-top:8px">
          <span class="__ia-k">📡 network</span>
          <span class="__ia-net-count">${nets.length} match${nets.length > 1 ? 'es' : ''}</span>
          ${nets.slice(0, 3).map(m => `
            <div class="__ia-net-row">
              <div class="__ia-net-ep">${esc(m.endpoint)}</div>
              <div class="__ia-net-path">${esc(m.fieldPath)}</div>
            </div>`).join('')}
        </div>` : `<div style="margin-top:6px;font-size:10px;color:#6c7086">📡 no network match — may be static</div>`}
    `;
  }

  // ── Analyze ──────────────────────────────────────────────────────────────────

  elAbtn.addEventListener('click', async () => {
    if (!currentContext) return;
    elAbtn.disabled = true;
    elAbtn.textContent = '⏳ Analyzing…';
    elRsec.style.display = '';
    elRbody.innerHTML = '<div class="__ia-st">Sending to server…</div>';

    try {
      const res = await fetch(`${SERVER}/api/analyze-element`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentContext),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { result } = (await res.json()) as { result: AnalysisResult };
      renderResult(result);
    } catch (err: any) {
      elRbody.innerHTML = `<div class="__ia-err">Error: ${esc(err.message)}</div>`;
    } finally {
      elAbtn.disabled = false;
      elAbtn.textContent = '🔍 Analyze Element';
    }
  });

  // ── Render result panel ──────────────────────────────────────────────────────

  function renderResult(r: AnalysisResult) {
    const pct = Math.round(r.confidence * 100);
    const modeTag = r.analysisMode === 'llm'
      ? `<span class="__ia-llm">${esc(r.modelUsed ?? 'LLM')}</span>`
      : `<span class="__ia-llm">mock</span>`;

    elRbody.innerHTML = `
      <div class="__ia-mod">${esc(r.moduleName)}${modeTag}</div>
      <div><span class="__ia-badge ${r.sourceType}">${r.sourceType}</span></div>
      <div class="__ia-conf-wrap"><div class="__ia-conf-bar" style="width:${pct}%"></div></div>
      <div class="__ia-kv"><span class="__ia-k">confidence</span><span class="__ia-v">${pct}%</span></div>
      ${r.candidateComponents?.length ? `
        <div class="__ia-kv" style="margin-top:4px">
          <span class="__ia-k">components</span><br/>
          ${r.candidateComponents.map(c => `<span class="__ia-chip">${esc(c)}</span>`).join('')}
        </div>` : ''}
      ${r.explanation ? `<div class="__ia-expl">${esc(r.explanation)}</div>` : ''}
      ${r.codeReferences?.length ? `
        <div style="margin-top:8px">
          <div class="__ia-lbl">Code References</div>
          ${r.codeReferences.slice(0, 3).map(ref =>
            `<div style="font-size:10px;color:#6c7086">${esc(ref.file)}:${ref.line}</div>`
          ).join('')}
        </div>` : ''}
    `;
  }

  // ── HTML escaping ─────────────────────────────────────────────────────────────

  function esc(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── React Fiber component stack ───────────────────────────────────────────────

  function getReactComponentStack(el: Element): string[] {
    const key = Object.keys(el).find(
      k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    if (!key) return [];
    let fiber: any = (el as any)[key];
    const stack: string[] = [];
    while (fiber) {
      const t = fiber.type;
      if (typeof t === 'function') {
        const name: string | undefined = t.displayName || t.name;
        if (name && name.length > 1 && name !== 'Anonymous' && !stack.includes(name))
          stack.push(name);
      }
      fiber = fiber.return;
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

  function extractContext(el: Element): ElementContext {
    const ancestors: ElementContext['ancestors'] = [];
    let anc = el.parentElement;
    for (let i = 0; i < 5 && anc && anc !== document.body; i++) {
      ancestors.push({ tag: anc.tagName.toLowerCase(), className: anc.className ?? '', id: anc.id ?? '' });
      anc = anc.parentElement;
    }

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
      reactComponentStack: getReactComponentStack(el),
      // Search recorded network responses for this element's text
      networkMatches: searchNetworkLog((el.textContent ?? '').trim()),
    };
  }

  // Register singleton so re-clicking the bookmarklet toggles instead of re-injects
  window.__inspectAgent = { toggle, destroy };
}
