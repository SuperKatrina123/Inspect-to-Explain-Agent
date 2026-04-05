import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import { ElementContext, CodeReference } from '../types';

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

/**
 * Extract search tokens from element context:
 * 1. Individual CSS class name tokens from selectedElement + ancestors
 * 2. PascalCase component name guesses from ancestor class names
 */
function extractSearchTokens(ctx: ElementContext): { classTokens: string[]; componentNames: string[] } {
  const allClasses = [
    ctx.selectedElement.className,
    ...ctx.ancestors.map(a => a.className),
  ]
    .join(' ')
    .split(/\s+/)
    .map(c => c.trim())
    .filter(c => c.length > 2);

  // Deduplicate while preserving order
  const classTokens = [...new Set(allClasses)];

  // Derive component name guesses: longest class tokens in ancestors usually
  // correspond to a component root (e.g. "user-profile-card" → "UserProfileCard")
  const componentNames = [...new Set(
    ctx.ancestors
      .map(a => a.className.split(/\s+/)[0])
      .filter(c => c.length > 4 && c.includes('-'))
      .map(kebabToPascal)
  )];

  return { classTokens, componentNames };
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

/**
 * Search all source files for occurrences of the given tokens.
 * Returns deduplicated, scored, and sorted matches.
 */
export function searchByContext(ctx: ElementContext, projectRoot: string): CodeReference[] {
  const { classTokens, componentNames } = extractSearchTokens(ctx);

  if (!classTokens.length && !componentNames.length) return [];

  const files = collectFiles(projectRoot);
  const rawMatches: RawMatch[] = [];
  const seenLines = new Set<string>();     // "file:line" dedup key

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
      const lowerLine = rawLine.toLowerCase();
      const dedupeKey = `${relPath}:${i + 1}`;
      if (seenLines.has(dedupeKey)) continue;

      // Check class token matches
      for (const token of classTokens) {
        if (lowerLine.includes(token.toLowerCase())) {
          const score = scoreLine(rawLine, token);
          if (score > 0) {
            rawMatches.push({
              file: relPath,
              line: i + 1,
              snippet: rawLine.trim().slice(0, 150),
              score,
              componentName,
            });
            seenLines.add(dedupeKey);
            break; // one match per line is enough
          }
        }
      }

      // Also match component name mentions (e.g. <UserProfileCard or function UserProfileCard)
      if (!seenLines.has(dedupeKey)) {
        for (const compName of componentNames) {
          if (rawLine.includes(compName)) {
            rawMatches.push({
              file: relPath,
              line: i + 1,
              snippet: rawLine.trim().slice(0, 150),
              score: scoreLine(rawLine, compName) + 1,
              componentName,
            });
            seenLines.add(dedupeKey);
            break;
          }
        }
      }
    }
  }

  // Sort by score desc, then limit
  rawMatches.sort((a, b) => b.score - a.score);

  // Deduplicate by component file (keep highest-scored line per file)
  const byFile = new Map<string, RawMatch>();
  for (const m of rawMatches) {
    if (!byFile.has(m.file) || m.score > byFile.get(m.file)!.score) {
      byFile.set(m.file, m);
    }
  }

  return [...byFile.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ file, line, snippet, componentName }) => ({ file, line, snippet, componentName }));
}
