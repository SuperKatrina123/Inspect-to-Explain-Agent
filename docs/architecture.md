# 架构全景 — Inspect-to-Explain Agent

> 本文档描述当前 demo 版本的系统架构、关键数据流与核心假设。
> 用于理解现有实现，以及评估如何向真实项目迁移。

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web  (localhost:5173)                                      │
│                                                                  │
│  ┌───────────────────┐     ┌─────────────────────────────────┐  │
│  │  <iframe>         │     │  右侧面板                        │  │
│  │                   │     │  ├─ SelectedElementPanel        │  │
│  │  demo-app         │     │  ├─ AnalysisStatusPanel         │  │
│  │  (localhost:5174) │     │  ├─ AnalysisResultPanel         │  │
│  │                   │     │  └─ HistoryPanel                │  │
│  └────────┬──────────┘     └───────────────┬─────────────────┘  │
│           │  postMessage                   │                    │
│           │  ELEMENT_SELECT ─────────────► │                    │
│           │ ◄──── ENABLE_INSPECT           │                    │
│           │ ◄──── DISABLE_INSPECT          │                    │
│      inspectBridge.ts               App.tsx / useInspectMode    │
└─────────────────────────────────────────────────────────────────┘
                                      │
                                      │ POST /api/analyze-element
                                      │ GET|DELETE /api/history
                                      ▼
                       ┌──────────────────────────────┐
                       │  apps/server  (port 3001)    │
                       │                              │
                       │  routes/analyze.ts           │
                       │    │                         │
                       │    ├─► codeSearch.ts         │
                       │    │     └─ 扫描本地 .ts/.tsx │◄── 本地代码文件
                       │    │                         │
                       │    ├─► llmRetrieval.ts       │
                       │    │     └─ promptBuilder.ts │
                       │    │     └─ OpenAI API       │──► LLM
                       │    │                         │
                       │    └─► historyStore.ts       │──► .history.json
                       │                              │
                       │  routes/history.ts           │
                       └──────────────────────────────┘
```

---

## 二、关键数据流

### 流程 1 — Inspect 激活

```
用户点击 "Inspect ON"
  └─► useInspectMode.toggleInspectMode()
        └─► iframeRef.contentWindow.postMessage({ type: 'ENABLE_INSPECT' })
              └─► inspectBridge.ts 监听 message 事件
                    └─► enable()
                          ├─ 注册 document.addEventListener('mouseover')
                          ├─ 注册 document.addEventListener('mouseout')
                          └─ 注册 document.addEventListener('click', true)  ← capture 阶段
```

### 流程 2 — 元素选中 → Context 采集

```
用户在 demo 页面 click 某个元素
  └─► inspectBridge.onClick(e)
        ├─ e.preventDefault() + e.stopPropagation()
        └─► extractContext(el)
              ├─ selectedElement: tag / text / className / id / CSS selector / XPath
              ├─ ancestors: 向上 5 层父节点
              ├─ siblings: 同级节点文本
              ├─ nearbyTexts: 父容器内可见文本（最多 10 条）
              └─ reactComponentStack: getReactComponentStack(el)
                    └─ 读取 el.__reactFiber$xxx
                         └─ 沿 fiber.return 向上遍历
                              └─ 收集 type.displayName || type.name
                                   → ["OrderItemRow", "OrderSummary", "App"]

  └─► window.parent.postMessage({ type: 'ELEMENT_SELECT', data: context })
        └─► useInspectMode onMessage 监听
              └─► setSelectedContext(context)
                    └─► SelectedElementPanel 重新渲染
