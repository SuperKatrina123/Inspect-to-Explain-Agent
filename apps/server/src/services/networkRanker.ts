/**
 * Network Candidate Ranker & Summarizer
 *
 * 将 bookmarklet 捕获的原始网络请求压缩为少量高相关候选，
 * 再交给 LLM 分析。程序侧负责采集、整理、筛选，不负责最终归因。
 *
 * 输入：NetworkContext + ElementContext（用于相关性打分）
 * 输出：排序后的 NetworkCandidate[]，top-N 进入 LLM 上下文
 */

import { ElementContext, NetworkContext, RecordedRequest, SsrData } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NetworkRequestSummary {
  id: string;
  method: string;
  url: string;
  path: string;
  /** SOA 服务 ID（从路径解析，如 "33278"） */
  serviceId: string | null;
  /** SOA 方法名（从路径解析，如 "getHotelDetailAggregate"） */
  methodName: string | null;
  timestamp: number;
  /** 请求 query string 的 key 列表 */
  requestQueryKeys: string[];
  /** 请求 body 的顶层 key 列表 */
  requestBodyKeys: string[];
  /** 响应的顶层 key 列表 */
  responseTopLevelKeys: string[];
  /** 响应展平后的 key 路径（最多 3 层） */
  responseFlattenedKeys: string[];
  /** 响应中与 element text 匹配的采样文本 */
  responseSampleText: string | null;
  /** 是否有 response body */
  hasBody: boolean;
  /** JSON body 序列化后的大致字节数 */
  size: number;
}

export interface NetworkCandidate {
  summary: NetworkRequestSummary;
  /** 相关性得分，越高越可能是数据来源 */
  score: number;
  /** 得分理由（用于 debug） */
  scoreReasons: string[];
  /** body 中包含 element text 的字段路径 */
  matchedPaths: string[];
}

export interface RankedNetworkResult {
  /** 排序后的 top 候选（默认前 3） */
  candidates: NetworkCandidate[];
  /** 未入选的请求的简要摘要（endpoint 列表，用于 debug） */
  skippedEndpoints: string[];
  /** SSR 数据的精简摘要 */
  ssrSummary: SsrSummaryEntry[];
}

export interface SsrSummaryEntry {
  key: string;
  topLevelKeys: string[];
  /** 是否包含 element text */
  containsElementText: boolean;
  /** 匹配到的字段路径 */
  matchedPaths: string[];
}

// ── Config ───────────────────────────────────────────────────────────────────

const MAX_CANDIDATES_WITH_BODY = 3;
const MAX_CANDIDATES_NO_BODY = 8;   // 无 body 时多展示候选，靠 LLM 语义判断
const MAX_FLATTENED_KEYS = 50;
const MAX_FLATTEN_DEPTH = 3;

/** 解析 SOA 风格路径: /restapi/soa2/{serviceId}/{methodName} */
const SOA_PATH_RE = /\/restapi\/soa2\/(\d+)\/([^/?]+)/;

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * 主入口：对 NetworkContext 做 summarize + rank，返回精简候选。
 */
export function rankNetworkCandidates(
  net: NetworkContext | undefined,
  ctx: ElementContext,
): RankedNetworkResult {
  const empty: RankedNetworkResult = { candidates: [], skippedEndpoints: [], ssrSummary: [] };
  if (!net) return empty;

  const elementText = ctx.selectedElement.text?.trim() ?? '';
  const elementClassName = ctx.selectedElement.className ?? '';

  // 1. Summarize each request
  const summaries = net.requests.map((req, i) => summarizeRequest(req, i));

  // 2. Score each summary against element context
  const scored = summaries.map(summary => scoreCandidate(summary, elementText, elementClassName, net));

  // 3. Sort by score desc
  scored.sort((a, b) => b.score - a.score);

  // 4. 动态决定候选数：有 body 时 top 3 够用；全无 body 时多给 LLM 看
  const hasAnyBody = scored.some(c => c.summary.hasBody);
  const topN = hasAnyBody ? MAX_CANDIDATES_WITH_BODY : MAX_CANDIDATES_NO_BODY;

  // 过滤掉负分（纯噪声）
  const viable = scored.filter(c => c.score >= 0);
  const candidates = viable.slice(0, topN);
  const skippedEndpoints = viable.slice(topN).map(c => c.summary.path);

  // 5. Summarize SSR data
  const ssrSummary = net.ssrData.map(ssr => summarizeSsr(ssr, elementText));

  return { candidates, skippedEndpoints, ssrSummary };
}

