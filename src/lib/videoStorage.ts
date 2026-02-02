/**
 * IndexedDB-based storage for processed video blobs.
 * This persists videos across page refreshes so users don't lose their work.
 */

const DB_NAME = 'VideoTemplateProDB';
const DB_VERSION = 1;
const STORE_NAME = 'processedVideos';

interface StoredVideo {
  id: string;
  name: string;
  blob: Blob;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[VideoStorage] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });

  return dbPromise;
}

/**
 * Save a processed video blob to IndexedDB
 */
export async function saveProcessedVideo(id: string, name: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const video: StoredVideo = {
      id,
      name,
      blob,
      createdAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(video);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('[VideoStorage] Saved video:', id);
  } catch (error) {
    console.error('[VideoStorage] Failed to save video:', error);
  }
}

/**
 * Get a processed video blob from IndexedDB
 */
export async function getProcessedVideo(id: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const result = request.result as StoredVideo | undefined;
        resolve(result?.blob ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[VideoStorage] Failed to get video:', error);
    return null;
  }
}

/**
 * Get all stored video IDs with their names
 */
export async function getAllStoredVideoIds(): Promise<{ id: string; name: string; createdAt: number }[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result as StoredVideo[];
        resolve(results.map(v => ({ id: v.id, name: v.name, createdAt: v.createdAt })));
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[VideoStorage] Failed to get all videos:', error);
    return [];
  }
}

/**
 * Delete a processed video from IndexedDB
 */
export async function deleteProcessedVideo(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('[VideoStorage] Deleted video:', id);
  } catch (error) {
    console.error('[VideoStorage] Failed to delete video:', error);
  }
}

/**
 * Clear all stored videos (e.g., when user clears their work)
 */
export async function clearAllProcessedVideos(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('[VideoStorage] Cleared all videos');
  } catch (error) {
    console.error('[VideoStorage] Failed to clear videos:', error);
  }
}

/**
 * Clean up old videos (older than 24 hours) to prevent storage bloat
 */
export async function cleanupOldVideos(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const request = index.openCursor(IDBKeyRange.upperBound(oneDayAgo));
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  } catch (error) {
    console.error('[VideoStorage] Failed to cleanup old videos:', error);
  }
}
