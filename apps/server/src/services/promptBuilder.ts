import { ElementContext, CodeReference, SoaReference, NetworkContext } from '../types';
import { maskSensitiveData } from './dataMasker';

/**
 * Builds the system prompt that instructs the LLM on the analysis task,
 * available source types, and the exact JSON schema to return.
 */
export function buildSystemPrompt(): string {
  return `You are a frontend code analysis assistant embedded in an "Inspect-to-Explain" developer tool.

A developer has clicked on a DOM element in a React web page. You will receive the element's runtime context (tag, text, CSS classes, ancestors, siblings, nearby texts) and must infer:

1. Which UI **module** this element belongs to (e.g. UserProfileCard, OrderSummary).
2. Which **React components** most likely render it (list 1–3 candidates).
3. The **source type** of the element's content — choose exactly one:
   - "frontend_static"  : hardcoded string literal in JSX template
   - "api_response"     : value comes from a backend API / mock data object
   - "config_driven"    : rendered by iterating a config/constant array
   - "derived_field"    : computed at render time (sum, format, conditional concat)
   - "unknown_candidate": insufficient signal to determine

4. A **confidence** score 0.0–1.0 for your overall judgment.
5. A list of concrete **evidence** items that support your reasoning (class names, ancestor chain, text pattern, network data, etc.).
6. A clear one-paragraph **explanation** in English suitable for a developer.

## Output format (STRICT JSON — no markdown, no prose outside the object)

{
  "elementText":          string,   // the selected element's visible text, max 100 chars
  "moduleName":           string,   // PascalCase module name
  "candidateComponents":  string[], // 1–3 PascalCase component names
  "sourceType":           "frontend_static" | "api_response" | "config_driven" | "derived_field" | "unknown_candidate",
  "confidence":           number,   // 0.0 – 1.0, two decimal places
  "evidence":             string[], // 3–6 short evidence strings
  "explanation":          string    // 2–4 sentences
}

Rules:
- Output ONLY the JSON object. No \`\`\`json fences, no extra keys.
- If uncertain, lower confidence and say so in explanation.
- Base reasoning solely on the provided context; do not invent file paths.
- When SOA references are provided, they are STRONG evidence that the element's data comes from that service. Set sourceType to "api_response" unless there is clear counter-evidence.
- If the SOA method name semantically matches the element content (e.g. "fetchHotelInfoList" → hotel price/name), confidence should be ≥ 0.85.
- When network data is provided, it is the strongest signal for sourceType. Prioritize it.
- If the element's text appears in a network response body, sourceType is almost certainly "api_response" or "derived_field".
- If SSR hydration data is provided, treat it as equivalent to an API response.
- If no network match exists and the text looks like a static label, lean toward "frontend_static".`;
}

/**
 * Formats the NetworkContext into a compact LLM-readable section.
 * Response bodies are recursively masked for PII before inclusion.
 * Bodies are depth-limited and truncated to keep token count reasonable.
 */
function buildNetworkSection(net: NetworkContext): string {
  if (!net.requests.length && !net.ssrData.length) return '';

  const lines: string[] = [
    `## Network Context (recorded while Inspect Mode was ON, filter: "${net.filter}")`,
    '',
    'Use this as the PRIMARY signal for sourceType. Look for the element text in response bodies.',
    '',
  ];

  if (net.ssrData.length) {
    lines.push('### SSR Hydration Data');
    for (const ssr of net.ssrData.slice(0, 3)) {
      const masked = maskSensitiveData(ssr.data);
      const json = JSON.stringify(masked, null, 2);
      // Truncate large SSR blobs
      const truncated = json.length > 2000 ? json.slice(0, 2000) + '\n… (truncated)' : json;
      lines.push(`\n**${ssr.key}**\n\`\`\`json\n${truncated}\n\`\`\``);
    }
    lines.push('');
  }

  if (net.requests.length) {
    lines.push(`### API Responses (${net.requests.length} recorded)`);
    for (const req of net.requests.slice(0, 6)) {
      const masked = maskSensitiveData(req.body);
      const json = JSON.stringify(masked, null, 2);
      const truncated = json.length > 1500 ? json.slice(0, 1500) + '\n… (truncated)' : json;
      lines.push(`\n**${req.method} ${req.endpoint}**\n\`\`\`json\n${truncated}\n\`\`\``);
    }
  }

  return '\n' + lines.join('\n') + '\n';
}

/**
 * Serialises the ElementContext into a compact, readable user message
 * so the LLM has maximum signal in minimum tokens.
 * Optionally includes local code search results and network context.
 */
export function buildUserMessage(ctx: ElementContext, codeRefs?: CodeReference[], soaRefs?: SoaReference[]): string {
  const { selectedElement: el, ancestors, siblings, nearbyTexts, url, reactComponentStack, networkContext } = ctx;

  const ancestorChain = ancestors
    .map((a) => {
      const parts = [a.tag];
      if (a.id)        parts.push(`#${a.id}`);
      if (a.className) parts.push(`.${a.className.split(' ').slice(0, 2).join('.')}`);
      return `<${parts.join('')}>`;
    })
    .join(' > ');

  const siblingList = siblings
    .slice(0, 5)
    .map((s) => `  • <${s.tag} class="${s.className}">${s.text ? `"${s.text.slice(0, 40)}"` : '(empty)'}`)
    .join('\n');

  // Fiber component stack section — only included when available
  const fiberSection = reactComponentStack && reactComponentStack.length > 0
    ? `\n## React Component Stack (from Fiber tree — most reliable signal)\n\n${reactComponentStack.join(' → ')}\n\nThe nearest component to the selected element is listed first. Use this as your primary signal for moduleName and candidateComponents.\n`
    : '';

  // Network section — strongest signal for sourceType
  const networkSection = networkContext ? buildNetworkSection(networkContext) : '';

  return `## Selected Element

- Tag:       ${el.tag}
- Text:      "${el.text.slice(0, 120)}"
- className: "${el.className}"
- id:        "${el.id || '(none)'}"
- Selector:  ${el.selector}
- XPath:     ${el.xpath}
- Page URL:  ${url}

## DOM Ancestors (nearest → root)

${ancestorChain || '(none)'}

## Sibling Elements (${siblings.length} total, showing first 5)

${siblingList || '(none)'}

## Nearby Visible Texts

${nearbyTexts.slice(0, 8).map((t) => `  • "${t.slice(0, 80)}"`).join('\n') || '(none)'}
${fiberSection}${networkSection}${codeRefs && codeRefs.length > 0 ? `
## Local Code References (found by static search)

The following source file locations were found by searching the local codebase. Use these to ground your analysis in the actual code:

${codeRefs.map((r) => `  📄 ${r.file}:${r.line} [${r.componentName}]\n     ${r.snippet}`).join('\n\n')}
` : ''}${soaRefs && soaRefs.length > 0 ? `
## SOA / BFF Service Calls (found statically in candidate component files)

These backend service endpoints were found by scanning the source code of the candidate components above.
This is STRONG evidence that the element's data is fetched from one of these services (sourceType = "api_response").
Match the element text / context to the most semantically relevant method name.

${soaRefs.map((r) => `  🔌 ${r.endpoint}\n     method: ${r.methodName}  serviceId: ${r.serviceId}\n     found in: ${r.file}:${r.line}\n     snippet: ${r.snippet}`).join('\n\n')}
` : ''}
---
Analyze this element and return the JSON result.`;
}
