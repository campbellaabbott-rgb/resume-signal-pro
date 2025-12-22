// Scan history tracking for returning users
// Stores scan results in localStorage to show progress over time

import { useState, useEffect, useCallback, useMemo } from 'react';

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
  category: 'quick_win' | 'format' | 'content' | 'keywords';
}

export interface ScanHistoryEntry {
  id: string;
  timestamp: string;
  // Candidate info
  candidateName: string | null;
  currentRole: string | null;
  // Scores
  atsScore: number;
  formatGrade: string;
  quantificationScore?: number;
  bulletImpactScore?: number;
  readabilityScore?: number;
  // Context
  industry: string | null;
  experienceLevel: string | null;
  // Metrics for tracking
  keywordCount: number;
  redFlagCount: number;
  // Checklist progress
  checklist?: ChecklistItem[];
  checklistCompletedCount?: number;
  // Resume fingerprint for deduplication
  resumeHash?: string;
  // Job matching (if applicable)
  jobMatchScore?: number;
  jobTitle?: string;
  jobCompany?: string;
}

export interface ScanHistory {
  entries: ScanHistoryEntry[];
  email: string | null;
  firstScanAt: string | null;
  lastScanAt: string | null;
  totalScans: number;
  // Best scores achieved
  bestAtsScore: number | null;
  bestFormatGrade: string | null;
}

const STORAGE_KEY = 'rb_scan_history';
const MAX_HISTORY_ENTRIES = 15; // Keep last 15 scans
const HISTORY_EXPIRY_DAYS = 90; // Keep history for 90 days

const defaultHistory: ScanHistory = {
  entries: [],
  email: null,
  firstScanAt: null,
  lastScanAt: null,
  totalScans: 0,
  bestAtsScore: null,
  bestFormatGrade: null,
};

// Generate a simple hash from resume text for deduplication
function generateResumeHash(resumeText: string): string {
  const normalized = resumeText.toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 500);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Get grade ranking for comparison
