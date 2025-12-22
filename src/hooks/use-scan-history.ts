// Scan history tracking for returning users
// Stores scan results in localStorage to show progress over time

import { useState, useEffect, useCallback } from 'react';

export interface ScanHistoryEntry {
  id: string;
  timestamp: string;
  atsScore: number;
  industry: string | null;
  experienceLevel: string | null;
  formatGrade: string;
  keywordCount: number;
  redFlagCount: number;
  // Summary metrics for trend tracking
  quantificationScore?: number;
  bulletImpactScore?: number;
  readabilityScore?: number;
}

export interface ScanHistory {
  entries: ScanHistoryEntry[];
  email: string | null;
  firstScanAt: string | null;
  lastScanAt: string | null;
  totalScans: number;
}

const STORAGE_KEY = 'rb_scan_history';
const MAX_HISTORY_ENTRIES = 10; // Keep last 10 scans
const HISTORY_EXPIRY_DAYS = 90; // Keep history for 90 days

const defaultHistory: ScanHistory = {
  entries: [],
  email: null,
  firstScanAt: null,
  lastScanAt: null,
  totalScans: 0,
};

export const useScanHistory = () => {
  const [history, setHistory] = useState<ScanHistory>(defaultHistory);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load history from storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ScanHistory;
        
        // Filter out entries older than expiry
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - HISTORY_EXPIRY_DAYS);
        
        const validEntries = parsed.entries.filter(entry => {
          const entryDate = new Date(entry.timestamp);
          return entryDate > cutoffDate;
        });
        
        // Update history with filtered entries
        const updatedHistory: ScanHistory = {
          ...parsed,
          entries: validEntries,
        };
        
        setHistory(updatedHistory);
        
        // Save cleaned history back
        if (validEntries.length !== parsed.entries.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
        }
      }
    } catch (e) {
      console.warn('[ScanHistory] Failed to load history:', e);
    }
    setIsLoaded(true);
  }, []);

  // Save history to storage
  const saveHistory = useCallback((newHistory: ScanHistory) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
      setHistory(newHistory);
    } catch (e) {
      console.warn('[ScanHistory] Failed to save history:', e);
    }
  }, []);

  // Add a new scan entry
  const addScanEntry = useCallback((entry: Omit<ScanHistoryEntry, 'id' | 'timestamp'>) => {
    const newEntry: ScanHistoryEntry = {
      ...entry,
      id: `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    const updatedEntries = [newEntry, ...history.entries].slice(0, MAX_HISTORY_ENTRIES);
    
    const newHistory: ScanHistory = {
      ...history,
      entries: updatedEntries,
      firstScanAt: history.firstScanAt || newEntry.timestamp,
      lastScanAt: newEntry.timestamp,
      totalScans: history.totalScans + 1,
    };

    saveHistory(newHistory);
    console.log('[ScanHistory] Added scan entry', { score: entry.atsScore, total: newHistory.totalScans });
    
    return newEntry;
  }, [history, saveHistory]);

  // Associate email with history
  const setUserEmail = useCallback((email: string) => {
    const newHistory: ScanHistory = {
      ...history,
      email,
    };
    saveHistory(newHistory);
  }, [history, saveHistory]);

  // Clear history
  const clearHistory = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setHistory(defaultHistory);
    } catch (e) {
      console.warn('[ScanHistory] Failed to clear history:', e);
    }
  }, []);

  // Get previous scan for comparison
  const getPreviousScan = useCallback((): ScanHistoryEntry | null => {
    if (history.entries.length < 2) return null;
    return history.entries[1]; // Second entry is previous (first is current)
  }, [history.entries]);

  // Get the most recent scan
  const getLatestScan = useCallback((): ScanHistoryEntry | null => {
    if (history.entries.length === 0) return null;
    return history.entries[0];
  }, [history.entries]);

  // Calculate score trend (positive = improving, negative = declining)
  const getScoreTrend = useCallback(() => {
    if (history.entries.length < 2) return null;
    
    const latest = history.entries[0];
    const previous = history.entries[1];
    
    return {
      currentScore: latest.atsScore,
      previousScore: previous.atsScore,
      change: latest.atsScore - previous.atsScore,
      isImproving: latest.atsScore > previous.atsScore,
      percentChange: ((latest.atsScore - previous.atsScore) / previous.atsScore * 100).toFixed(1),
    };
  }, [history.entries]);

  // Get average score over time
  const getAverageScore = useCallback(() => {
    if (history.entries.length === 0) return null;
    const sum = history.entries.reduce((acc, entry) => acc + entry.atsScore, 0);
    return Math.round(sum / history.entries.length);
  }, [history.entries]);

  // Get best score achieved
  const getBestScore = useCallback(() => {
    if (history.entries.length === 0) return null;
    return Math.max(...history.entries.map(e => e.atsScore));
  }, [history.entries]);

  // Check if this is a returning user
  const isReturningUser = history.totalScans > 1 || history.entries.length > 0;

  return {
    history,
    isLoaded,
    isReturningUser,
    addScanEntry,
    setUserEmail,
    clearHistory,
    getPreviousScan,
    getLatestScan,
    getScoreTrend,
    getAverageScore,
    getBestScore,
    totalScans: history.totalScans,
    hasEmail: !!history.email,
  };
};
