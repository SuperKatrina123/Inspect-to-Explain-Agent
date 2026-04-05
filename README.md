# Inspect-to-Explain Agent

一个面向**前端研发排查场景**的轻量 Agent。

用户在页面中点选一个元素后，系统自动采集该元素的上下文信息，结合本地代码检索与 AI 推理，分析这个元素属于哪个模块、最可能由哪个组件渲染、是静态文案还是数据驱动，并输出结构化解释结果。

![workflow](https://placehold.co/900x400?text=Inspect+→+Context+→+Analyze+→+Result)

---

## ✨ 功能特性

- 🖱️ **Inspect Mode** — 开关式 inspect 模式，hover 高亮元素，click 选中并采集上下文
- 📌 **Element Context 采集** — 自动提取 tag、text、className、id、CSS selector、XPath、祖先链、兄弟节点、周边文本
- ⚙️ **结构化分析** — 后端根据 context 推断模块归属、候选组件、字段来源类型、置信度
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
├── App.tsx                    主布局：左 iframe + 右三面板
├── App.css
├── types/index.ts             共享类型定义
├── hooks/useInspectMode.ts    inspect 状态管理 + postMessage 通信
└── components/
    ├── SelectedElementPanel.tsx    展示选中元素的 context
    ├── AnalysisStatusPanel.tsx     展示分析状态 + Analyze 按钮
    └── AnalysisResultPanel.tsx     展示结构化分析结果

apps/server/src/
├── index.ts                   Express 入口
├── types/index.ts
├── routes/analyze.ts          POST /api/analyze-element
└── services/mockRetrieval.ts  mock 推断逻辑（模块 / 来源类型 / 置信度）

demo/demo-app/src/
├── App.tsx
├── inspect/inspectBridge.ts   跨 iframe 消息桥（hover 高亮 + click 采集）
├── data/mockData.ts           API-response 类型 mock 数据
├── config/benefits.ts         config-driven 权益配置
└── components/
    ├── UserProfileCard.tsx    用户信息卡（静态文案 / API 数据 / 条件渲染）
    ├── OrderSummary.tsx       订单摘要（派生计算 / 条件渲染）
    └── MarketingBenefits.tsx  权益列表（config-driven 渲染）
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
4. 右侧 **Selected Element Panel** 展示采集到的 context
5. 点击 **🔍 Analyze Element** 按钮
6. 右侧 **Analysis Result Panel** 展示结构化分析结果

---

## 📡 API

### `POST /api/analyze-element`

接收元素 context，返回结构化分析结果。

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
  }
}
```

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

- [ ] **真实 LLM 接入** — 替换 `mockRetrieval`，调用 OpenAI / 本地模型生成解释
- [ ] **本地代码检索** — 接入 AST / ripgrep，将 className 映射到真实源文件路径
- [ ] **历史记录** — 保存每次 inspect 的 context + result，支持回溯对比
- [ ] **组件自动映射** — 构建时生成 className → ComponentFile 映射，供 server 查询
- [ ] **VSCode 联动** — 点击 candidateComponent 直接跳转源文件对应行
- [ ] **导出报告** — 将分析结果导出为 JSON / Markdown，方便粘贴到 code review

---

## 📄 License

MIT
