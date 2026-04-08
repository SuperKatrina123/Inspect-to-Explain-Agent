/**
 * React DOM Inspector — 浏览器侧 React Fiber 反查模块
 *
 * 从任意 DOM 节点出发，反查 React Fiber 树，提取组件栈、props 摘要、DOM 语义信息，
 * 生成适合喂给 LLM 的结构化 JSON payload。
 *
 * ⚠️  WARNING: 本模块依赖 React 内部 Fiber 实现（__reactFiber$*、__reactProps$*、
 * fiber.tag 等），这些字段不属于 React 公开 API，可能在任意版本变更。
 * 已在 React 16.8 – 19 上验证。生产环境使用需做好降级处理。
 *
 * @module reactInspector
 */

// ── Fiber Tag 常量（React 内部，不同版本可能变化）──────────────────────────────
// 用于区分 fiber 节点类型，比 typeof fiber.type 更可靠

const FIBER_TAG = {
  FUNCTION_COMPONENT: 0,
  CLASS_COMPONENT: 1,
  HOST_ROOT: 3,
  HOST_COMPONENT: 5,        // <div>, <span> 等原生 DOM 节点
  HOST_TEXT: 6,
  FRAGMENT: 7,
  MODE: 8,
  CONTEXT_CONSUMER: 9,
  CONTEXT_PROVIDER: 10,
  FORWARD_REF: 11,
  PROFILER: 12,
  SUSPENSE: 13,
  MEMO: 14,
  SIMPLE_MEMO: 15,
  LAZY: 16,
} as const;

/** 不包含业务逻辑的 fiber tag，遍历时直接跳过 */
const SKIP_TAGS = new Set([
  FIBER_TAG.HOST_ROOT,
  FIBER_TAG.HOST_COMPONENT,
  FIBER_TAG.HOST_TEXT,
  FIBER_TAG.FRAGMENT,
  FIBER_TAG.MODE,
  FIBER_TAG.PROFILER,
]);

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComponentEntry {
  name: string;
  tag: number;
  depth: number;
}

export interface ReactInspection {
  /** 最近的 React 组件（含框架组件） */
  nearestComponent: string | null;
  /** 经过降噪的业务组件栈，nearest → root */
  businessStack: string[];
  /** 最近业务组件的 props 摘要（不含 children / event handler） */
  propsSummary: Record<string, unknown> | null;
  /** Fiber 遍历深度 */
  fiberDepth: number;
}

export interface DomSummary {
  tag: string;
  text: string;
  id: string;
  className: string;
  role: string | null;
  ariaLabel: string | null;
  testId: string | null;
  placeholder: string | null;
}

export interface InspectionContext {
  dom: DomSummary;
  react: ReactInspection;
}

export interface LLMPayload {
  element: DomSummary;
  nearestComponent: string | null;
  businessStack: string[];
  propsSummary: Record<string, unknown> | null;
}

// ── 配置 ─────────────────────────────────────────────────────────────────────

const MAX_FIBER_DEPTH = 60;
const MAX_PROP_STRING_LEN = 120;
const MAX_PROP_ARRAY_LEN = 5;
const MAX_PROP_KEYS = 15;

/**
 * 框架 / 库级组件名黑名单。
 * 这些组件几乎不会包含业务信息，遍历时跳过。
 */
const FRAMEWORK_NOISE_PATTERNS: RegExp[] = [
  /^React\./,                                       // React.Fragment, React.StrictMode 等
  /^(?:React|Suspense|Profiler|StrictMode)$/,
  /^(?:Root|App|MyApp|AppContainer)$/,               // 顶层容器
  /^(?:ThemeProvider|StyleProvider|StoreProvider)$/,   // 常见 Provider
  /^(?:Route|Switch|Router|Link|NavLink|Redirect)$/,  // react-router
  /^(?:Provider|Consumer|Connect)$/,                  // redux / context
  /^(?:Query|Mutation|ApolloProvider)$/,               // apollo
  /^(?:Head|Script|NextScript)$/,                      // next.js
];

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * 从 DOM 节点查找关联的 React Fiber 节点。
 * React 在 DOM 节点上挂载以 `__reactFiber$` 或 `__reactInternalInstance$` 开头的属性。
 */
