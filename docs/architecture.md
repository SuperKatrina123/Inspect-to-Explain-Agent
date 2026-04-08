# 架构全景 — Inspect-to-Explain Agent

> 本文档描述当前版本的系统架构、关键数据流与核心假设。

---

## 一、整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│  模式 A：Demo Web App  (localhost:5173)                               │
│                                                                      │
│  ┌───────────────────┐     ┌──────────────────────────────────────┐  │
│  │  <iframe>         │     │  右侧面板                             │  │
│  │  demo-app :5174   │     │  ├─ SelectedElementPanel             │  │
│  │  inspectBridge.ts │     │  ├─ AnalysisStatusPanel              │  │
│  └────────┬──────────┘     │  ├─ AnalysisResultPanel              │  │
│           │  postMessage   │  └─ HistoryPanel / CompareModal      │  │
│           └───────────────►│  App.tsx / useInspectMode            │  │
└────────────────────────────┴────────────────┬─────────────────────┘  │
                                              │
┌─────────────────────────────────────────────┼──────────────────────┐
│  模式 B：Bookmarklet（任意页面注入）           │                      │
│                                             │                      │
│  javascript:... 书签点击                    │                      │
│    └─► 注入自包含 IIFE 到目标页面            │                      │
│          ├─ 悬浮面板（可拖拽）               │                      │
│          ├─ hover 高亮 / click 采集          │                      │
│          ├─ reactInspector.ts               │                      │
│          │    ├─ Fiber 反查（fiber.tag 分类）│                      │
│          │    ├─ memo/forwardRef 穿透        │                      │
│          │    ├─ _debugSource 源码定位        │                      │
│          │    ├─ businessStack 降噪           │                      │
│          │    └─ props 摘要提取              │                      │
│          ├─ fetch/XHR monkey-patch（注入即录）│                      │
│          ├─ Performance API 历史请求扫描     │                      │
│          └─ SSR 数据扫描 (__NEXT_DATA__ / __next_f 等)              │
└─────────────────────────────────────────────┼──────────────────────┘
                                              │
                         POST /api/analyze-element
                         GET|DELETE /api/history
                                              ▼
                       ┌──────────────────────────────────────┐
                       │  apps/server  (port 3001)            │
                       │                                      │
                       │  routes/analyze.ts                   │
                       │    │                                 │
                       │    ├─► codeSearch.searchByContext()  │◄── 本地代码
                       │    │     └─ Fiber > className > guess│    (codeSearchRoot)
                       │    │                                 │
                       │    ├─► codeSearch.searchSoaEndpoints()
                       │    │     └─ grep /soa2/\d+/\w+      │
                       │    │                                 │
                       │    ├─► networkRanker.rankCandidates()│
                       │    │     └─ summarize + score + rank │
                       │    │                                 │
                       │    ├─► dataMasker.maskSensitiveData()│
                       │    │     └─ 脱敏 networkContext.body │
                       │    │                                 │
                       │    ├─► llmRetrieval.analyze()        │
                       │    │     └─ promptBuilder            │
                       │    │          ├─ DOM context         │
                       │    │          ├─ Fiber stack         │
                       │    │          ├─ Code references     │
                       │    │          ├─ SOA endpoints       │
                       │    │          └─ Network context     │──► LLM
                       │    │                                 │
                       │    └─► historyStore.addEntry()       │──► .history.json
                       │                                      │
                       │  routes/history.ts                   │
                       └──────────────────────────────────────┘
```

---

## 二、关键数据流

### 流程 1 — 模式 A：Demo iframe inspect 激活

```
用户点击 "Inspect ON"
  └─► useInspectMode.toggleInspectMode()
        └─► iframeRef.contentWindow.postMessage({ type: 'ENABLE_INSPECT' })
              └─► inspectBridge.ts 监听 message 事件
                    └─► enable()
                          ├─ 注册 document.addEventListener('mouseover')
                          ├─ 注册 document.addEventListener('mouseout')
                          └─ 注册 document.addEventListener('click', true)
```

### 流程 2 — 模式 B：Bookmarklet 注入

```
用户点击书签
  └─► javascript: IIFE 执行（或调用 window.__inspectAgent.toggle()）
        ├─ 注入 <style id="__ia-style">
        ├─ 创建悬浮面板 DOM（可拖拽，位置存 localStorage）
        ├─ monkey-patch window.fetch + XHR.prototype.open/send
        │    └─ 注入即开始录制（不需等 Enable），匹配 networkFilter 的请求
        └─► 用户点击 Enable
              ├─ 注册 mouseover/mouseout/click 事件
              └─ 进入 Inspect 模式
```

### 流程 3 — 元素选中 → Context 采集

```
用户 click 某个元素
  └─► 移除高亮 class（__ia-hl / inspect-highlight）
      └─► extractContext(el)
            ├─ selectedElement: tag / text / className / id / CSS selector / XPath
            ├─ ancestors: 向上 5 层父节点
            ├─ siblings: 同级节点文本
            ├─ nearbyTexts: 父容器内可见文本
            ├─ reactInspection: extractReactInspectionContext(el)
            │     └─ getReactFiberFromDom(el) → getReactComponentStackFromFiber()
            │          → cleanBusinessStack() → summarizeProps()
            │          → 提取 _debugSource（dev 模式源码位置）
            │          → { nearestComponent, businessStack, propsSummary, debugSource }
            ├─ reactComponentStack: businessStack (向后兼容)
            └─ networkContext:
                  ├─ filter: "/restapi/soa2/"
                  ├─ requests: 三源合并去重
                  │     ├─ networkLog（fetch/XHR 实时录制，有 body）
                  │     ├─ Performance API 历史请求（无 body）
                  │     └─ SSR fetchPerf 中的 SOA 调用（无 body）
                  └─ ssrData: scanSsrData() 扫描结果（含 __next_f）
