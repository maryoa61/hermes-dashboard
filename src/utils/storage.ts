import { AppSettings, Conversation, DebugLogEntry, HermesServerProfile } from '../types/hermes';

const STORAGE_KEYS = {
  PROFILES: 'hermes_profiles',
  ACTIVE_PROFILE_ID: 'hermes_active_profile_id',
  SETTINGS: 'hermes_app_settings',
  CONVERSATIONS: 'hermes_conversations',
  ACTIVE_CONVERSATION_ID: 'hermes_active_conv_id',
  DRAFTS: 'hermes_chat_drafts',
  DEBUG_LOGS: 'hermes_debug_logs',
};

const DEFAULT_SETTINGS: AppSettings = {
  activeProfileId: null,
  language: 'fa', // Primary requested language with RTL support
  fontSize: 'md',
  useResponsesApi: false,
  heartbeatIntervalSec: 20,
  systemPromptAddition: '',
};

// URL Normalizer: removes trailing slash, cleans whitespace
export function normalizeBaseUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  return url;
}

// Storage helpers
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

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveConversations(convs: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(convs));
  } catch (err) {
    console.error('Failed to save conversations', err);
  }
}

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
export function exportAppData(): string {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: loadProfiles(),
    activeProfileId: loadActiveProfileId(),
    settings: loadSettings(),
    conversations: loadConversations(),
  };
  return JSON.stringify(data, null, 2);
}

export function importAppData(jsonString: string): { success: boolean; error?: string } {
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
      saveConversations(parsed.conversations);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error during import' };
  }
}

// "Forget everything"
export function forgetEverything(): void {
  try {
    localStorage.clear();
  } catch (err) {
    console.error('Failed to clear storage', err);
  }
}
