// lib/db.ts — LUMEN IndexedDB schema v3
// New in v3:
//  • `musicFolders` store — persists FileSystemDirectoryHandle objects for
//    root music folders the user has granted access to. These are reloaded
//    silently on every app start, no re-picking required.
//  • DB renamed from 'aura-music' to 'omp' (clean break from old installs)

import { openDB, DBSchema, IDBPDatabase } from "idb";

export interface TrackMeta {
  id: string;
  name: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl?: string;
  coverData?: { data: number[]; format: string };
  fileHandle?: FileSystemFileHandle;
  addedAt: number;
}

export interface SavedFolder {
  id: string; // random uuid assigned when saved
  name: string; // folder display name
  handle: FileSystemDirectoryHandle; // survives reload via IDB structured clone
  savedAt: number;
}

interface OmpDB extends DBSchema {
  queue: {
    key: string;
    value: TrackMeta;
    indexes: { "by-addedAt": number };
  };
  settings: {
    key: string;
    value: string | number | boolean;
  };
  musicFolders: {
    key: string;
    value: SavedFolder;
  };
}

let dbPromise: Promise<IDBPDatabase<OmpDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<OmpDB>("omp", 3, {
      upgrade(db, oldVersion) {
        // Fresh install or upgrade from any old version
        if (!db.objectStoreNames.contains("queue")) {
          const s = db.createObjectStore("queue", { keyPath: "id" });
          s.createIndex("by-addedAt", "addedAt");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings");
        }
        // v3: folder handles store
        if (!db.objectStoreNames.contains("musicFolders")) {
          db.createObjectStore("musicFolders", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

/* ── Queue ──────────────────────────────────────────────────────────── */
export async function saveTrack(track: TrackMeta) {
  const db = await getDB();
  await db.put("queue", { ...track, coverUrl: undefined });
}

export async function getAllTracks(): Promise<TrackMeta[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("queue", "by-addedAt");
  return all.reverse();
}

export async function removeTrack(id: string) {
  const db = await getDB();
  await db.delete("queue", id);
}

export async function clearQueue() {
  const db = await getDB();
  await db.clear("queue");
}

/* ── Music folder handles ────────────────────────────────────────────── */
export async function saveMusicFolder(
  handle: FileSystemDirectoryHandle,
): Promise<string> {
  const db = await getDB();
  const id = crypto.randomUUID();
  const rec: SavedFolder = {
    id,
    name: handle.name,
    handle,
    savedAt: Date.now(),
  };
  await db.put("musicFolders", rec);
  return id;
}

export async function getAllMusicFolders(): Promise<SavedFolder[]> {
  const db = await getDB();
  return db.getAll("musicFolders");
}

export async function removeMusicFolder(id: string) {
  const db = await getDB();
  await db.delete("musicFolders", id);
}

/* ── Settings ────────────────────────────────────────────────────────── */
export async function saveSetting(
  key: string,
  value: string | number | boolean,
) {
  const db = await getDB();
  await db.put("settings", value, key);
}

export async function getSetting(key: string) {
  const db = await getDB();
  return db.get("settings", key);
}
