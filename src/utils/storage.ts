import { AppSettings, Conversation, DebugLogEntry, HermesServerProfile, LocalAgentRunRecord } from '../types/hermes';
import {
  idbClearAll,
  idbDeleteConversation,
  idbDeleteLocalRun,
  idbGetConversations,
  idbGetLocalRuns,
  idbSaveConversation,
  idbSaveLocalRun,
  setStorageErrorListener,
} from './idb';

const STORAGE_KEYS = {
  PROFILES: 'hermes_profiles',
  ACTIVE_PROFILE_ID: 'hermes_active_profile_id',
  SETTINGS: 'hermes_app_settings',
  ACTIVE_CONVERSATION_ID: 'hermes_active_conv_id',
  DRAFTS: 'hermes_chat_drafts',
  DEBUG_LOGS: 'hermes_debug_logs',
};

const DEFAULT_SETTINGS: AppSettings = {
  activeProfileId: null,
  language: 'fa',
  fontSize: 'md',
  useResponsesApi: false,
  heartbeatIntervalSec: 20,
  systemPromptAddition: '',
};

// URL Normalizer
export function normalizeBaseUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  return url;
}

// Storage listeners
export function subscribeToStorageErrors(callback: (err: string) => void) {
  setStorageErrorListener(callback);
}

// Profiles
export function loadProfiles(): HermesServerProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROFILES);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load profiles from localStorage', err);
    return [];
  }
}

export function saveProfiles(profiles: HermesServerProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(profiles));
  } catch (err) {
    console.error('Failed to save profiles to localStorage', err);
  }
}

export function loadActiveProfileId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_PROFILE_ID);
  } catch {
    return null;
  }
}

export function saveActiveProfileId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_PROFILE_ID);
    }
  } catch (err) {
    console.error('Failed to save active profile id', err);
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save settings', err);
  }
}

// ----------------- IndexedDB Conversations & Runs -----------------

export {
  idbGetConversations,
  idbSaveConversation,
  idbDeleteConversation,
  idbGetLocalRuns,
  idbSaveLocalRun,
  idbDeleteLocalRun,
};

export function loadActiveConversationId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_CONVERSATION_ID);
  } catch {
    return null;
  }
}

export function saveActiveConversationId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_CONVERSATION_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONVERSATION_ID);
    }
  } catch (err) {
    console.error('Failed to save active conversation id', err);
  }
}

export function loadDraft(convId: string): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DRAFTS);
    if (!raw) return '';
    const drafts = JSON.parse(raw);
    return drafts[convId] || '';
  } catch {
    return '';
  }
}

export function saveDraft(convId: string, text: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DRAFTS);
    const drafts = raw ? JSON.parse(raw) : {};
    if (text) {
      drafts[convId] = text;
    } else {
      delete drafts[convId];
    }
    localStorage.setItem(STORAGE_KEYS.DRAFTS, JSON.stringify(drafts));
  } catch (err) {
    console.error('Failed to save draft', err);
  }
}

// Circular debug logs buffer (max 50)
export function loadDebugLogs(): DebugLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DEBUG_LOGS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function appendDebugLog(entry: DebugLogEntry): DebugLogEntry[] {
  try {
    const existing = loadDebugLogs();
    const updated = [entry, ...existing].slice(0, 50);
    localStorage.setItem(STORAGE_KEYS.DEBUG_LOGS, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function clearDebugLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.DEBUG_LOGS);
  } catch (err) {
    console.error('Failed to clear debug logs', err);
  }
}

// Export / Import
export async function exportAppData(): Promise<string> {
  const convs = await idbGetConversations();
  const runs = await idbGetLocalRuns();
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    profiles: loadProfiles(),
    activeProfileId: loadActiveProfileId(),
    settings: loadSettings(),
    conversations: convs,
    runs,
  };
  return JSON.stringify(data, null, 2);
}

export async function importAppData(jsonString: string): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'Invalid JSON format' };
    }
    if (Array.isArray(parsed.profiles)) {
      saveProfiles(parsed.profiles);
    }
    if (parsed.activeProfileId !== undefined) {
      saveActiveProfileId(parsed.activeProfileId);
    }
    if (parsed.settings && typeof parsed.settings === 'object') {
      saveSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
    }
    if (Array.isArray(parsed.conversations)) {
      for (const c of parsed.conversations) {
        await idbSaveConversation(c);
      }
    }
    if (Array.isArray(parsed.runs)) {
      for (const r of parsed.runs) {
        await idbSaveLocalRun(r);
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error during import' };
  }
}

// "Forget everything"
export async function forgetEverything(): Promise<void> {
  try {
    localStorage.clear();
    await idbClearAll();
  } catch (err) {
    console.error('Failed to clear storage', err);
  }
}