```

### 流程 4 — 分析请求 → 结构化结果

```
用户点击 "Analyze Element"
  └─► POST /api/analyze-element  body: ElementContext

        routes/analyze.ts
          │
          ├─► codeSearch.filterFiberStack(stack)   ← 入口处立即过滤
          │     只保留 CODE_SEARCH_ROOT 中有定义的组件名
          │
          ├─► codeSearch.searchByContext(ctx)        ← 有 CODE_SEARCH_ROOT 时
          │     三层降级：Fiber组件名 > className > PascalCase猜测
          │     → CodeReference[]
          │
          ├─► codeSearch.searchSoaEndpoints(codeRefs) ← 候选文件里 grep SOA pattern
          │     → SoaReference[]  { endpoint, serviceId, methodName }
          │
          ├─► dataMasker.maskSensitiveData(networkContext.requests)
          │     → 脱敏手机/邮箱/身份证/JWT等
          │
          ├─► llmRetrieval.analyze(ctx, codeRefs, soaRefs)
          │     └─► promptBuilder.buildUserMessage()
          │           ├─ ## Selected Element
          │           ├─ ## React Component Hints (secondary evidence)
          │           ├─ ## DOM Ancestors / Siblings / Nearby Texts
          │           ├─ ## Network Candidates (pre-ranked by networkRanker)
          │           ├─ ## SOA Service Calls (静态检测到的接口)
          │           └─ ## Local Code References
          │     └─► OpenAI 兼容 API → JSON 解析 → AnalysisResult
          │           若失败 → mockRetrieval fallback
          │
          └─► historyStore.addEntry({ context, result, timestamp })

  ← { success: true, result: AnalysisResult, soaReferences: [...] }
```

### 流程 5 — 历史记录 & 对比

```
每次分析自动写入 historyStore (.history.json)
  └─► HistoryPanel 拉取 GET /api/history

用户点击 "↩ Restore"
  └─► restoringRef = true → setSelectedContext + setAnalysisResult

用户勾选两条 → "⚖️ 对比"
  └─► CompareModal: 差异字段橙色高亮 + ≠ 图标 + Δ 置信度徽章
```

---

## 三、核心文件索引

| 文件 | 职责 |
|------|------|
| `apps/bookmarklet/src/index.ts` | 自包含 IIFE：悬浮面板、Inspect 模式、网络录制、SSR扫描、Settings面板 |
| `apps/bookmarklet/src/reactInspector.ts` | React Fiber 反查模块：组件栈提取、props 摘要、_debugSource 源码定位 |
| `demo/demo-app/src/inspect/inspectBridge.ts` | iframe 模式：DOM 监听、Context 采集、postMessage 通信 |
| `apps/web/src/hooks/useInspectMode.ts` | Inspect 状态管理，接收 iframe postMessage |
| `apps/web/src/hooks/useHistory.ts` | 历史记录拉取 / 删除 |
| `apps/web/src/App.tsx` | 主状态编排：inspect / 分析 / 历史 / 对比 |
| `apps/web/src/components/CompareModal.tsx` | 并排 Diff 对比，差异高亮逻辑 |
| `apps/server/src/routes/analyze.ts` | 分析接口入口 |
| `apps/server/src/services/codeSearch.ts` | 三层降级代码检索 + SOA endpoint grep + Fiber 栈过滤 + H5多端优先 |
| `apps/server/src/services/llmRetrieval.ts` | LLM 调用编排，解析失败自动 fallback |
| `apps/server/src/services/promptBuilder.ts` | 系统提示词 + 用户消息构建（含 ranked network / SOA 区块） |
| `apps/server/src/services/networkRanker.ts` | 网络请求摘要 + 相关性打分 + 候选排序（SOA 方法名语义分析） |
| `apps/server/src/services/dataMasker.ts` | 递归 PII 脱敏（手机/邮箱/身份证/银行卡/JWT） |
| `apps/server/src/services/historyStore.ts` | 内存 store + `.history.json` 持久化 |

---

## 四、推断信号优先级

LLM 分析时，信号强度从高到低：

```
1. SOA 代码引用    — 静态分析找到组件调用了哪个接口（本地模式）
2. 网络候选排名    — networkRanker 预排序后的 top candidates
   a. 有 body 的请求做 text match（最强）
   b. SOA 方法名语义匹配（次强）
   c. 路径关键词 + 降噪（兜底）
3. SSR 注水数据    — __NEXT_DATA__ / __next_f 等（SSR 页面）
4. React 组件线索  — reactInspector 提取的 businessStack / debugSource（secondary evidence）
5. DOM 上下文      — className / 祖先链 / 周边文本（兜底）
6. Mock 规则       — 无 LLM / 无任何信号时
```

---

## 五、当前架构的核心假设

| 假设 | 当前实现 | 真实项目中的挑战 |
|------|----------|-----------------|
| 模式 A：demo 页面无 CSP | demo-app 无限制 | 生产页面有 X-Frame-Options，iframe 被拦截 |
| 代码在 server 可访问的本地文件系统 | `CODE_SEARCH_ROOT` 指向本地 | 云端部署后代码不在 server 上 |
| React dev build，组件名未混淆 | dev 模式运行 | 生产包 Fiber `type.name` 变成 `t/e` 等单字符 |
| Bookmarklet：页面允许 `javascript:` 执行 | 大部分页面可用 | 部分 CSP 严格页面会阻止 |