export function getReactFiberFromDom(el: Element): any | null {
  const key = Object.keys(el).find(
    k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  );
  return key ? (el as any)[key] : null;
}

/**
 * 从 DOM 节点提取 React props 对象。
 * React 在 DOM 节点上挂载以 `__reactProps$` 开头的属性，包含该节点的 JSX props。
 */
export function getReactPropsFromDom(el: Element): Record<string, any> | null {
  const key = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (!key) return null;
  const props = (el as any)[key];
  return props && typeof props === 'object' ? props : null;
}

/**
 * 从单个 Fiber 节点提取组件显示名。
 * 兼容 function component / class component / React.memo / React.forwardRef / lazy。
 *
 * 对于包装类型（memo、forwardRef），会穿透到内部函数获取真实名称。
 */
export function getDisplayNameFromFiber(fiber: any): string | null {
  const t = fiber.type;
  if (t == null) return null;

  // function / class component
  if (typeof t === 'function') {
    return t.displayName || t.name || null;
  }

  // object 类型: memo, forwardRef, lazy
  if (typeof t === 'object') {
    // 优先读对象自身的 displayName
    if (t.displayName) return t.displayName;

    // React.memo → t.type 是内部组件
    // React.forwardRef → t.render 是内部函数
    const inner = t.type || t.render;
    if (typeof inner === 'function') {
      return inner.displayName || inner.name || null;
    }
    // 嵌套: memo(forwardRef(fn))
    if (inner && typeof inner === 'object') {
      if (inner.displayName) return inner.displayName;
      const deep = inner.type || inner.render;
      if (typeof deep === 'function') {
        return deep.displayName || deep.name || null;
      }
    }
  }

  return null;
}

/**
 * 解包 HOC 命名模式。
 * e.g. "Memo(UserCard)" → "UserCard", "ForwardRef(Button)" → "Button"
 */
function unwrapHOCName(name: string): string {
  const m = name.match(/^(?:Memo|ForwardRef|WithRouter|Connect|Styled|WithStyles|WithTheme)\((.+)\)$/);
  return m ? m[1] : name;
}

/**
 * 判断名称是否为压缩 / minified 的组件名。
 * 压缩后的组件名通常很短且全小写（如 "e", "t", "ke"）。
 */
function isMinifiedName(name: string): boolean {
  return name.length <= 2 || (name.length <= 3 && name === name.toLowerCase());
}

/**
 * 判断 fiber 节点是否为 React 组件（而非 host DOM 节点、文本、fragment 等）。
 */
function isComponentFiber(fiber: any): boolean {
  const tag = fiber.tag;
  return !SKIP_TAGS.has(tag) && tag !== undefined;
}

/**
 * 从起始 Fiber 节点沿 fiber.return 向上遍历，提取完整组件栈。
 *
 * @returns 去重的组件条目数组，nearest component first
 */
export function getReactComponentStackFromFiber(startFiber: any): ComponentEntry[] {
  const stack: ComponentEntry[] = [];
  const seen = new Set<string>();
  let fiber = startFiber;
  let depth = 0;

  while (fiber && depth < MAX_FIBER_DEPTH) {
    depth++;

    if (isComponentFiber(fiber)) {
      let name = getDisplayNameFromFiber(fiber);
      if (name) {
        name = unwrapHOCName(name);
        if (!isMinifiedName(name) && name !== 'Anonymous' && !seen.has(name)) {
          seen.add(name);
          stack.push({ name, tag: fiber.tag, depth });
        }
      }
    }

    fiber = fiber.return;
  }

  return stack;
}

/**
 * 判断组件名是否为框架噪音。
 * 采用模式匹配而非后缀匹配，避免误杀多段式业务命名（如 StaticInfoWrapper）。
 */
