// lib/db.ts — IndexedDB schema v2
// Key change: TrackMeta now stores a FileSystemFileHandle (where available).
// The handle survives page reload and can be used to re-obtain the File object,
// which lets us rebuild the audio blob URL without asking the user to re-add files.
//
// Schema upgraded from v1 → v2 (addedAt index preserved, fileHandle column added).

import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface TrackMeta {
  id:        string;                        // stable fingerprint (name+size+mtime hash)
  name:      string;                        // original filename
  title:     string;
  artist:    string;
  album:     string;
  duration:  number;                        // seconds
  coverUrl?: string;                        // ephemeral object URL — rebuilt each session
  coverData?: { data: number[]; format: string }; // persisted raw cover bytes for reload
  fileHandle?: FileSystemFileHandle;        // ← NEW: survives reload via IDB structured clone
  addedAt:   number;
}

interface AuraDB extends DBSchema {
  queue: {
    key: string;
    value: TrackMeta;
    indexes: { 'by-addedAt': number };
  };
  settings: {
    key: string;
    value: string | number | boolean;
  };
}

let dbPromise: Promise<IDBPDatabase<AuraDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AuraDB>('aura-music', 2, {
      upgrade(db, oldVersion) {
        // v1 → v2: add queue store if missing (handles fresh installs too)
        if (!db.objectStoreNames.contains('queue')) {
          const store = db.createObjectStore('queue', { keyPath: 'id' });
          store.createIndex('by-addedAt', 'addedAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        // No column migration needed — IDB is schemaless per record
      },
    });
  }
  return dbPromise;
}

export async function saveTrack(track: TrackMeta) {
  const db = await getDB();
  // Strip ephemeral coverUrl before persisting — we'll rebuild it from coverData
  const toStore: TrackMeta = { ...track, coverUrl: undefined };
  await db.put('queue', toStore);
}

export async function getAllTracks(): Promise<TrackMeta[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('queue', 'by-addedAt');
  return all.reverse(); // newest first
}

export async function removeTrack(id: string) {
  const db = await getDB();
  await db.delete('queue', id);
}

export async function clearQueue() {
  const db = await getDB();
  await db.clear('queue');
}

export async function saveSetting(key: string, value: string | number | boolean) {
  const db = await getDB();
  await db.put('settings', value, key);
}

export async function getSetting(key: string) {
  const db = await getDB();
  return db.get('settings', key);
}
