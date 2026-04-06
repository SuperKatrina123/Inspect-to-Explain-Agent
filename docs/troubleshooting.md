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
