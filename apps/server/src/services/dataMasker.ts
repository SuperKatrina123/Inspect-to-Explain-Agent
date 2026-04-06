/**
 * dataMasker.ts
 *
 * Recursively masks sensitive fields in a JSON object before it is sent to the LLM.
 * Rules:
 *   - String values matching known PII patterns → replaced with a labeled placeholder
 *   - Object keys matching known sensitive names → value replaced with placeholder
 *   - Does NOT alter structure, keys, or non-sensitive values
 */

// ── Pattern-based masking ─────────────────────────────────────────────────────

const VALUE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'PHONE',    pattern: /(?:^|\s|")(1[3-9]\d{9})(?:\s|"|$)/ },          // CN mobile
  { name: 'EMAIL',    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/ },
  { name: 'ID_CARD',  pattern: /\b\d{17}[\dXx]\b/ },                            // CN national ID
  { name: 'BANK_CARD',pattern: /\b\d{13,19}\b/ },
  { name: 'JWT',      pattern: /^eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/ },
  { name: 'IPV4',     pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
];

/** Keys whose values should always be masked regardless of content */
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token', 'idToken', 'id_token', 'authorization',
  'creditCard', 'credit_card', 'cvv', 'ssn', 'nationalId', 'national_id',
  'privateKey', 'private_key', 'apiKey', 'api_key',
]);

function maskString(value: string): string {
  for (const { name, pattern } of VALUE_PATTERNS) {
    if (pattern.test(value)) return `[MASKED:${name}]`;
  }
  return value;
}

/**
 * Recursively walk `obj` and return a deep copy with sensitive values masked.
 * Arrays and nested objects are traversed fully.
 * Depth is capped at 10 to guard against circular/huge structures.
 */
export function maskSensitiveData(obj: any, depth = 0): any {
  if (depth > 10) return obj;
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') return maskString(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveData(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_KEYS.has(key)) {
        result[key] = '[MASKED:SENSITIVE_KEY]';
      } else {
        result[key] = maskSensitiveData(obj[key], depth + 1);
      }
    }
    return result;
  }

  return obj;
}
