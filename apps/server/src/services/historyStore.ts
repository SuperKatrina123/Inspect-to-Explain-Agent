/**
 * historyStore.ts
 *
 * In-memory history store with optional JSON-file persistence.
 * Each POST /analyze-element call appends one entry here.
 * Entries are stored newest-first; max 100 kept.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ElementContext, AnalysisResult, HistoryEntry } from '../types';

const HISTORY_FILE = path.resolve(__dirname, '../../.history.json');
const MAX_ENTRIES = 100;

let store: HistoryEntry[] = [];
let counter = 0;

// ── Persistence helpers ─────────────────────────────────────────────────────

function loadFromDisk(): void {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
      store = JSON.parse(raw) as HistoryEntry[];
      console.log(`[history] Loaded ${store.length} entries from disk`);
    }
  } catch {
    store = [];
  }
}

function saveToDisk(): void {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[history] Failed to persist:', err);
  }
}

// Load on first import (server startup)
loadFromDisk();

// ── Public API ──────────────────────────────────────────────────────────────

export function addEntry(context: ElementContext, result: AnalysisResult): HistoryEntry {
  const entry: HistoryEntry = {
    id: `${Date.now()}-${++counter}`,
    timestamp: new Date().toISOString(),
    context,
    result,
  };

  store.unshift(entry);                          // newest first
  if (store.length > MAX_ENTRIES) store.splice(MAX_ENTRIES); // cap
  saveToDisk();
  return entry;
}

export function getAll(): HistoryEntry[] {
  return store;
}

export function getById(id: string): HistoryEntry | undefined {
  return store.find((e) => e.id === id);
}

export function deleteById(id: string): boolean {
  const idx = store.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  store.splice(idx, 1);
  saveToDisk();
  return true;
}

export function clearAll(): void {
  store = [];
  saveToDisk();
}
