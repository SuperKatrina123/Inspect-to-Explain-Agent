/**
 * useHistory — fetches and manages inspect session history from the server.
 * Call `refresh()` after a successful analysis to update the list.
 */
import { useState, useCallback, useEffect } from 'react';
import { HistoryEntry } from '../types';

const SERVER_URL = 'http://localhost:3001';

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  loading: boolean;
  refresh: () => void;
  deleteEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export function useHistory(): UseHistoryReturn {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/history`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      // ignore network errors silently — history is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteEntry = useCallback(async (id: string) => {
    await fetch(`${SERVER_URL}/api/history/${id}`, { method: 'DELETE' });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAll = useCallback(async () => {
    await fetch(`${SERVER_URL}/api/history`, { method: 'DELETE' });
    setEntries([]);
  }, []);

  // Load history on mount
  useEffect(() => { refresh(); }, [refresh]);

  return { entries, loading, refresh, deleteEntry, clearAll };
}
