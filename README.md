# Inspect-to-Explain Agent

一个面向**前端研发排查场景**的轻量 Agent。

用户在页面中点选一个元素后，系统自动采集该元素的上下文信息，结合本地代码检索与 AI 推理，分析这个元素属于哪个模块、最可能由哪个组件渲染、是静态文案还是数据驱动，并输出结构化解释结果。

![workflow](https://placehold.co/900x400?text=Inspect+→+Context+→+Analyze+→+Result)

---

## ✨ 功能特性

- 🖱️ **Inspect Mode** — 开关式 inspect 模式，hover 高亮元素，click 选中并采集上下文
- 📌 **Element Context 采集** — 自动提取 tag、text、className、id、CSS selector、XPath、祖先链、兄弟节点、周边文本、**React Fiber 组件栈**
- ⚙️ **结构化分析** — 后端根据 context 推断模块归属、候选组件、字段来源类型、置信度
- 🤖 **真实 LLM 分析** — 接入 OpenAI 兼容 API，LLM 结合代码检索上下文生成解释
- 📂 **本地代码检索** — 以 React Fiber 组件名为主、className token 为辅，三层降级策略定位源文件
- 🔌 **SOA 接口静态检测** — 本地模式下自动 grep 候选组件文件中的 SOA endpoint 调用，作为 `api_response` 的强信号
- 🕑 **历史记录** — 每次 inspect 自动保存，可展开详情、一键回溯、选两条对比
- ⚖️ **并排对比 + Diff 高亮** — 对比两次 inspect，差异字段橙色边框高亮，置信度 Δ 徽章
- 📊 **可视化结果面板** — 三栏面板展示选中信息、分析状态与分析结果
- 🧩 **Demo 页面** — 内置包含多种字段来源类型（静态文案 / API数据 / 配置驱动 / 派生字段）的演示页
- 🔖 **Bookmarklet** — 可注入任意网页的悬浮面板，支持拖拽移动、网络请求录制、SSR 数据扫描、Server URL 面板内配置

---

## 🏗️ 项目结构

```
Inspect-to-Explain-Agent/
├── apps/
│   ├── web/               React + Vite + TypeScript  (port 5173)  主界面
│   ├── server/            Node.js + Express + TypeScript (port 3001)  分析接口
│   └── bookmarklet/       esbuild 构建，可注入任意页面的悬浮面板
├── demo/
│   └── demo-app/          React + Vite  (port 5174)  被 inspect 的演示页面
├── docs/                  架构文档 / 踩坑记录
└── package.json           npm workspaces 根配置
```

<details>
<summary>完整目录展开</summary>

```
apps/web/src/
├── App.tsx                        主布局：左 iframe + 右面板区
├── App.css
├── types/index.ts                 共享类型定义
├── hooks/
│   ├── useInspectMode.ts          inspect 状态管理 + postMessage 通信
│   └── useHistory.ts              历史记录加载 / 删除 / 清空
└── components/
    ├── SelectedElementPanel.tsx   展示选中元素的 context
    ├── AnalysisStatusPanel.tsx    展示分析状态 + Analyze 按钮
    ├── AnalysisResultPanel.tsx    展示结构化分析结果 + 代码引用
    ├── HistoryPanel.tsx           历史记录列表（可展开 / 回溯 / 比对）
    └── CompareModal.tsx           并排 Diff 对比弹窗

apps/server/src/
├── index.ts                       Express 入口
├── types/index.ts
├── routes/
│   ├── analyze.ts                 POST /api/analyze-element
│   └── history.ts                 GET|DELETE /api/history[/:id]
└── services/
    ├── mockRetrieval.ts           mock 推断逻辑（fallback）
    ├── llmRetrieval.ts            LLM 调用编排（代码检索 → SOA 扫描 → 构建 prompt → 调用 → 解析）
    ├── codeSearch.ts              三层代码检索 + SOA endpoint grep
    ├── promptBuilder.ts           系统提示词 + 用户消息构建（含网络上下文/SOA区块）
    ├── dataMasker.ts              递归 PII 脱敏（手机/邮箱/身份证/银行卡/JWT等）
    └── historyStore.ts            内存 store + .history.json 持久化

apps/bookmarklet/src/
└── index.ts                       自包含 IIFE：浮动面板 + Fiber读取 + 网络录制 + SSR扫描

docs/
├── architecture.md                系统架构图 + 数据流
├── real-world-gaps.md             demo与真实项目的差异分析
└── troubleshooting.md             踩坑记录

demo/demo-app/src/
├── App.tsx
├── inspect/inspectBridge.ts       跨 iframe 消息桥（hover 高亮 + click 采集 + Fiber 读取）
├── data/mockData.ts               API-response 类型 mock 数据
├── config/benefits.ts             config-driven 权益配置
└── components/
    ├── UserProfileCard.tsx        用户信息卡（静态文案 / API 数据 / 条件渲染）
    ├── OrderSummary.tsx           订单摘要（派生计算 / 条件渲染）
    └── MarketingBenefits.tsx      权益列表（config-driven 渲染）
```

</details>

---

## 🚀 快速开始

### 前置要求

- Node.js ≥ 18
- npm ≥ 9

### 安装

```bash
git clone <repo-url>
cd Inspect-to-Explain-Agent
npm install
```

### 配置 LLM（可选）

复制 `apps/server/.env.example` 为 `apps/server/.env`，填入你的 API key：

```bash
cp apps/server/.env.example apps/server/.env
```

```env
ANTHROPIC_API_KEY=sk-...          # 任意 OpenAI 兼容 API key
LLM_BASE_URL=https://api.openai.com/v1   # 默认 OpenAI，也可填代理地址
LLM_MODEL=gpt-4o-mini             # 模型名
USE_LLM=true                      # false 时退回 mock 模式
CODE_SEARCH_ROOT=/path/to/Inspect-to-Explain-Agent  # 本地代码检索根目录
```

> 不配置 `.env` 时，server 自动退回 **mock 模式**，仍可完整运行。

### 启动（三服务并发）

```bash
npm run dev
```

| 服务 | 地址 | 说明 |
|------|------|------|
| web  | http://localhost:5173 | 主界面入口 |
| server | http://localhost:3001 | 分析 API |
| demo-app | http://localhost:5174 | 演示页面（嵌入 iframe） |

> 也可单独启动：`npm run dev:web` / `npm run dev:server` / `npm run dev:demo`

### 使用流程

1. 打开 **http://localhost:5173**
2. 点击右上角 **⚪ Inspect OFF** 开启 Inspect Mode
3. 在左侧 demo 页面中 hover 元素（橙色高亮），点击选中
4. 右侧 **Selected Element Panel** 展示采集到的 context（含 React 组件栈）
5. 点击 **🔍 Analyze Element** 按钮
6. 右侧 **Analysis Result Panel** 展示结构化分析结果与代码引用
7. 多次分析后，**History Panel** 自动记录，可展开查看详情、↩ Restore 回溯、勾选两条后 ⚖️ 对比

---

### 🔖 Bookmarklet（注入任意页面）

无需部署前端项目，可将 Inspector 直接注入到**任意网页**（包括生产环境）。

#### 构建

```bash
# 默认指向 Render 部署地址
npm run build:bookmarklet

# 指向本地 server
SERVER_URL=http://localhost:3001 npm run build:bookmarklet
```

#### 安装

1. 复制 `apps/bookmarklet/dist/bookmarklet-url.txt` 的内容
2. 浏览器新建书签，将 URL 粘贴进去（名称随意，如 `🔍 Inspect Agent`）

#### 使用

1. 打开任意网页，点击书签 → 右上角浮现悬浮面板
2. 在面板顶部 **server:** 输入框填入你的分析 server 地址（自动保存到 localStorage）
3. 设置 **record path:** 过滤要录制的接口路径（如 `/restapi/soa2/`）
4. 点击 **Enable** 开启 Inspect Mode，开始录制匹配的网络请求
5. 点击页面元素 → 面板展示 context（含 React 组件栈、已录制请求数、SSR 数据）
6. 点击 **🔍 Analyze Element** 发送给 server 分析
7. 拖拽面板 **标题栏** 可移动位置（自动保存）；再次点击书签可切换 Inspect ON/OFF；关闭按钮（✕）完全移除面板

> **本地模式**：启动 `apps/server` 并设置 `CODE_SEARCH_ROOT`，server 会自动静态扫描 SOA 调用，无需录制网络请求即可推断数据来源。

---

## 📡 API

### `POST /api/analyze-element`

接收元素 context，返回结构化分析结果，并自动追加到历史记录。

**Request Body**

```ts
{
  url: string;
  selectedElement: {
    tag: string; text: string; className: string;
    id: string; selector: string; xpath: string;
  };
  ancestors: Array<{ tag: string; className: string; id: string }>;
  siblings:  Array<{ tag: string; text: string; className: string }>;
  nearbyTexts: string[];
  reactComponentStack: string[];  // React Fiber 组件名，nearest → root
  networkContext?: {               // Bookmarklet 录制的网络上下文（可选）
    filter: string;               // 路径 filter，如 "/restapi/soa2/"
    requests: Array<{ method: string; endpoint: string; body: any; timestamp: number }>;
    ssrData: Array<{ key: string; data: any }>;
  };
}
```

**Response**

```ts
{
  success: true;
  result: {
    elementText: string;
    moduleName: string;             // e.g. "HotelListItem"
    candidateComponents: string[];  // e.g. ["HotelListItem", "HotelCard"]
    sourceType:
      | 'frontend_static'           // 前端硬编码静态文案
      | 'api_response'              // 接口数据驱动
      | 'config_driven'             // 配置数组驱动
      | 'derived_field'             // 计算/派生值
      | 'unknown_candidate';
    confidence: number;             // 0–1
    evidence: string[];
    explanation: string;
    codeReferences?: Array<{        // 本地代码检索结果
      file: string; line: number; snippet: string; componentName: string;
    }>;
    soaReferences?: Array<{         // SOA endpoint 静态检测结果（本地模式）
      file: string; line: number; endpoint: string;
      serviceId: string; methodName: string; snippet: string;
    }>;
    analysisMode: 'llm' | 'mock';
    modelUsed?: string;
  }
}
```

### `GET /api/history`

返回所有历史记录（最新在前，最多 100 条）。

### `DELETE /api/history/:id`

删除单条历史记录。

### `DELETE /api/history`

清空所有历史记录。

---

## 🧪 Demo 页面字段来源设计

| 组件 | 字段 | 来源类型 |
|------|------|----------|
| `UserProfileCard` | "User Profile"（标题） | `frontend_static` |
| `UserProfileCard` | 用户姓名、邮箱 | `api_response` |
| `UserProfileCard` | "4,820 pts"（积分） | `derived_field`（格式化） |
| `UserProfileCard` | "⭐ VIP Member" 徽章 | `api_response` + 条件渲染 |
| `OrderSummary` | 商品名称、单价 | `api_response` |
| `OrderSummary` | Subtotal / Total | `derived_field`（运算） |
| `OrderSummary` | Discount 行 | 条件渲染（discount > 0） |
| `MarketingBenefits` | 权益标题 & 描述 | `config_driven`（BENEFITS_CONFIG） |
| `MarketingBenefits` | "Premium" 徽章 | 条件渲染（isPremium） |

---

## 🗺️ 后续迭代方向

- [x] **真实 LLM 接入** — 接入 OpenAI 兼容 API，LLM 生成结构化解释，支持自定义 base URL / 模型
- [x] **本地代码检索** — 三层降级策略（React Fiber 组件名 > className token > PascalCase 猜测），定位源文件
- [x] **历史记录** — 每次 inspect 自动持久化（`.history.json`），支持展开详情、回溯、并排对比
- [x] **Diff 高亮对比** — 并排对比差异字段橙色高亮、组件芯片 unique/absent 区分、置信度 Δ 徽章
- [x] **React Fiber 组件检测** — 点击时直接读取 `__reactFiber$` 获取真实组件栈，彻底替代 className 猜测
- [x] **Bookmarklet** — 可注入任意页面，拖拽面板，网络请求录制，SSR 数据扫描，Server URL 运行时配置
- [x] **SOA / BFF 接口静态检测** — 本地模式下自动 grep 候选组件的接口调用，作为数据来源的强信号
- [x] **PII 脱敏** — server 侧递归脱敏响应体后再送 LLM
- [ ] **VSCode 联动** — 点击 Code Reference 中的文件路径，通过 `vscode://` 协议跳转到源文件对应行
- [ ] **导出报告** — 将单次或多次分析结果导出为 JSON / Markdown，方便粘贴到 code review / issue
- [ ] **构建时组件映射** — 构建阶段用 AST 解析生成 `componentName → file:line` 索引，作为生产包 minify 后 Fiber 名失效的精确备用方案
- [ ] **生产环境组件名还原** — 通过 `data-component` 属性注入或 sourcemap 解析，在 minified 生产包中还原真实组件名
- [ ] **多框架支持** — 扩展支持 Vue Devtools hook、Angular Ivy 等非 React 框架的组件树读取

---

## 📋 变更记录

### v2 — Bookmarklet + 网络上下文 + SOA 检测（2026-04-06）

**新增功能：**
- 🔖 **Bookmarklet**：esbuild 构建自包含 IIFE，可注入任意页面；浮动面板支持**拖拽移动**，位置持久化到 localStorage
- 🌐 **网络录制**：Inspect Mode ON 时才开始录制，路径 filter 可在面板配置（如 `/restapi/soa2/`）；`trimBody()` 防止大响应 413
- 🗄️ **SSR 扫描**：自动检测 `__NEXT_DATA__`、`__NUXT__` 等及 `<script type="application/json">`
- ⚙️ **Server URL 面板内可编辑**，localStorage 持久化，无需重新 build
- 🔌 **SOA 静态检测**：`searchSoaEndpoints()` 在候选组件文件中 grep `/soa2/\d+/\w+`，注入 LLM prompt 作为 `api_response` 强信号
- 🔒 **PII 脱敏**：`dataMasker.ts` 递归脱敏手机/邮箱/身份证/银行卡/JWT，server 侧处理后再送 LLM
- 📝 **文档**：`docs/architecture.md`、`docs/real-world-gaps.md`、`docs/troubleshooting.md`

**首次端到端验证（真实生产页面）：**
- 元素：`<span>2站达虹桥站，私享庭院500平草坪</span>`
- 结果：`moduleName=HotelListItem`、`sourceType=api_response`、`confidence=89%`
- 推理依据：SSR `__NEXT_DATA__` + SOA `xxxHotelInfoList` <!-- 真实方法名已脱敏 -->

---

### v1 — MVP → 本地代码检索 → LLM → 历史对比（2026-04-05）

**v1.0 — MVP 初始版本**
- Monorepo 脚手架（npm workspaces）：`apps/web` + `apps/server` + `demo/demo-app`
- `inspectBridge.ts`：跨 iframe postMessage，hover 高亮 + click 采集（tag / text / className / selector / XPath / ancestors / siblings / nearbyTexts）
- Mock 分析服务：基于 className 正则模式匹配推断模块名 / sourceType / 置信度
- 三栏面板 UI：SelectedElementPanel / AnalysisStatusPanel / AnalysisResultPanel
- Demo 页：UserProfileCard / OrderSummary / MarketingBenefits，含四种字段来源类型

**v1.1 — 真实 LLM 接入**
- `llmRetrieval.ts`：OpenAI 兼容 API，strict JSON 输出，解析失败 fallback mock
- `promptBuilder.ts`：系统提示词（sourceType 枚举）+ 用户消息格式化
- `USE_LLM` / `LLM_BASE_URL` / `LLM_MODEL` 环境变量，`.env.example` 模板
- 面板新增 LLM / mock 模式徽章

**v1.2 — 本地代码检索**
- `codeSearch.ts`：递归扫描 `.tsx/.ts`，className token 提取，行级相关度打分，top-6 返回
- `promptBuilder.ts` 新增 `## Local Code References` section
- `AnalysisResultPanel.tsx` 新增 Code References 卡片

**v1.3 — 历史记录 + 并排对比**
- `historyStore.ts`：内存 store + `.history.json` 持久化，最多 100 条
- History API：`GET/DELETE /api/history[/:id]`
- `HistoryPanel.tsx`：可滚动历史列表，展开详情 / Restore 回溯
- `CompareModal.tsx`：并排 Diff，差异字段橙色高亮，置信度 Δ 徽章

**v1.4 — React Fiber 组件检测**
- `inspectBridge.ts` 新增 `getReactComponentStack(el)`：读取 `__reactFiber$`，沿 `.return` 链收集真实组件名
- `codeSearch.ts` 重构为三层降级：Fiber 组件名 > className token > PascalCase 猜测
- `promptBuilder.ts` 新增 `## React Component Stack` section
- 解决了 Taro / CSS Modules / Tailwind 等项目 className 不可靠的问题

---

## 📄 License

MIT

