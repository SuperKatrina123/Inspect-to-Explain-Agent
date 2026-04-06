import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import { ElementContext, CodeReference, SoaReference } from '../types';

// ── File scanning ─────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite', 'coverage']);
const SOURCE_EXTS = new Set(['.tsx', '.ts', '.jsx', '.js']);

/** Recursively collect all source files under a directory */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return results; }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        results.push(...collectFiles(full));
      } else if (SOURCE_EXTS.has(extname(entry))) {
        results.push(full);
      }
    } catch { /* skip unreadable */ }
  }
  return results;
}

// ── Token extraction ──────────────────────────────────────────────────────────

/** Convert a kebab-case class name to a likely PascalCase component name */
function kebabToPascal(s: string): string {
  return s.split(/[-_]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

interface SearchTokens {
  /** Component names from React Fiber — most reliable, used as primary signal */
  fiberComponents: string[];
  /** Kebab class names to search as fallback */
  classTokens: string[];
  /** PascalCase names guessed from ancestor class names (last resort) */
  guessedComponents: string[];
}

/**
 * Extract search tokens from element context.
 *
 * Priority:
 *   1. reactComponentStack (real Fiber names) — exact, no guessing needed
 *   2. className tokens from element + ancestors — fuzzy fallback
 *   3. PascalCase guesses from ancestor class root tokens
 */
function extractSearchTokens(ctx: ElementContext): SearchTokens {
  // 1. Fiber components
  const fiberComponents = (ctx.reactComponentStack ?? []).filter(
    // Skip internal React names and very generic ones
    (n) => n !== 'App' && n !== 'StrictMode' && n !== 'Router' && n.length > 2,
  );

  // 2. CSS class tokens
  const allClasses = [
    ctx.selectedElement.className,
    ...ctx.ancestors.map(a => a.className),
  ]
    .join(' ')
    .split(/\s+/)
    .map(c => c.trim())
    .filter(c => c.length > 2);
  const classTokens = [...new Set(allClasses)];

  // 3. Guessed PascalCase component names from ancestor root class names
  const guessedComponents = [...new Set(
    ctx.ancestors
      .map(a => a.className.split(/\s+/)[0])
      .filter(c => c.length > 4 && c.includes('-'))
      .map(kebabToPascal),
  )];

  return { fiberComponents, classTokens, guessedComponents };
}

// ── Line-level search ─────────────────────────────────────────────────────────

interface RawMatch {
  file: string;
  line: number;
  snippet: string;
  score: number;         // higher = more relevant
  componentName: string;
}

/** Score a matching line: prefer JSX className attrs and component definitions */
function scoreLine(snippet: string, token: string): number {
  let score = 1;
  if (snippet.includes('className')) score += 3;
  if (snippet.includes('function ') || snippet.includes('const ') || snippet.includes('=>')) score += 2;
  if (snippet.includes(`"${token}"`) || snippet.includes(`'${token}'`)) score += 2;
  if (snippet.trim().startsWith('//') || snippet.trim().startsWith('*')) score -= 5; // skip comments
  return score;
}

/** Score bonus for a line that declares a component with this exact name */
function scoreComponentDefinition(snippet: string, name: string): number {
  // Reward export/function/const/class declarations that name the component
  let score = 0;
  const patterns = [
    `function ${name}`,
    `const ${name}`,
    `class ${name}`,
    `export function ${name}`,
    `export const ${name}`,
    `export default function ${name}`,
  ];
  if (patterns.some(p => snippet.includes(p))) score += 8; // very strong signal
  else if (snippet.includes(name)) score += 3;             // import/usage mention
  if (snippet.trim().startsWith('//') || snippet.trim().startsWith('*')) score = 0;
  return score;
}

/**
 * Search all source files for relevant component/class references.
 *
 * Three-tier search strategy:
 *   Tier 1 — React Fiber component names (exact): look for function/const
 *             declarations with these names across all files.  High confidence.
 *   Tier 2 — className tokens: existing fuzzy line-score matching. Used when
 *             Fiber names produce < 2 results.
 *   Tier 3 — Guessed PascalCase names: last resort for pure DOM pages.
 */
export function searchByContext(ctx: ElementContext, projectRoot: string): CodeReference[] {
  const { fiberComponents, classTokens, guessedComponents } = extractSearchTokens(ctx);

  const files = collectFiles(projectRoot);
  const rawMatches: RawMatch[] = [];
  const seenLines = new Set<string>(); // "file:line" dedup key

  for (const filePath of files) {
    let lines: string[];
    try {
      lines = readFileSync(filePath, 'utf-8').split('\n');
    } catch { continue; }

    const relPath = relative(projectRoot, filePath);
    const fileBase = basename(filePath, extname(filePath));
    const componentName = fileBase;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const dedupeKey = `${relPath}:${i + 1}`;
      if (seenLines.has(dedupeKey)) continue;

      // ── Tier 1: Fiber component names ─────────────────────────────────────
      for (const name of fiberComponents) {
        const s = scoreComponentDefinition(rawLine, name);
        if (s > 0) {
          rawMatches.push({
            file: relPath,
            line: i + 1,
            snippet: rawLine.trim().slice(0, 150),
            score: s + 5, // Fiber results get a base boost
            componentName: name,
          });
          seenLines.add(dedupeKey);
          break;
        }
      }
      if (seenLines.has(dedupeKey)) continue;

      // ── Tier 2: className tokens ───────────────────────────────────────────
      for (const token of classTokens) {
        if (rawLine.toLowerCase().includes(token.toLowerCase())) {
          const s = scoreLine(rawLine, token);
          if (s > 0) {
            rawMatches.push({
              file: relPath, line: i + 1,
              snippet: rawLine.trim().slice(0, 150),
              score: s, componentName,
            });
            seenLines.add(dedupeKey);
            break;
          }
        }
      }
      if (seenLines.has(dedupeKey)) continue;

      // ── Tier 3: guessed PascalCase names ──────────────────────────────────
      for (const name of guessedComponents) {
        if (rawLine.includes(name)) {
          rawMatches.push({
            file: relPath, line: i + 1,
            snippet: rawLine.trim().slice(0, 150),
            score: scoreLine(rawLine, name) + 1,
            componentName,
          });
          seenLines.add(dedupeKey);
          break;
        }
      }
    }
  }

  // Deduplicate by file: keep the highest-scored line per file
  const byFile = new Map<string, RawMatch>();
  for (const m of rawMatches) {
    if (!byFile.has(m.file) || m.score > byFile.get(m.file)!.score) {
      byFile.set(m.file, m);
    }
  }

  const results = [...byFile.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ file, line, snippet, componentName }) => ({ file, line, snippet, componentName }));

  const tier = fiberComponents.length > 0 ? 'fiber' : classTokens.length > 0 ? 'className' : 'guess';
  console.log(`[code-search] tier=${tier} | fiber=[${fiberComponents.join(',')}] | found ${results.length} ref(s)`);
  results.forEach(r => console.log(`  📄 ${r.file}:${r.line}  ${r.snippet.slice(0, 60)}`));

  return results;
}

