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
- 🕑 **历史记录** — 每次 inspect 自动保存，可展开详情、一键回溯、选两条对比
- ⚖️ **并排对比 + Diff 高亮** — 对比两次 inspect，差异字段橙色边框高亮，置信度 Δ 徽章
- 📊 **可视化结果面板** — 三栏面板展示选中信息、分析状态与分析结果
- 🧩 **Demo 页面** — 内置包含多种字段来源类型（静态文案 / API数据 / 配置驱动 / 派生字段）的演示页

---

## 🏗️ 项目结构

```
Inspect-to-Explain-Agent/
├── apps/
│   ├── web/               React + Vite + TypeScript  (port 5173)  主界面
│   └── server/            Node.js + Express + TypeScript (port 3001)  分析接口
├── demo/
│   └── demo-app/          React + Vite  (port 5174)  被 inspect 的演示页面
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
    ├── llmRetrieval.ts            LLM 调用编排（代码检索 → 构建 prompt → 调用 → 解析）
    ├── codeSearch.ts              三层代码检索（Fiber > className > 猜测）
    ├── promptBuilder.ts           系统提示词 + 用户消息构建
    └── historyStore.ts            内存 store + .history.json 持久化

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

## 📡 API

### `POST /api/analyze-element`

接收元素 context，返回结构化分析结果，并自动追加到历史记录。

**Request Body**

```ts
{
  url: string;
  selectedElement: {
    tag: string;
    text: string;
    className: string;
    id: string;
    selector: string;   // CSS selector
    xpath: string;
  };
  ancestors: Array<{ tag: string; className: string; id: string }>;
  siblings:  Array<{ tag: string; text: string; className: string }>;
  nearbyTexts: string[];
  reactComponentStack: string[];  // React Fiber 组件名，nearest → root
}
```

**Response**

```ts
{
  success: true;
  result: {
    elementText: string;
    moduleName: string;             // e.g. "UserProfileCard"
    candidateComponents: string[];  // e.g. ["UserProfileCard", "ProfileInfo"]
    sourceType:                     // 字段来源类型
      | 'frontend_static'           // 前端硬编码静态文案
      | 'api_response'              // 接口数据驱动
      | 'config_driven'             // 配置数组驱动
      | 'derived_field'             // 计算/派生值
      | 'unknown_candidate';
    confidence: number;             // 0–1
    evidence: string[];             // 推断依据
    explanation: string;            // 自然语言解释
    codeReferences?: Array<{        // 本地代码检索结果
      file: string;
      line: number;
      snippet: string;
      componentName: string;
    }>;
    analysisMode: 'llm' | 'mock';
    modelUsed?: string;             // e.g. "gpt-5.4"
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

- [x] **真实 LLM 接入** — 接入 OpenAI 兼容 API（gpt-5.4 via proxy），LLM 生成结构化解释
- [x] **本地代码检索** — 三层降级策略（React Fiber 组件名 > className token > PascalCase 猜测），定位源文件
- [x] **历史记录** — 每次 inspect 自动持久化（`.history.json`），支持展开详情、回溯、并排对比
- [x] **Diff 高亮对比** — 并排对比差异字段橙色高亮、组件芯片 unique/absent 区分、置信度 Δ 徽章
- [x] **React Fiber 组件检测** — 点击时直接读取 `__reactFiber$` 获取真实组件栈，彻底替代 className 猜测
- [ ] **VSCode 联动** — 点击 Code Reference 中的文件路径，通过 `vscode://` 协议跳转到源文件对应行
- [ ] **导出报告** — 将单次或多次分析结果导出为 JSON / Markdown，方便粘贴到 code review / issue
- [ ] **构建时组件映射（Build-time Map）** — 在构建阶段用 AST 解析生成 `componentName → file:line` 索引，作为 Fiber 不可用时（生产包 minify）的精确备用方案
- [ ] **生产环境支持** — 通过 `data-component` 属性注入或 sourcemap 解析，使工具在 minified 生产包中也可工作
- [ ] **多页面 / 多框架** — 扩展 inspectBridge 支持 Vue Devtools hook、Angular Ivy 等非 React 框架的组件树读取

---

## 📋 变更记录

### v0.5 — React Fiber 组件检测（2026-04-05）

**变更内容：**
- `inspectBridge.ts` 新增 `getReactComponentStack(el)`：点击时遍历 `__reactFiber$` 属性，沿 `.return` 链收集真实 React 组件名（nearest → root）
- `ElementContext` 新增 `reactComponentStack: string[]` 字段
- `codeSearch.ts` 重构为三层降级搜索：Fiber 组件名（精确定义行）> className token（模糊匹配）> 猜测 PascalCase
- `promptBuilder.ts` 新增 `## React Component Stack` section，LLM 将其作为最强信号
- 服务端日志新增 `tier=fiber/className/guess` 标记，方便调试

**解决的问题：** className 在 Taro / CSS Modules / Tailwind / styled-components 项目中不可靠，Fiber 直读彻底绕过该限制。

---

### v0.4 — 历史记录 + 并排对比（2026-04-05）

**变更内容：**
- `historyStore.ts`：内存 store + `.history.json` 文件持久化，服务重启自动加载，最多保留 100 条
- 新增 History API：`GET /api/history`、`GET /api/history/:id`、`DELETE /api/history[/:id]`
- `HistoryPanel.tsx`：可滚动历史列表，点击卡片展开完整详情（explanation / evidence / code ref）
- `CompareModal.tsx`：并排 Diff 对比，差异字段橙色左边框 + `≠` 图标，unique/absent 组件芯片，置信度 Δ 徽章，顶部"N differences"汇总
- `useHistory.ts` hook、`useInspectMode` 暴露 `setSelectedContext` 用于历史回溯
- `restoringRef` 防止 restore 时触发重置分析 effect

---

### v0.3 — 本地代码检索（2026-04-05）

**变更内容：**
- 新增 `codeSearch.ts`：递归扫描 `.tsx/.ts` 文件，className token 提取，行级相关度打分，每文件保留最高分一行，返回 top-6
- `promptBuilder.ts` 新增 `## Local Code References` section，LLM 可直接引用真实文件路径
- `AnalysisResultPanel.tsx` 新增 Code References 卡片（file:line + snippet 深色代码块）
- `AnalysisResult` 类型新增 `codeReferences` 字段

---

### v0.2 — 真实 LLM 接入（2026-04-05）

**变更内容：**
- 新增 `llmRetrieval.ts`：调用 OpenAI 兼容 API，strict JSON schema 输出，解析失败自动 fallback 到 mock
- 新增 `promptBuilder.ts`：系统提示词（含 sourceType 枚举定义）+ 用户消息格式化
- `USE_LLM` / `LLM_BASE_URL` / `LLM_MODEL` 环境变量控制，`.env.example` 模板
- `AnalysisResult` 新增 `analysisMode: 'llm' | 'mock'` 和 `modelUsed` 字段
- 面板标题新增 LLM / mock 模式徽章

---

### v0.1 — MVP 初始版本（2026-04-05）

**变更内容：**
- Monorepo 脚手架（npm workspaces）：`apps/web` + `apps/server` + `demo/demo-app`
- `inspectBridge.ts`：跨 iframe postMessage 机制，hover 高亮 + click 采集 + context 提取（tag / text / className / selector / XPath / ancestors / siblings / nearbyTexts）
- Mock 分析服务：基于 className 正则模式匹配推断模块名 / sourceType / 置信度
- 三栏面板 UI：SelectedElementPanel / AnalysisStatusPanel / AnalysisResultPanel
- Demo 页：UserProfileCard / OrderSummary / MarketingBenefits，含四种字段来源类型

---

## 📄 License

MIT

