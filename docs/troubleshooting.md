# Troubleshooting Log

记录开发过程中踩过的坑和解决方案，持续更新。

---

## 2026-04-06

### 1. `javascript:void(code)` 书签无效（无报错、无面板）

**现象**  
书签点击后完全没有反应，浏览器既不报错也不执行任何代码。

**根本原因**  
esbuild 编译出的 IIFE 以 `"use strict";(()=>{...})()` 开头。  
将其包裹在 `javascript:void(...)` 里后，变成了：

```js
javascript:void("use strict";(()=>{...})())
//                           ↑ 分号在括号内 → 语法错误
```

浏览器静默忽略语法错误，bookmarklet 不执行。

**解决方案**  
不用 `void()`，直接使用 `javascript:${encodeURIComponent(code)}`。  
IIFE 本身返回 `undefined`，不会触发页面跳转。

---

### 2. 书签 Server URL 写死，换环境要重新 build

**现象**  
bookmarklet 里的 Server URL 在 build 时通过 esbuild `define` 注入，  
换到不同的 server（本地 / 远端 / 公司内网）必须重新编译。

**解决方案**  
把 `SERVER` 从 build-time 常量改为**面板内可编辑的 input**，  
用 `localStorage` 持久化，key 为 `__ia_server`。  
默认值仍从 `__SERVER_URL__`（build-time）读取，第一次打开后用户可在面板直接修改。

---

### 3. 远端 Server 冷启动超时（公司网络代理）

**现象**  
请求远端部署的 server 时，`curl` 返回 `HTTP 000`（exit code 28），loading 无限等待。

**根本原因**  
部分免费云平台服务会在无流量后进入休眠，冷启动需要 30～60 秒。  
公司 HTTP 代理的连接超时比冷启动时间短，导致连接在服务启动前就被断开。

**解决方案**  
在本地运行 server（`npm run dev --workspace=apps/server`），bookmarklet 面板里 `server:` 填 `http://localhost:3001`。

---

### 4. `record path` filter 含义不清晰

**现象**  
用户把 `https://example.com/restapi/soa2/xxxxx/xxxMethod` 完整 URL  
填入 `record path:` 输入框，导致没有任何请求被录制。

**根本原因**  
`record path:` 做的是 **路径子串匹配**（`pathname.includes(filter)`），  
应填路径片段，不是完整 URL。

**解决方案**  
填 `/restapi/soa2/` 即可覆盖该域下所有 SOA 接口。  
后续考虑在 input placeholder 里加示例说明。

---

### 5. POST 413 Payload Too Large

**现象**  
点击 Analyze 后，`POST /api/analyze-element` 返回 413。

**根本原因**  
bookmarklet 录制了完整的 API 响应体（SOA 接口返回大量数据），  
加上 SSR hydration data，整体 payload 超过 Express 默认的 `1mb` 限制。

**解决方案（双端）**  
- **Server**：`express.json({ limit: '1mb' })` → `'5mb'`  
- **Bookmarklet**：新增 `trimBody()` 递归裁剪函数，录制时立即压缩：  
  - 数组最多保留 30 条  
  - 字符串超过 300 字符截断  
  - 嵌套最深 4 层  
  - 对象 key 最多 40 个  

---

## 待观察

- [ ] `trimBody` 裁剪后 LLM 是否还能正确做语义匹配（数组截断可能丢失目标字段）  
- [ ] 公司网络下 localhost CORS 是否有拦截（bookmarklet 跨页面请求本地 server）  
- [ ] SOA pattern 正则是否覆盖非标准路径格式（如 `/api/soa/` 或带版本号的变体）

---

## 2026-04-07

### 6. Inspect 高亮 class 泄漏到采集的 className 中

**现象**
用户 click 选中元素后，采集到的 `className` 里多出 `__ia-hl`（bookmarklet）或 `inspect-highlight`（inspectBridge），导致下游代码检索和 LLM 推理使用了错误的 class 信息。