function gradeRank(grade: string): number {
  const ranks: Record<string, number> = { 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
  return ranks[grade] || 0;
}

// Generate default checklist based on analysis results
export function generateChecklist(analysisData: {
  quickWins?: { fix: string; impact: string }[];
  formatGrade?: string;
  formatIssue?: string;
  keywords?: { keyword: string }[];
  redFlags?: { issue: string }[];
}): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  
  // Add quick wins
  if (analysisData.quickWins) {
    analysisData.quickWins.slice(0, 3).forEach((qw, i) => {
      items.push({
        id: `quick_win_${i}`,
        label: qw.fix,
        completed: false,
        category: 'quick_win'
      });
    });
  }
  
  // Add format fix if needed
  if (analysisData.formatGrade && gradeRank(analysisData.formatGrade) < 3 && analysisData.formatIssue) {
    items.push({
      id: 'format_fix',
      label: analysisData.formatIssue,
      completed: false,
      category: 'format'
    });
  }
  
  // Add top keyword suggestions
  if (analysisData.keywords) {
    analysisData.keywords.slice(0, 3).forEach((kw, i) => {
      items.push({
        id: `keyword_${i}`,
        label: `Add keyword: ${kw.keyword}`,
        completed: false,
        category: 'keywords'
      });
    });
  }
  
  // Add red flag fixes
  if (analysisData.redFlags) {
    analysisData.redFlags.slice(0, 2).forEach((rf, i) => {
      items.push({
        id: `redflag_${i}`,
        label: `Fix: ${rf.issue}`,
        completed: false,
        category: 'content'
      });
    });
  }
  
  return items;
}

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
        
        // Recalculate best scores
        let bestAts = parsed.bestAtsScore;
        let bestFormat = parsed.bestFormatGrade;
        
        if (validEntries.length > 0) {
          bestAts = Math.max(...validEntries.map(e => e.atsScore));
          bestFormat = validEntries.reduce((best, e) => {
            if (!best) return e.formatGrade;
            return gradeRank(e.formatGrade) > gradeRank(best) ? e.formatGrade : best;
          }, null as string | null);
        }
        
        const updatedHistory: ScanHistory = {
          ...parsed,
          entries: validEntries,
          bestAtsScore: bestAts,
          bestFormatGrade: bestFormat,
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

  // Check if this is a duplicate scan (same resume within 5 minutes)
  const isDuplicateScan = useCallback((resumeHash: string): boolean => {
    if (history.entries.length === 0) return false;
    
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    return history.entries.some(entry => {
      if (entry.resumeHash !== resumeHash) return false;
      const entryTime = new Date(entry.timestamp);
      return entryTime > fiveMinutesAgo;
    });
  }, [history.entries]);

  // Add a new scan entry
  const addScanEntry = useCallback((
    entry: Omit<ScanHistoryEntry, 'id' | 'timestamp'>,
    resumeText?: string
  ) => {
    const resumeHash = resumeText ? generateResumeHash(resumeText) : undefined;
    
    // Check for duplicate
    if (resumeHash && isDuplicateScan(resumeHash)) {
      console.log('[ScanHistory] Duplicate scan detected, skipping');
      // Return the existing entry instead
      const existing = history.entries.find(e => e.resumeHash === resumeHash);
      if (existing) return existing;
    }
    
    const newEntry: ScanHistoryEntry = {
      ...entry,
      id: `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      resumeHash,
      checklistCompletedCount: 0,
    };

    const updatedEntries = [newEntry, ...history.entries].slice(0, MAX_HISTORY_ENTRIES);
    
    // Update best scores
    const newBestAts = Math.max(newEntry.atsScore, history.bestAtsScore || 0);
    const newBestFormat = !history.bestFormatGrade || 
      gradeRank(newEntry.formatGrade) > gradeRank(history.bestFormatGrade)
      ? newEntry.formatGrade
      : history.bestFormatGrade;
    
    const newHistory: ScanHistory = {
      ...history,
      entries: updatedEntries,
      firstScanAt: history.firstScanAt || newEntry.timestamp,
      lastScanAt: newEntry.timestamp,
      totalScans: history.totalScans + 1,
      bestAtsScore: newBestAts,
      bestFormatGrade: newBestFormat,
    };

    saveHistory(newHistory);
    console.log('[ScanHistory] Added scan entry', { 
      name: entry.candidateName,
      score: entry.atsScore, 
      total: newHistory.totalScans 
    });
    
    return newEntry;
  }, [history, saveHistory, isDuplicateScan]);

  // Update checklist for a specific entry
  const updateChecklist = useCallback((entryId: string, itemId: string, completed: boolean) => {
    const entryIndex = history.entries.findIndex(e => e.id === entryId);
    if (entryIndex === -1) return;
    
    const entry = history.entries[entryIndex];
    if (!entry.checklist) return;
    
    const updatedChecklist = entry.checklist.map(item =>
      item.id === itemId ? { ...item, completed } : item
    );
    
    const completedCount = updatedChecklist.filter(item => item.completed).length;
    
    const updatedEntries = [...history.entries];
    updatedEntries[entryIndex] = {
      ...entry,
      checklist: updatedChecklist,
      checklistCompletedCount: completedCount,
    };
    
    const newHistory: ScanHistory = {
      ...history,
      entries: updatedEntries,
    };
    
    saveHistory(newHistory);
    console.log('[ScanHistory] Updated checklist', { entryId, itemId, completed });
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

  // Get scan by candidate name (for returning users)
  const getScansByName = useCallback((name: string): ScanHistoryEntry[] => {
    if (!name) return [];
    const lowerName = name.toLowerCase();
    return history.entries.filter(e => 
      e.candidateName?.toLowerCase().includes(lowerName)
    );
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
    return history.bestAtsScore;
  }, [history.bestAtsScore]);

  // Get unique candidate names from history
  const uniqueCandidates = useMemo(() => {
    const names = new Map<string, ScanHistoryEntry[]>();
    
    history.entries.forEach(entry => {
      if (entry.candidateName) {
        const existing = names.get(entry.candidateName) || [];
        names.set(entry.candidateName, [...existing, entry]);
      }
    });
    
    return Array.from(names.entries()).map(([name, scans]) => ({
      name,
      scanCount: scans.length,
      latestScore: scans[0].atsScore,
      bestScore: Math.max(...scans.map(s => s.atsScore)),
      lastScanAt: scans[0].timestamp,
    }));
  }, [history.entries]);

  // Check if this is a returning user
  const isReturningUser = history.totalScans > 1 || history.entries.length > 0;

  return {
    history,
    isLoaded,
    isReturningUser,
    addScanEntry,
    updateChecklist,
    setUserEmail,
    clearHistory,
    getPreviousScan,
    getLatestScan,
    getScansByName,
    getScoreTrend,
    getAverageScore,
    getBestScore,
    uniqueCandidates,
    totalScans: history.totalScans,
    hasEmail: !!history.email,
    generateChecklist,
  };
};
