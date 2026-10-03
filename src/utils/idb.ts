/**
 * IndexedDB storage engine for Hermes Agent Mobile Client
 * Persists conversations and local run records reliably across sessions.
 * Surfaces storage errors to UI handlers.
 */

import { Conversation, LocalAgentRunRecord } from '../types/hermes';

const DB_NAME = 'HermesAgentDB';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
let storageErrorListener: ((err: string) => void) | null = null;

export function setStorageErrorListener(listener: (err: string) => void) {
  storageErrorListener = listener;
}

function notifyStorageError(action: string, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`IndexedDB Error [${action}]:`, msg);
  if (storageErrorListener) {
    storageErrorListener(`Storage Error (${action}): ${msg}`);
  }
}

export function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      const err = new Error('IndexedDB is not supported in this browser environment');
      notifyStorageError('init', err);
      return reject(err);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Store: conversations
      if (!db.objectStoreNames.contains('conversations')) {
        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('profileId', 'profileId', { unique: false });
        convStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Store: runs (local list of run_ids and status, since GET /v1/runs is not documented)
      if (!db.objectStoreNames.contains('runs')) {
        const runStore = db.createObjectStore('runs', { keyPath: 'runId' });
        runStore.createIndex('profileId', 'profileId', { unique: false });
        runStore.createIndex('createdAt', 'createdAt', { unique: false });
        runStore.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      notifyStorageError('open', request.error);
      reject(request.error);
    };
  });

  return dbPromise;
}

// ----------------- Conversations -----------------

export async function idbGetConversations(): Promise<Conversation[]> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const request = store.getAll();

      request.onsuccess = () => {
        const list = (request.result as Conversation[]) || [];
        // sort descending by updatedAt
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(list);
      };

      request.onerror = () => {
        notifyStorageError('getConversations', request.error);
        resolve([]);
      };
    });
  } catch (err) {
    notifyStorageError('getConversations', err);
    return [];
  }
}

export async function idbSaveConversation(conv: Conversation): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      const request = store.put(conv);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        notifyStorageError('saveConversation', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    notifyStorageError('saveConversation', err);
  }
}

export async function idbDeleteConversation(id: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        notifyStorageError('deleteConversation', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    notifyStorageError('deleteConversation', err);
  }
}

// ----------------- Local Runs Registry -----------------

export async function idbGetLocalRuns(profileId?: string): Promise<LocalAgentRunRecord[]> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction('runs', 'readonly');
      const store = tx.objectStore('runs');
      const request = store.getAll();

      request.onsuccess = () => {
        let list = (request.result as LocalAgentRunRecord[]) || [];
        if (profileId) {
          list = list.filter((r) => r.profileId === profileId);
        }
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(list);
      };

      request.onerror = () => {
        notifyStorageError('getLocalRuns', request.error);
        resolve([]);
      };
    });
  } catch (err) {
    notifyStorageError('getLocalRuns', err);
    return [];
  }
}

export async function idbSaveLocalRun(run: LocalAgentRunRecord): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('runs', 'readwrite');
      const store = tx.objectStore('runs');
      const request = store.put(run);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        notifyStorageError('saveLocalRun', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    notifyStorageError('saveLocalRun', err);
  }
}

export async function idbDeleteLocalRun(runId: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('runs', 'readwrite');
      const store = tx.objectStore('runs');
      const request = store.delete(runId);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        notifyStorageError('deleteLocalRun', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    notifyStorageError('deleteLocalRun', err);
  }
}

export async function idbClearAll(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(['conversations', 'runs'], 'readwrite');
      tx.objectStore('conversations').clear();
      tx.objectStore('runs').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    notifyStorageError('clearAll', err);
  }
}