function isFrameworkNoise(name: string): boolean {
  return FRAMEWORK_NOISE_PATTERNS.some(re => re.test(name));
}

/**
 * 对组件栈降噪，过滤掉框架 / 库级组件，保留业务组件。
 * 支持用户自定义黑名单。
 *
 * @param stack      - getReactComponentStackFromFiber 的输出
 * @param blacklist  - 用户自定义黑名单（精确匹配 or 前缀匹配）
 * @returns 业务组件名数组，nearest first
 */
export function cleanBusinessStack(
  stack: ComponentEntry[],
  blacklist: string[] = [],
): string[] {
  return stack
    .filter(entry => {
      const { name, tag } = entry;
      // 跳过 ContextProvider / ContextConsumer / Suspense
      if (tag === FIBER_TAG.CONTEXT_PROVIDER || tag === FIBER_TAG.CONTEXT_CONSUMER || tag === FIBER_TAG.SUSPENSE) {
        return false;
      }
      if (isFrameworkNoise(name)) return false;
      if (blacklist.length && blacklist.some(b => name === b || name.startsWith(b))) return false;
      return true;
    })
    .map(entry => entry.name);
}

/**
 * 生成 props 摘要。
 * 过滤掉 children、event handler（on* 函数）、React 内部属性，
 * 截断长字符串，限制数组长度。
 */
export function summarizeProps(props: Record<string, any> | null): Record<string, unknown> | null {
  if (!props) return null;

  const summary: Record<string, unknown> = {};
  let count = 0;

  for (const [key, val] of Object.entries(props)) {
    if (count >= MAX_PROP_KEYS) break;

    // 跳过 React 内部 + event handler + children
    if (key === 'children' || key === 'key' || key === 'ref' || key === '__self' || key === '__source') continue;
    if (typeof val === 'function') continue;

    summary[key] = truncateValue(val, 0);
    count++;
  }

  return count > 0 ? summary : null;
}

/** 递归截断值，防止 payload 过大 */
function truncateValue(val: unknown, depth: number): unknown {
  if (depth > 2) return '…';
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val.length > MAX_PROP_STRING_LEN ? val.slice(0, MAX_PROP_STRING_LEN) + '…' : val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    const sliced = val.slice(0, MAX_PROP_ARRAY_LEN).map(v => truncateValue(v, depth + 1));
    if (val.length > MAX_PROP_ARRAY_LEN) sliced.push(`…(${val.length} items)`);
    return sliced;
  }
  if (typeof val === 'object') {
    // React element
    if (val && (val as any).$$typeof) return '[ReactElement]';
    const out: Record<string, unknown> = {};
    const keys = Object.keys(val as object).slice(0, 10);
    for (const k of keys) out[k] = truncateValue((val as any)[k], depth + 1);
    return out;
  }
  return String(val);
}

/**
 * 从 DOM 节点提取语义信息。
 * 覆盖 tag、text、id、className、ARIA 属性、data-testid 等。
 */
export function getDomSummary(el: Element): DomSummary {
  const text = (el.textContent ?? '').trim();
  return {
    tag: el.tagName.toLowerCase(),
    text: text.slice(0, 200),
    id: el.id ?? '',
    className: (el as HTMLElement).className ?? '',
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    testId: el.getAttribute('data-testid') ?? el.getAttribute('data-test-id'),
    placeholder: (el as HTMLInputElement).placeholder ?? el.getAttribute('placeholder'),
  };
}

/**
 * 一站式入口：从一个 DOM 节点提取完整的 React 检查上下文。
 *
 * @param el        - 用户点击的 DOM 元素
 * @param blacklist - 自定义组件黑名单
 * @returns 包含 DOM 摘要和 React 检查结果的结构化对象
 */
