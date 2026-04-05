import { ElementContext, AnalysisResult, SourceType } from '../types';

// ── Module detection: map class/id patterns → component name ──────────────────
const MODULE_PATTERNS: Array<{ pattern: RegExp; module: string }> = [
  { pattern: /user-profile|profile-card|profile-info/i, module: 'UserProfileCard' },
  { pattern: /order-summary|order-item|price-breakdown/i, module: 'OrderSummary' },
  { pattern: /marketing-benefits|benefit-item|benefits-list/i, module: 'MarketingBenefits' },
];

const COMPONENT_MAP: Record<string, string[]> = {
  UserProfileCard: ['UserProfileCard', 'ProfileAvatar', 'ProfileInfo'],
  OrderSummary: ['OrderSummary', 'OrderItemRow', 'PriceBreakdown'],
  MarketingBenefits: ['MarketingBenefits', 'BenefitItem', 'BenefitList'],
  Unknown: ['UnknownComponent'],
};

// ── Infer module from class names, ids, and nearby text ──────────────────────
function inferModuleName(ctx: ElementContext): string {
  const allTokens = [
    ctx.selectedElement.className,
    ctx.selectedElement.id,
    ...ctx.ancestors.map((a) => `${a.className} ${a.id}`),
  ].join(' ');

  for (const { pattern, module } of MODULE_PATTERNS) {
    if (pattern.test(allTokens)) return module;
  }

  // Fallback: scan nearby texts for contextual keywords
  const nearbyJoined = ctx.nearbyTexts.join(' ').toLowerCase();
  if (/order|subtotal|shipping|discount/.test(nearbyJoined)) return 'OrderSummary';
  if (/benefit|exclusive|premium|cashback/.test(nearbyJoined)) return 'MarketingBenefits';
  if (/member|profile|joined|points|vip/.test(nearbyJoined)) return 'UserProfileCard';

  return 'Unknown';
}

// ── Infer source type from element characteristics ────────────────────────────
function inferSourceType(ctx: ElementContext): SourceType {
  const cls = ctx.selectedElement.className.toLowerCase();
  const text = ctx.selectedElement.text;

  // Config-driven: rendered from a config list (benefit items, feature flags)
  if (/benefit-item|feature-item|config/.test(cls)) return 'config_driven';

  // Derived field: calculated values (totals, formatted numbers)
  if (/total|subtotal|price|amount|points/.test(cls) && /[\d$¥€]/.test(text)) {
    return 'derived_field';
  }

  // API response: dynamic user/order data
  if (/name|email|avatar|order-id|item-price|item-name/.test(cls)) return 'api_response';
  if (/@/.test(text) || /\d{4,}/.test(text)) return 'api_response';

  // Static text: labels, headers, short non-numeric strings
  if (text.length < 40 && !/\d/.test(text)) return 'frontend_static';

  return 'unknown_candidate';
}

// ── Collect evidence strings for the result ───────────────────────────────────
function collectEvidence(ctx: ElementContext): string[] {
  const ev: string[] = [];
  const { selectedElement: el, ancestors, nearbyTexts } = ctx;

  if (el.className) ev.push(`className="${el.className}"`);
  if (el.id) ev.push(`id="${el.id}"`);
  if (el.selector) ev.push(`CSS selector: ${el.selector}`);

  // Relevant ancestor breadcrumbs
  ancestors.slice(0, 3).forEach((a) => {
    const label = [a.id && `#${a.id}`, a.className && `.${a.className.split(' ')[0]}`]
      .filter(Boolean)
      .join('');
    ev.push(`ancestor <${a.tag}${label}>`);
  });

  if (nearbyTexts.length > 0) {
    ev.push(`nearby texts: "${nearbyTexts.slice(0, 3).join('", "')}"`);
  }

  return ev;
}

// ── Build human-readable explanation ─────────────────────────────────────────
function buildExplanation(
  module: string,
  sourceType: SourceType,
  elementText: string,
  components: string[],
): string {
  const SOURCE_DESC: Record<SourceType, string> = {
    frontend_static: 'hardcoded as a static string in the component template.',
    api_response: 'dynamically rendered from API-fetched data (mock data in demo).',
    config_driven: 'rendered by iterating over a configuration array (e.g. BENEFITS_CONFIG).',
    derived_field: 'computed or derived at render time (e.g. calculated total, formatted number).',
    unknown_candidate: 'of unclear origin — further code inspection is recommended.',
  };

  return (
    `"${elementText}" belongs to the ${module} module ` +
    `(likely rendered by ${components[0]}). ` +
    `The value appears to be ${SOURCE_DESC[sourceType]}`
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function analyzeElement(ctx: ElementContext): AnalysisResult {
  const moduleName = inferModuleName(ctx);
  const sourceType = inferSourceType(ctx);
  const evidence = collectEvidence(ctx);
  const candidateComponents = COMPONENT_MAP[moduleName] ?? COMPONENT_MAP['Unknown'];

  // Confidence scoring: reward rich context signals
  let confidence = 0.4;
  if (moduleName !== 'Unknown') confidence += 0.2;
  if (ctx.selectedElement.id) confidence += 0.1;
  if (evidence.length >= 4) confidence += 0.1;
  if (sourceType !== 'unknown_candidate') confidence += 0.15;
  confidence = Math.min(Math.round(confidence * 100) / 100, 1.0);

  return {
    elementText: ctx.selectedElement.text.slice(0, 100),
    moduleName,
    candidateComponents,
    sourceType,
    confidence,
    evidence,
    explanation: buildExplanation(moduleName, sourceType, ctx.selectedElement.text, candidateComponents),
  };
}