// ── SOA endpoint scanner ──────────────────────────────────────────────────────

/**
 * Matches SOA/BFF endpoint patterns commonly found in Ctrip-style monorepos:
 *   /restapi/soa2/31454/fetchHotelInfoList
 *   soa2/31454/fetchHotelInfoList   (without leading /restapi)
 *   SOA service IDs embedded in string literals, template literals, or comments
 */
const SOA_PATTERN = /(?:\/restapi)?\/soa2\/(\d{3,6})\/([A-Za-z]\w+)/g;

/**
 * Scan a set of source files (by relative path) for SOA endpoint calls.
 * Only scans the files already identified as candidate components to stay focused.
 *
 * @param codeRefs   Output of searchByContext — the candidate component files
 * @param projectRoot Absolute path to the project root
 */
export function searchSoaEndpoints(
  codeRefs: CodeReference[],
  projectRoot: string,
): SoaReference[] {
  if (!codeRefs.length) return [];

  const results: SoaReference[] = [];
  const seen = new Set<string>(); // deduplicate by "file:endpoint"

  for (const ref of codeRefs) {
    const absPath = join(projectRoot, ref.file);
    let lines: string[];
    try {
      lines = readFileSync(absPath, 'utf-8').split('\n');
    } catch { continue; }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      SOA_PATTERN.lastIndex = 0; // reset stateful regex
      let match: RegExpExecArray | null;
      while ((match = SOA_PATTERN.exec(line)) !== null) {
        const [fullMatch, serviceId, methodName] = match;
        // Normalise to always have /restapi prefix for consistency
        const endpoint = fullMatch.startsWith('/restapi')
          ? fullMatch
          : `/restapi${fullMatch}`;
        const dedupeKey = `${ref.file}:${endpoint}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        results.push({
          file: ref.file,
          line: i + 1,
          endpoint,
          serviceId,
          methodName,
          snippet: line.trim().slice(0, 150),
        });
      }
    }
  }

  console.log(`[soa-scan] Found ${results.length} SOA endpoint(s) in candidate files`);
  results.forEach(r => console.log(`  🔌 ${r.endpoint}  (${r.file}:${r.line})`));

  return results;
}