export function extractReactInspectionContext(
  el: Element,
  blacklist: string[] = [],
): InspectionContext {
  const dom = getDomSummary(el);
  const fiber = getReactFiberFromDom(el);

  if (!fiber) {
    return {
      dom,
      react: {
        nearestComponent: null,
        businessStack: [],
        propsSummary: null,
        fiberDepth: 0,
      },
    };
  }

  const rawStack = getReactComponentStackFromFiber(fiber);
  const businessStack = cleanBusinessStack(rawStack, blacklist);
  const nearestComponent = rawStack.length > 0 ? rawStack[0].name : null;

  // 提取最近业务组件的 props
  let propsSummary: Record<string, unknown> | null = null;
  if (businessStack.length > 0) {
    // 找到第一个业务组件对应的 fiber，提取其 memoizedProps
    const targetName = businessStack[0];
    let f = fiber;
    let d = 0;
    while (f && d < MAX_FIBER_DEPTH) {
      d++;
      const n = getDisplayNameFromFiber(f);
      if (n && unwrapHOCName(n) === targetName && f.memoizedProps) {
        propsSummary = summarizeProps(f.memoizedProps);
        break;
      }
      f = f.return;
    }
  }

  // 如果没从 fiber 拿到 props，尝试从 DOM 的 __reactProps$ 拿
  if (!propsSummary) {
    propsSummary = summarizeProps(getReactPropsFromDom(el));
  }

  return {
    dom,
    react: {
      nearestComponent,
      businessStack,
      propsSummary,
      fiberDepth: rawStack.length > 0 ? rawStack[rawStack.length - 1].depth : 0,
    },
  };
}

/**
 * 生成适合喂给 LLM 的精简 JSON payload。
 * 只保留对推理有价值的信号，去掉冗余和内部细节。
 */
export function buildLLMPayload(ctx: InspectionContext): LLMPayload {
  return {
    element: ctx.dom,
    nearestComponent: ctx.react.nearestComponent,
    businessStack: ctx.react.businessStack,
    propsSummary: ctx.react.propsSummary,
  };
}

// ── Usage Example (document click listener) ─────────────────────────────────
//
// document.addEventListener('click', (e) => {
//   const el = e.target as Element;
//   const ctx = extractReactInspectionContext(el, ['_XView', 'FlatList']);
//   const payload = buildLLMPayload(ctx);
//   console.log('[ReactInspector]', JSON.stringify(payload, null, 2));
//
//   // Example output:
//   // {
//   //   "element": {
//   //     "tag": "span",
//   //     "text": "三亚海棠湾熹棠费尔蒙酒店",
//   //     "id": "",
//   //     "className": "hotel-name",
//   //     "role": null,
//   //     "ariaLabel": null,
//   //     "testId": null,
//   //     "placeholder": null
//   //   },
//   //   "nearestComponent": "HotelNameWithTags",
//   //   "businessStack": ["HotelNameWithTags", "HotelInfoModule", "StaticInfoWrapper", "DetailPageComp"],
//   //   "propsSummary": {
//   //     "hotelName": "三亚海棠湾熹棠费尔蒙酒店",
//   //     "tags": ["亲子", "海景"],
//   //     "starLevel": 5
//   //   }
//   // }
// });
//
// ── 后续扩展建议 ─────────────────────────────────────────────────────────────
//
// 1. Fiber State 提取：从 fiber.memoizedState 提取 hooks state（useState, useReducer）
//    可以看到组件的实时数据状态，但需要遍历 hooks 链表
//
// 2. Context 值提取：从 ContextConsumer fiber 的 memoizedProps.value 提取上下文数据
//    可以看到 Theme、i18n、Store 等全局状态
//
// 3. Render 频率追踪：监听 React DevTools hook (window.__REACT_DEVTOOLS_GLOBAL_HOOK__)
//    记录组件 re-render 次数和原因
//
// 4. Source Map 映射：结合 fiber._debugSource（dev 模式）获取组件源文件路径和行号
//    可直接定位到源代码
//
// 5. 版本自适应：React 19+ 可能改变 fiber 结构，建议加 version detection:
//    const reactVersion = (window as any).React?.version;
//    根据大版本号调整字段访问路径