**根本原因**
hover 时通过 `classList.add()` 给元素添加高亮 class，但 click handler 在调用 `extractContext()` 之前没有先移除该 class。

**解决方案**
在 `onClickEl` / `onClick` 中，调用 `extractContext` 之前先 `classList.remove` 移除高亮 class 并清理 `lastHighlighted` 引用。

---

### 7. Fiber 组件栈包含大量框架噪声组件

**现象**
Bookmarklet 面板的 components 列表出现 `MyApp`、`PathnameContextProviderAdapter`、`ErrorBoundary`、`ReactDevOverlay`、`Container`、`AppContainer`、`Root` 等与业务无关的组件名。

**根本原因**
`getReactComponentStack` 沿 Fiber 树遍历时，除了业务组件，还会收集到 React 内部组件、Next.js 框架组件、HOC 包装组件等噪声。原有过滤只跳过了短名称和 `Anonymous`。

**解决方案（双层过滤）**
- **客户端**（bookmarklet + inspectBridge）：
  - HOC 解包：`Memo(X)` → `X`
  - Minified 过滤：全小写且 < 4 字符的名字丢弃
  - 模式匹配：以 `React` 开头 / 以 `Provider|Consumer|Adapter|Boundary|Overlay|Wrapper|Context` 结尾 / 精确匹配 `Root|App|MyApp|Container|AppContainer` → 过滤
- **Server 端**（`filterFiberStack`）：扫描 `CODE_SEARCH_ROOT` 下的源文件，只保留能找到定义（`function X` / `const X` / `class X`）的组件名，自动排除所有第三方和框架组件

---

## 2026-04-08

### 8. Fiber 组件栈漏掉 React.memo / forwardRef 包裹的组件

**现象**
面板 components 列表中看不到 `HotelInfoModule`、`HotelNameWithTags` 等业务组件。

**根本原因**
`React.memo()` 和 `React.forwardRef()` 返回 object 类型（`{ $$typeof, type/render }`），旧代码 `typeof fiber.type === 'function'` 判断会跳过。

**解决方案**
重写为 `reactInspector.ts` 模块，使用 `fiber.tag` 数字常量分类，对 object 类型做三层穿透。

---

### 9. isFrameworkNoise 后缀匹配误杀业务组件

**现象**
`StaticInfoWrapper` 被过滤掉（名字以 `Wrapper` 结尾）。

**根本原因**
旧正则 `/(?:Wrapper|Provider|...)$/` 纯后缀匹配，`StaticInfoWrapper` 这种多段式业务命名被误判。

**解决方案**
改用精确模式匹配列表（`FRAMEWORK_NOISE_PATTERNS`），不做后缀通配。支持用户自定义 blacklist。

---

### 10. SSR 页面 networkContext.requests 全部 body 为 null

**现象**
所有 API 请求的 `body` 都是 `null`，LLM 无法做 text match。

**根本原因**
SSR 页面初始 API 请求在服务端完成，浏览器端不发 fetch/XHR。bookmarklet 的 fetch patch 只能录到注入后的新请求。

**解决方案**
- `pushRecord` 去掉 `inspectActive` 守卫，注入即录制
- 新增 `scanPerformanceRequests()` + SSR `fetchPerf` 提取
- 三源合并去重
- 新增 `networkRanker.ts` 在无 body 时靠 SOA 方法名语义打分

**已知限制**
bookmarklet 刷新页面后消失。根本解决需 Tampermonkey 脚本或 Chrome Extension。

---

### 11. .env 文件中值加分号导致模型不存在

**现象**
`LLM_MODEL='claude-opus-4-6';` 报模型不存在。

**根本原因**
`.env` 不是 JavaScript，分号会作为值的一部分，实际为 `claude-opus-4-6;`。

**解决方案**
不加引号不加分号：`LLM_MODEL=claude-opus-4-6`