// ── Summarize ────────────────────────────────────────────────────────────────

function summarizeRequest(req: RecordedRequest, index: number): NetworkRequestSummary {
  const path = req.endpoint || '';
  const url = req.endpoint || '';
  const cleanPath = path.split('?')[0];

  // 解析 SOA 路径: /restapi/soa2/{serviceId}/{methodName}
  const soaMatch = cleanPath.match(SOA_PATH_RE);
  const serviceId = soaMatch ? soaMatch[1] : null;
  const methodName = soaMatch ? soaMatch[2] : null;

  // Query keys from endpoint (if contains ?)
  const requestQueryKeys: string[] = [];
  const qIdx = path.indexOf('?');
  if (qIdx >= 0) {
    const params = new URLSearchParams(path.slice(qIdx + 1));
    params.forEach((_, key) => requestQueryKeys.push(key));
  }

  // Body keys
  const body = req.body;
  const requestBodyKeys: string[] = [];
  const responseTopLevelKeys: string[] = [];
  const responseFlattenedKeys: string[] = [];
  let size = 0;

  if (body && typeof body === 'object') {
    const keys = Object.keys(body);
    responseTopLevelKeys.push(...keys.slice(0, 30));
    flattenKeys(body, '', 0, responseFlattenedKeys);
    try { size = JSON.stringify(body).length; } catch { size = 0; }
  }

  return {
    id: `req-${index}`,
    method: req.method || 'GET',
    url,
    path: cleanPath,
    serviceId,
    methodName,
    timestamp: req.timestamp || 0,
    requestQueryKeys,
    requestBodyKeys,
    responseTopLevelKeys,
    responseFlattenedKeys: responseFlattenedKeys.slice(0, MAX_FLATTENED_KEYS),
    responseSampleText: null,
    hasBody: body != null,
    size,
  };
}

