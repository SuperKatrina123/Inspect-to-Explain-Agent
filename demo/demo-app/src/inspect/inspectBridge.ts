/**
 * inspectBridge.ts
 *
 * Cross-frame inspection bridge for the demo app.
 * Listens for messages from the parent window (apps/web) and attaches
 * hover/click listeners to DOM elements when inspect mode is active.
 * On click, it collects the element context and posts it back to the parent.
 */

export interface InspectElementContext {
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
  /**
   * React component names read directly from the React Fiber tree,
   * ordered nearest → root (e.g. ["OrderItemRow","OrderSummary","App"]).
   * Empty array if React Fiber is not accessible (non-React page, production
   * minified build, or the element is rendered outside React).
   */
  reactComponentStack: string[];
}

// ── React Fiber: read actual component tree ───────────────────────────────────

/**
 * Walk up the React Fiber tree starting from the given DOM element and
 * collect names of every React component encountered (nearest first).
 *
 * React attaches the root fiber to DOM nodes under a key that starts with
 * "__reactFiber$" (React 17+) or "__reactInternalInstance$" (React 15/16).
 * Walking fiber.return gives the parent fiber; typeof fiber.type === 'function'
 * means it's a React component (as opposed to a host element like 'div').
 *
 * Notes:
 *   - Only works in development builds where function names are preserved.
 *   - Anonymous components (() => <div>) are skipped gracefully.
 *   - Non-React pages return an empty array.
 */
function getReactComponentStack(el: Element): string[] {
  // Locate whichever internal fiber key React chose for this element
  const fiberKey = Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  );
  if (!fiberKey) return [];

  let fiber: any = (el as any)[fiberKey];
  const stack: string[] = [];

  while (fiber) {
    const type = fiber.type;
    if (typeof type === 'function') {
      const name: string | undefined = type.displayName || type.name;
      // Skip very short names, internal React names, and duplicates
      if (name && name.length > 1 && name !== 'Anonymous' && !stack.includes(name)) {
        stack.push(name);
      }
    }
    fiber = fiber.return; // walk toward the root
  }

  return stack;
}

// ── CSS selector generation ───────────────────────────────────────────────────
function getCssSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;

  while (cur && cur !== document.body) {
    if (cur.id) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    let seg = cur.tagName.toLowerCase();
    // Add first meaningful class (skip inspect helper classes)
    const cls = Array.from(cur.classList)
      .find((c) => !c.startsWith('inspect-'));
    if (cls) seg += `.${cls}`;
    // nth-of-type for disambiguation among same-tag siblings
    const parent = cur.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === cur!.tagName,
      );
      if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
    }
    parts.unshift(seg);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

// ── XPath generation ──────────────────────────────────────────────────────────
function getXPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;

  while (cur && cur !== document.documentElement) {
    const tag = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === cur!.tagName,
      );
      parts.unshift(
        sameTag.length > 1 ? `${tag}[${sameTag.indexOf(cur) + 1}]` : tag,
      );
    } else {
      parts.unshift(tag);
    }
    cur = cur.parentElement;
  }
  return `/${parts.join('/')}`;
}

// ── Extract full element context ──────────────────────────────────────────────
function extractContext(el: Element): InspectElementContext {
  // Ancestors: walk up to 5 levels
  const ancestors: InspectElementContext['ancestors'] = [];
  let anc = el.parentElement;
  for (let i = 0; i < 5 && anc && anc !== document.body; i++) {
    ancestors.push({ tag: anc.tagName.toLowerCase(), className: anc.className ?? '', id: anc.id ?? '' });
    anc = anc.parentElement;
  }

  // Siblings: direct children of parent, excluding self
  const siblings: InspectElementContext['siblings'] = [];
  if (el.parentElement) {
    Array.from(el.parentElement.children).forEach((s) => {
      if (s !== el) {
        siblings.push({
          tag: s.tagName.toLowerCase(),
          text: (s.textContent ?? '').trim().slice(0, 60),
          className: (s as HTMLElement).className ?? '',
        });
      }
    });
  }

  // Nearby texts: visible text nodes within the parent container
  const nearbyTexts: string[] = [];
  const selfText = (el.textContent ?? '').trim();
  if (el.parentElement) {
    el.parentElement.querySelectorAll('*').forEach((node) => {
      const t = (node.textContent ?? '').trim();
      if (t && t !== selfText && t.length > 1 && t.length < 120 && !nearbyTexts.includes(t)) {
        nearbyTexts.push(t);
      }
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
    // Real component tree from React Fiber — most reliable signal available
    reactComponentStack: getReactComponentStack(el),
  };
}

// ── Event handler state ────────────────────────────────────────────────────────
let active = false;
let lastHighlighted: Element | null = null;

function onMouseOver(e: MouseEvent) {
  if (!active) return;
  const target = e.target as Element;
  if (lastHighlighted && lastHighlighted !== target) {
    lastHighlighted.classList.remove('inspect-highlight');
  }
  target.classList.add('inspect-highlight');
  lastHighlighted = target;
}

function onMouseOut(e: MouseEvent) {
  if (!active) return;
  (e.target as Element).classList.remove('inspect-highlight');
}

function onClick(e: MouseEvent) {
  if (!active) return;
  e.preventDefault();
  e.stopPropagation();
  const target = e.target as Element;
  target.classList.remove('inspect-highlight');
  if (lastHighlighted === target) lastHighlighted = null;
  const ctx = extractContext(target);
  // Post context to parent web app
  window.parent.postMessage({ type: 'ELEMENT_SELECT', data: ctx }, '*');
}

// Inject highlight CSS once
function injectStyles() {
  if (document.getElementById('inspect-bridge-style')) return;
  const s = document.createElement('style');
  s.id = 'inspect-bridge-style';
  s.textContent = `
    .inspect-highlight {
      outline: 2px solid #f59e0b !important;
      outline-offset: 2px;
      background: rgba(245,158,11,0.08) !important;
    }
    body.inspect-mode, body.inspect-mode * { cursor: crosshair !important; }
  `;
  document.head.appendChild(s);
}

function enable() {
  if (active) return;
  active = true;
  injectStyles();
  document.body.classList.add('inspect-mode');
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('mouseout', onMouseOut);
  document.addEventListener('click', onClick, true);
}

function disable() {
  if (!active) return;
  active = false;
  document.body.classList.remove('inspect-mode');
  if (lastHighlighted) { lastHighlighted.classList.remove('inspect-highlight'); lastHighlighted = null; }
  document.removeEventListener('mouseover', onMouseOver);
  document.removeEventListener('mouseout', onMouseOut);
  document.removeEventListener('click', onClick, true);
}

// ── Public API ────────────────────────────────────────────────────────────────
export function initInspectBridge() {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'ENABLE_INSPECT') enable();
    if (e.data?.type === 'DISABLE_INSPECT') disable();
  });
}
