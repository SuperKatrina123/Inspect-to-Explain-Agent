# 从 Demo 到真实项目 — 需要解决的问题

> 记录将 Inspect-to-Explain Agent 应用到真实前端排查场景时，
> 当前 demo 架构与实际需求之间的差距。
>
> 用户场景：拥有前端代码（含 BFF），需要迅速定位页面展示坑位的字段来源。

---

## 一、根本性阻碍（当前做不到）

### 问题 1：无法将 inspectBridge 注入真实页面

**Demo 的做法：**
- inspectBridge.ts 作为源码直接写进 demo-app
- web app 通过 iframe 嵌入 demo-app，用 postMessage 通信

**真实场景的问题：**
- 生产 / 预发页面有 `X-Frame-Options` 或 CSP，iframe 嵌入被直接拦截
- 不可能为每个要排查的页面都修改源码

**需要的能力：**
- 能在任意已跑起来的页面上激活 inspect 模式
- 不依赖修改目标页面源码

**候选方案：**
| 方案 | 适用场景 | 改动量 |
|------|----------|--------|
| Bookmarklet | 个人临时使用，任意页面即点即用 | 极小 |
| Vite / Webpack 插件 | 团队统一接入，dev build 自动注入 | 中 |
| 浏览器扩展 | 需要检查 staging / 生产页面 | 大 |

---

### 问题 2：React Fiber 在生产包中失效

**Demo 的做法：**
- demo-app 以 dev build 运行，`fiber.type.name` 完整保留

**真实场景的问题：**
```
dev build:   fiber.type.name = "OrderSummary"   ✅
prod build:  fiber.type.name = "t"              ❌
```
预发 / 生产环境大概率使用生产包，Fiber 组件名全部 minify 为单字符，无法使用。

**需要的能力：**
- 在 minified 环境下仍能识别组件归属

**候选方案：**
| 方案 | 原理 | 局限 |
|------|------|------|
| `data-component` 属性注入 | 构建时 babel/swc 插件在每个组件根节点注入 `data-component="OrderSummary"` | 需要改构建配置 |
| Sourcemap 解析 | 通过 sourcemap 还原 minified 函数名 | 需要 server 能访问 sourcemap |
| 构建时组件映射 | 构建阶段 AST 生成 `componentName → file:line` 索引 | 需要构建集成 |

---

## 二、核心能力缺失（得不到正确答案）

### 问题 3：静态代码检索不足以定位字段来源

**Demo 的做法：**
- 扫描本地 .ts/.tsx 文件，找组件定义行
- 辅助 LLM 推断字段来源

**真实场景的问题：**
- 字段经过 BFF 聚合 / 转换，光看组件文件看不出真正来源
- 下游服务代码完全拿不到
- 代码检索只能给出"这个组件在哪个文件"，无法回答"这个值从哪个接口来"

**需要的能力：**
- 运行时追踪字段值的真实数据来源

**候选方案（推荐）：网络请求拦截 + 值反查**
```
拦截页面所有 fetch / XHR
  → 录制 { endpoint, responseBody, timestamp }

用户 click 元素时
  → 在所有已录制响应里递归搜索 element.text
  → 找到匹配字段路径

context 新增 networkMatches：[
  { endpoint: "GET /api/v1/order/detail", fieldPath: "data.items[0].price", value: "49.99" }
]
```
**优势：**
- 不依赖任何源码
- 对 BFF 场景天然有效（BFF 暴露的接口响应就是数据来源的直接证据）
- 静态文案在所有响应里找不到匹配 → 直接判定 `frontend_static`

---

### 问题 4：缺少运行时状态数据

**Demo 的做法：**
- 数据是 mock 的，来源确定

**真实场景中字段来源的复杂性：**
- 接口响应（可能经过多层 BFF 转换）
- Redux / Zustand / Pinia 等状态管理中间值
- SSR 注水数据（`window.__INITIAL_STATE__`）
- 配置中心（运行时下发，不在代码里）
- 条件渲染 + A/B 实验开关
- 国际化 i18n key（文案在翻译文件里，不在组件里）

光靠 DOM 上下文，LLM 只能猜测，置信度低。需要结合网络请求数据提供直接证据。

---

## 三、工程适配问题（需要额外处理）

### 问题 5：框架多样性

**Demo 的假设：**
- 纯 React SPA，标准 Fiber 树

**真实场景：**
| 框架 | 问题 |
|------|------|
| Taro | className 自动生成（极长、不可读），小程序容器环境 Fiber 行为不同 |
| Next.js SSR | Fiber 树有 ServerComponent / Suspense / HydrationBoundary 噪声 |
| Vue | 没有 React Fiber，需要用 Vue Devtools hook（`__vue_app__`） |
| Class Components | `fiber.type.name` 正常，但组件设计模式与 hooks 不同 |

### 问题 6：Fiber 组件栈噪声

**Demo 的 Fiber 栈（干净）：**
```
["OrderItemRow", "OrderSummary", "App"]
```

**真实项目的 Fiber 栈（噪声多）：**
```
["span", "Memo(OrderItemRow)", "WithRouter(OrderSummary)",
 "Provider", "QueryClientProvider", "App", "BrowserRouter", ...]
```
需要过滤 HOC 包装名、Provider、框架内部组件，只保留业务组件名。

当前 `getReactComponentStack` 已做基础过滤（跳过短名称、Anonymous），
但对 `Memo(X)`、`WithRouter(X)` 等包装名需要额外解析。

---

## 四、问题优先级与依赖关系

```
必须先解决（阻塞使用）
  └─► 问题 1：注入机制  →  Bookmarklet 是最低成本的起点

高价值（解决后分析质量大幅提升）
  └─► 问题 3：网络拦截 + 值反查  →  对 BFF 场景是核心能力

按需解决（取决于目标项目特征）
  ├─► 问题 2：生产包 Fiber 失效  →  只在需要分析生产/预发时才紧迫
  ├─► 问题 4：运行时状态          →  问题 3 部分覆盖此场景
  ├─► 问题 5：框架适配            →  按实际使用框架逐步支持
  └─► 问题 6：Fiber 栈噪声        →  当前已基本可用，可逐步优化
```

---

## 五、推荐的最小可用路径

```
Step 1：Bookmarklet
  → 将 inspectBridge 编译为自执行 JS
  → 书签点击激活任意 dev server 页面的 inspect 模式
  → 悬浮面板展示分析结果（不依赖 web app）
  → 解决：问题 1

Step 2：网络拦截
  → inspectBridge 增加 fetch / XHR monkey-patch
  → click 时附带 networkMatches 发给 server
  → 解决：问题 3、部分解决问题 4

Step 3：Vite 插件（团队接入）
  → 封装 Step 1 + Step 2 为 vite plugin
  → dev 模式自动注入，生产构建不影响
  → 解决：问题 1 的团队规模化
```