function summarizeSsr(ssr: SsrData, elementText: string): SsrSummaryEntry {
  const topLevelKeys = ssr.data && typeof ssr.data === 'object'
    ? Object.keys(ssr.data).slice(0, 20)
    : [];
  const matchedPaths: string[] = [];
  if (elementText.length > 2 && ssr.data) {
    findTextInObject(ssr.data, elementText, '', 0, matchedPaths, 5);
  }
  return {
    key: ssr.key,
    topLevelKeys,
    containsElementText: matchedPaths.length > 0,
    matchedPaths,
  };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** 数据查询类方法名关键词（高相关） */
const DATA_METHOD_KEYWORDS = [
  'detail', 'aggregate', 'info', 'query', 'list', 'fetch', 'get',
  'search', 'recommend', 'price', 'room', 'album', 'picture', 'comment',
  'review', 'map', 'address', 'facility', 'policy', 'promotion',
];

/** 工具/配置/埋点类方法名关键词（低相关） */
const NOISE_METHOD_KEYWORDS = [
  'config', 'track', 'log', 'ping', 'health', 'monitor', 'abtest',
  'sdk', 'init', 'login', 'islogin', 'token', 'session', 'report',
];

function scoreCandidate(
  summary: NetworkRequestSummary,
  elementText: string,
  elementClassName: string,
  net: NetworkContext,
): NetworkCandidate {
  let score = 0;
  const reasons: string[] = [];
  const matchedPaths: string[] = [];

  const rawReq = net.requests.find(r => r.endpoint === summary.url);
  const body = rawReq?.body;

  // ── Signal 1: element text 在 response body 中（最强信号，+10）
  if (body && elementText.length > 2) {
    findTextInObject(body, elementText, '', 0, matchedPaths, 5);
    if (matchedPaths.length > 0) {
      score += 10;
      reasons.push(`text "${elementText.slice(0, 30)}" found in ${matchedPaths[0]}`);
      summary.responseSampleText = extractSampleAroundMatch(body, elementText);
    }
  }

  // ── Signal 2: SOA 方法名语义匹配（+5 数据查询，-3 工具类）
  const mn = (summary.methodName || '').toLowerCase();
  if (mn) {
    const isDataMethod = DATA_METHOD_KEYWORDS.some(kw => mn.includes(kw));
    const isNoiseMethod = NOISE_METHOD_KEYWORDS.some(kw => mn.includes(kw));
    if (isDataMethod && !isNoiseMethod) {
      score += 5;
      reasons.push(`method "${summary.methodName}" is data-query type`);
    } else if (isNoiseMethod) {
      score -= 3;
      reasons.push(`method "${summary.methodName}" is utility/config type`);
    }
  }

  // ── Signal 3: 方法名与 element text 存在词重叠（+4）
  if (mn && elementText.length > 2) {
    // 从 element text 提取关键词（中文按字，英文按词）
    const textTokens = elementText.toLowerCase().split(/[\s,./\\·\-_]+/).filter(t => t.length > 2);
    for (const token of textTokens) {
      if (mn.includes(token)) {
        score += 4;
        reasons.push(`method name contains "${token}" from element text`);
        break;
      }
    }
  }

  // ── Signal 4: response key 名与 className token 匹配（+3）
  const classTokens = elementClassName.split(/\s+/).filter(c => c.length > 3);
  for (const key of summary.responseFlattenedKeys) {
    const keyLower = key.toLowerCase();
    for (const token of classTokens) {
      if (keyLower.includes(token.toLowerCase())) {
        score += 3;
        reasons.push(`key "${key}" matches class "${token}"`);
        break;
      }
    }
  }

  // ── Signal 5: response 有实质内容（+1）
  if (summary.responseTopLevelKeys.length > 3) {
    score += 1;
    reasons.push(`rich response (${summary.responseTopLevelKeys.length} keys)`);
  }

  // ── Signal 6: 有实际 body 数据（+2）
  if (body != null) {
    score += 2;
    reasons.push('has response body');
  }

  // ── Penalty: 路径级噪声
  const pathLower = summary.path.toLowerCase();
  const noisePathPatterns = ['/track', '/log', '/ping', '/health', '/monitor'];
  for (const np of noisePathPatterns) {
    if (pathLower.includes(np)) {
      score -= 5;
      reasons.push(`noise path "${np}"`);
      break;
    }
  }

  return { summary, score, scoreReasons: reasons, matchedPaths };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** 递归展平 object keys 为 dot-path，最多 maxDepth 层 */
function flattenKeys(obj: any, prefix: string, depth: number, out: string[]): void {
  if (depth >= MAX_FLATTEN_DEPTH || out.length >= MAX_FLATTENED_KEYS) return;
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object') {
      flattenKeys(obj[0], prefix + '[]', depth + 1, out);
    }
    return;
  }

  for (const key of Object.keys(obj).slice(0, 30)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    const val = obj[key];
    if (val && typeof val === 'object') {
      flattenKeys(val, path, depth + 1, out);
    }
  }
}

/** 在嵌套 object 中查找包含 text 的字符串字段，记录路径 */
function findTextInObject(
  obj: any,
  text: string,
  prefix: string,
  depth: number,
  out: string[],
  maxMatches: number,
): void {
  if (depth > 4 || out.length >= maxMatches) return;
  if (typeof obj === 'string') {
    if (obj.includes(text)) {
      out.push(prefix || '(root)');
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 10); i++) {
      findTextInObject(obj[i], text, `${prefix}[${i}]`, depth + 1, out, maxMatches);
    }
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj).slice(0, 40)) {
      findTextInObject(obj[key], text, prefix ? `${prefix}.${key}` : key, depth + 1, out, maxMatches);
    }
  }
}

