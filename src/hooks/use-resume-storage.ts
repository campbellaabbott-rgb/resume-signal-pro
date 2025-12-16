const RESUME_KEYS = ['resumeText', 'linkedInText'] as const;
const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

interface StoredItem {
  value: string;
  timestamp: number;
}

// Get all resume-related keys from localStorage
const getResumeKeys = (): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && RESUME_KEYS.some(rk => key === rk || key.startsWith(`${rk}:`))) {
      keys.push(key);
    }
  }
  return keys;
};

// Clean up expired items
export const cleanupExpiredResumeData = (): void => {
  const now = Date.now();
  const keys = getResumeKeys();
  
  keys.forEach(key => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      
      // Try to parse as timestamped item
      const parsed = JSON.parse(raw) as StoredItem;
      if (parsed.timestamp && now - parsed.timestamp > EXPIRY_MS) {
        localStorage.removeItem(key);
        console.log(`[Cleanup] Removed expired: ${key}`);
      }
    } catch {
      // Legacy format without timestamp - check if very old by removing after 30 min from now
      // We can't know when it was set, so we'll timestamp it now
      const value = localStorage.getItem(key);
      if (value) {
        setResumeData(key, value);
      }
    }
  });
};

// Remove all resume data
export const clearAllResumeData = (): void => {
  const keys = getResumeKeys();
  keys.forEach(key => {
    localStorage.removeItem(key);
  });
  console.log(`[Cleanup] Cleared ${keys.length} resume items`);
};

// Store data with timestamp
export const setResumeData = (key: string, value: string): void => {
  const item: StoredItem = {
    value,
    timestamp: Date.now()
  };
  localStorage.setItem(key, JSON.stringify(item));
};

// Get data (handles both legacy and timestamped formats)
export const getResumeData = (key: string): string | null => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  
  try {
    const parsed = JSON.parse(raw) as StoredItem;
    // Check if expired
    if (parsed.timestamp && Date.now() - parsed.timestamp > EXPIRY_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    // Legacy format - return as-is
    return raw;
  }
};

// Remove specific key
export const removeResumeData = (key: string): void => {
  localStorage.removeItem(key);
};

// Track if we're navigating to checkout (don't cleanup on unload)
let isCheckoutRedirect = false;

export const setCheckoutRedirect = (value: boolean): void => {
  isCheckoutRedirect = value;
};

// Setup page unload cleanup
export const setupUnloadCleanup = (): (() => void) => {
  const handleUnload = () => {
    if (!isCheckoutRedirect) {
      clearAllResumeData();
    }
  };
  
  window.addEventListener('beforeunload', handleUnload);
  
  return () => {
    window.removeEventListener('beforeunload', handleUnload);
  };
};
