import { ElementContext, CodeReference } from '../types';

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
5. A list of concrete **evidence** items that support your reasoning (class names, ancestor chain, text pattern, etc.).
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
- Base reasoning solely on the provided context; do not invent file paths.`;
}

/**
 * Serialises the ElementContext into a compact, readable user message
 * so the LLM has maximum signal in minimum tokens.
 * Optionally includes local code search results for grounded analysis.
 */
export function buildUserMessage(ctx: ElementContext, codeRefs?: CodeReference[]): string {
  const { selectedElement: el, ancestors, siblings, nearbyTexts, url, reactComponentStack } = ctx;

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
${fiberSection}${codeRefs && codeRefs.length > 0 ? `
## Local Code References (found by static search)

The following source file locations were found by searching the local codebase. Use these to ground your analysis in the actual code:

${codeRefs.map((r) => `  📄 ${r.file}:${r.line} [${r.componentName}]\n     ${r.snippet}`).join('\n\n')}
` : ''}
---
Analyze this element and return the JSON result.`;
}