/** 从 body 中提取包含 elementText 的字段值片段（用于给 LLM 看采样） */
function extractSampleAroundMatch(obj: any, text: string): string | null {
  const found = findFirstStringContaining(obj, text, 0);
  if (!found) return null;
  const idx = found.indexOf(text);
  const start = Math.max(0, idx - 30);
  const end = Math.min(found.length, idx + text.length + 30);
  return found.slice(start, end);
}

function findFirstStringContaining(obj: any, text: string, depth: number): string | null {
  if (depth > 4) return null;
  if (typeof obj === 'string' && obj.includes(text)) return obj;
  if (Array.isArray(obj)) {
    for (const item of obj.slice(0, 10)) {
      const r = findFirstStringContaining(item, text, depth + 1);
      if (r) return r;
    }
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj).slice(0, 40)) {
      const r = findFirstStringContaining(val, text, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// ── Format for prompt ────────────────────────────────────────────────────────

/**
 * 将 RankedNetworkResult 格式化为精简的 prompt 片段（给 LLM 看）。
 * 只包含 top candidates 的摘要，不包含原始 body。
 */
export function formatCandidatesForPrompt(ranked: RankedNetworkResult): string {
  if (!ranked.candidates.length && !ranked.ssrSummary.length) return '';

  const hasAnyBody = ranked.candidates.some(c => c.summary.hasBody);
  const total = ranked.candidates.length + ranked.skippedEndpoints.length;

  const lines: string[] = [
    '## Network Candidates (pre-ranked by relevance)',
    '',
  ];

  if (!hasAnyBody) {
    lines.push('_Note: No response bodies were captured (SSR page or requests occurred before inspection). Ranking is based on endpoint semantics only. Consider ALL candidates below for your analysis._');
    lines.push('');
  }

  // SSR matches
  const ssrMatches = ranked.ssrSummary.filter(s => s.containsElementText);
  if (ssrMatches.length) {
    lines.push('### SSR Data Matches');
    for (const s of ssrMatches) {
      lines.push(`- **${s.key}**: element text found at ${s.matchedPaths.slice(0, 3).join(', ')}`);
    }
    lines.push('');
  }

  // Top candidates
  if (ranked.candidates.length) {
    lines.push(`### API Candidates (${ranked.candidates.length} of ${total} requests)`);
    lines.push('');
    for (const c of ranked.candidates) {
      const s = c.summary;
      const label = s.methodName
        ? `**${s.method} ${s.path}** — \`${s.methodName}\` (service: ${s.serviceId})`
        : `**${s.method} ${s.path}**`;
      lines.push(`${label}  score=${c.score}`);
      if (c.matchedPaths.length) {
        lines.push(`  Element text found at: ${c.matchedPaths.slice(0, 3).join(', ')}`);
      }
      if (s.responseSampleText) {
        lines.push(`  Sample: "${s.responseSampleText}"`);
      }
      if (s.responseTopLevelKeys.length) {
        lines.push(`  Response keys: ${s.responseTopLevelKeys.slice(0, 10).join(', ')}`);
      }
      if (c.scoreReasons.length) {
        lines.push(`  Signals: ${c.scoreReasons.join('; ')}`);
      }
    }
    lines.push('');
  }

  // Skipped
  if (ranked.skippedEndpoints.length) {
    lines.push(`_${ranked.skippedEndpoints.length} other request(s) excluded: ${ranked.skippedEndpoints.slice(0, 5).join(', ')}${ranked.skippedEndpoints.length > 5 ? ' …' : ''}_`);
  }

  return '\n' + lines.join('\n') + '\n';
}