```

### 流程 3 — 分析请求 → 结构化结果

```
用户点击 "Analyze Element"
  └─► App.tsx handleAnalyze()
        └─► POST /api/analyze-element  body: ElementContext

              └─► routes/analyze.ts
                    │
                    ├─► codeSearch.searchByContext(context)
                    │     ├─ Tier 1 (Fiber): 用组件名搜 function/const/class 定义行  ← 最精确
                    │     ├─ Tier 2 (className): token 化 className 模糊匹配
                    │     └─ Tier 3 (guess): kebab→PascalCase 推测组件名
                    │     → 返回 CodeReference[]  { file, line, snippet, componentName }
                    │
                    ├─► llmRetrieval.analyze(context, codeRefs)
                    │     └─► promptBuilder.buildMessages(context, codeRefs)
                    │           ├─ system prompt: 角色定义 + sourceType 枚举说明
                    │           └─ user message:
                    │                 ├─ ## Selected Element
                    │                 ├─ ## React Component Stack  ← Fiber 栈作为最强信号
                    │                 ├─ ## DOM Context
                    │                 └─ ## Local Code References
                    │     └─► OpenAI API (stream=false, response_format: json_object)
                    │     └─► 解析 JSON → AnalysisResult
                    │           若解析失败 → fallback mockRetrieval
                    │
                    └─► historyStore.addEntry({ context, result, timestamp })
                          └─► 追加到内存 + 写入 .history.json

        ← 返回 { success: true, result: AnalysisResult }
              └─► AnalysisResultPanel 渲染结果
              └─► useHistory 自动刷新历史列表
```

### 流程 4 — 历史记录 & 对比

```
每次分析完成后自动写入 historyStore
  └─► HistoryPanel 轮询 / 刷新拉取 GET /api/history

用户点击历史条目 "↩ Restore"
  └─► App.tsx handleRestore(entry)
        ├─ restoringRef.current = true  ← 阻止 useEffect 重置分析状态
        ├─ setSelectedContext(entry.context)
        └─ setAnalysisResult(entry.result)

用户勾选两条历史 → 点击 "⚖️ 对比"
  └─► CompareModal 渲染
        └─► CompareCol 双列并排
              ├─ 差异字段: .cmp-row--changed  (橙色左边框 + ≠ 图标)
              ├─ 独有组件芯片: .comp-chip--unique (★)
              ├─ 对方有己方没有: .comp-chip--absent (删除线)
              ├─ 置信度差: .conf-delta--up / --down (Δ 徽章)
              └─ 顶部汇总: "N differences" / "✓ All fields match"
```

---

## 三、核心文件索引

| 文件 | 职责 |
|------|------|
| `demo/demo-app/src/inspect/inspectBridge.ts` | DOM 监听、Context 采集、React Fiber 读取、postMessage 通信 |
| `apps/web/src/hooks/useInspectMode.ts` | Inspect 状态管理，接收 iframe postMessage |
| `apps/web/src/hooks/useHistory.ts` | 历史记录拉取 / 删除 |
| `apps/web/src/App.tsx` | 主状态编排：inspect / 分析 / 历史 / 对比 |
| `apps/web/src/components/CompareModal.tsx` | 并排 Diff 对比，差异高亮逻辑 |
| `apps/server/src/routes/analyze.ts` | 分析接口入口，串联 codeSearch + llm + history |
| `apps/server/src/services/codeSearch.ts` | 三层降级代码检索（Fiber > className > guess） |
| `apps/server/src/services/llmRetrieval.ts` | LLM 调用编排，解析失败自动 fallback |
| `apps/server/src/services/promptBuilder.ts` | 系统提示词 + 用户消息构建 |
| `apps/server/src/services/historyStore.ts` | 内存 store + `.history.json` 持久化 |

---

## 四、当前架构的核心假设

| 假设 | 当前实现 | 真实项目中的挑战 |
|------|----------|-----------------|
| 目标页面可以被 iframe 嵌入 | demo-app 无 CSP 限制 | 生产页面通常有 `X-Frame-Options` / CSP，无法直接嵌入 |
| 代码在 server 可访问的本地文件系统 | `CODE_SEARCH_ROOT` 指向本地目录 | 部署到云端后代码不在 server 上 |
| React dev build，组件名未 minify | demo-app 以 dev 模式运行 | 生产包 Fiber 的 `type.name` 全部变成 `t`、`e` 等单字符 |
| 单页面 React 应用 | demo-app 是标准 React SPA | Taro / 小程序 / Vue / SSR 等场景 Fiber 结构不同 |

---

## 五、向真实项目迁移的方向（待探讨）

- **注入方式**：需要反转架构，将 `inspectBridge` 注入到目标项目，而非将目标项目嵌入 inspector
- **代码检索**：server 部署后无法访问用户本地代码，需要在本地运行 server 或另行同步代码
- **Fiber in production**：需要 `data-component` 注入 / sourcemap 解析 / build-time 映射作为补充
- **候选方案**：Bookmarklet（个人即用）/ Vite 插件（团队接入）/ 浏览器扩展（任意页面）
