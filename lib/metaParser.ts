// lib/metaParser.ts — Zero-dependency browser-native ID3/MP4/Ogg/FLAC tag parser
//
// Replaces music-metadata-browser (which has a broken peer dep on music-metadata).
// Parses tags directly from ArrayBuffer using DataView — works in any modern browser.
//
// Supported formats:
//   • ID3v2.2 / ID3v2.3 / ID3v2.4  (MP3, most common)
//   • ID3v1                          (MP3 legacy fallback)
//   • MP4 / M4A atoms               (iTunes-style tags: ©nam, ©ART, covr)
//   • Ogg Vorbis comment             (OGG, FLAC in Ogg container)
//   • FLAC Vorbis comment block      (native FLAC)
//
// Cover art:
//   • ID3v2  APIC frame → raw bytes + mime stored as coverData
//   • MP4    covr atom  → raw bytes + mime stored as coverData
//   • Ogg/FLAC METADATA_BLOCK_PICTURE → raw bytes + mime stored as coverData

import { TrackMeta } from "./db";

/* ── Stable file fingerprint ─────────────────────────────────────────────── */
function fileId(file: File): string {
  const raw = `${file.name}-${file.size}-${file.lastModified}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++)
    h = (Math.imul(31, h) + raw.charCodeAt(i)) >>> 0;
  return `${h.toString(16).padStart(8, "0")}-${file.size.toString(16)}`;
}

/* ── Audio duration via HTMLAudioElement (always available) ──────────────── */
function getDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      resolve(audio.duration || 0);
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => {
      resolve(0);
      URL.revokeObjectURL(url);
    };
    audio.src = url;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════════════════════ */

export interface ParsedMeta {
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl?: string;
  coverData?: { data: number[]; format: string };
}

/**
 * Parse metadata from a File object.
 * Accepts an optional FileSystemFileHandle for post-reload recovery.
 */
export async function parseFileMeta(
  file: File,
  handle?: FileSystemFileHandle,
): Promise<TrackMeta> {
  const id = fileId(file);
  const baseName = stripExtension(file.name);

  const fallback: TrackMeta = {
    id,
    name: file.name,
    title: baseName,
    artist: "Unknown Artist",
    album: "Unknown Album",
    duration: 0,
    fileHandle: handle,
    addedAt: Date.now(),
  };

  try {
    // Read only the first 512 KB — enough for all tag headers + cover art
    // (large covers are truncated gracefully; we still get text tags)
    const CHUNK = Math.min(file.size, 512 * 1024);
    const buf = await file.slice(0, CHUNK).arrayBuffer();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

    let parsed: ParsedMeta | null = null;

    if (
      ext === "mp3" ||
      file.type === "audio/mpeg" ||
      file.type === "audio/mp3"
    ) {
      parsed = parseID3(buf) ?? parseID3v1(buf);
    } else if (
      ext === "m4a" ||
      ext === "mp4" ||
      ext === "aac" ||
      file.type.includes("mp4") ||
      file.type.includes("m4a")
    ) {
      parsed = parseMP4(buf);
    } else if (ext === "ogg" || file.type.includes("ogg")) {
      parsed = parseOgg(buf);
    } else if (ext === "flac" || file.type === "audio/flac") {
      parsed = parseFLAC(buf);
    } else {
      // Sniff by magic bytes
      const u8 = new Uint8Array(buf, 0, 12);
      if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33)
        parsed = parseID3(buf);
      else if (
        u8[4] === 0x66 &&
        u8[5] === 0x74 &&
        u8[6] === 0x79 &&
        u8[7] === 0x70
      )
        parsed = parseMP4(buf);
      else if (u8[0] === 0x4f && u8[1] === 0x67 && u8[2] === 0x67)
        parsed = parseOgg(buf);
      else if (
        u8[0] === 0x66 &&
        u8[1] === 0x4c &&
        u8[2] === 0x61 &&
        u8[3] === 0x43
      )
        parsed = parseFLAC(buf);
      else parsed = parseID3(buf) ?? parseID3v1(buf);
    }

    // Duration via audio element (most reliable cross-format)
    const duration = await getDuration(file);

    const title = parsed?.title || baseName;
    const artist = parsed?.artist || "Unknown Artist";
    const album = parsed?.album || "Unknown Album";

    // Build cover object URL for in-session display
    let coverUrl: string | undefined;
    let coverData: TrackMeta["coverData"];
    if (parsed?.coverData) {
      coverData = parsed.coverData;
      const bytes = new Uint8Array(coverData.data);
      const blob = new Blob([bytes], { type: coverData.format });
      coverUrl = URL.createObjectURL(blob);
    }

    return {
      id,
      name: file.name,
      title,
      artist,
      album,
      duration,
      coverUrl,
      coverData,
      fileHandle: handle,
      addedAt: Date.now(),
    };
  } catch {
    // Still try to get duration even on parse failure
    try {
      fallback.duration = await getDuration(file);
    } catch {
      /* ignore */
    }
    return fallback;
  }
}

/** Rebuild coverUrl from persisted coverData bytes (called on reload) */
export function rebuildCoverUrl(track: TrackMeta): string | undefined {
  if (!track.coverData) return undefined;
  try {
    const bytes = new Uint8Array(track.coverData.data);
    const blob = new Blob([bytes], { type: track.coverData.format });
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ID3v2 PARSER  (covers v2.2, v2.3, v2.4)
══════════════════════════════════════════════════════════════════════════ */

function parseID3(buf: ArrayBuffer): ParsedMeta | null {
  const v = new DataView(buf);
  const u = new Uint8Array(buf);

  // Magic: "ID3"
  if (u[0] !== 0x49 || u[1] !== 0x44 || u[2] !== 0x33) return null;

  const ver = u[3]; // 2, 3, or 4
  const flags = u[5];
  const hasExt = !!(flags & 0x40);

  // Syncsafe tag size
  const tagSize =
    ((u[6] & 0x7f) << 21) |
    ((u[7] & 0x7f) << 14) |
    ((u[8] & 0x7f) << 7) |
    (u[9] & 0x7f);

  let pos = 10;
  if (hasExt) {
    // Skip extended header
    const extSize =
      ver === 4
        ? ((v.getUint8(pos) & 0x7f) << 21) |
          ((v.getUint8(pos + 1) & 0x7f) << 14) |
          ((v.getUint8(pos + 2) & 0x7f) << 7) |
          (v.getUint8(pos + 3) & 0x7f)
        : v.getUint32(pos);
    pos += extSize;
  }

  const end = Math.min(10 + tagSize, buf.byteLength);

  const result: ParsedMeta = { title: "", artist: "", album: "", duration: 0 };

  while (pos + 10 <= end) {
    // Frame ID: 4 bytes (v2.3/2.4) or 3 bytes (v2.2)
    const isV22 = ver === 2;
    const idLen = isV22 ? 3 : 4;
    const sizeLen = isV22 ? 3 : 4;

    // Read frame ID
    let frameId = "";
    for (let i = 0; i < idLen; i++) {
      const c = u[pos + i];
      if (c === 0) break;
      frameId += String.fromCharCode(c);
    }
    if (!frameId || frameId[0] === "\0") break;

    // Frame size
    let frameSize = 0;
    if (isV22) {
      frameSize = (u[pos + 3] << 16) | (u[pos + 4] << 8) | u[pos + 5];
      pos += 6;
    } else {
      frameSize =
        ver === 4
          ? ((u[pos + 4] & 0x7f) << 21) |
            ((u[pos + 5] & 0x7f) << 14) |
            ((u[pos + 6] & 0x7f) << 7) |
            (u[pos + 7] & 0x7f)
          : v.getUint32(pos + 4);
      pos += 10; // ID(4) + size(4) + flags(2)
    }

    if (frameSize <= 0 || pos + frameSize > end) break;

    const frameData = buf.slice(pos, pos + frameSize);
    pos += frameSize;

    // Map both v2.2 (3-char) and v2.3/4 (4-char) frame IDs
    const id3Key = normaliseFrameId(frameId, isV22);

    switch (id3Key) {
      case "TIT2":
        result.title = decodeTextFrame(frameData);
        break;
      case "TPE1":
        result.artist = decodeTextFrame(frameData);
        break;
      case "TALB":
        result.album = decodeTextFrame(frameData);
        break;
      case "APIC": {
        const cd = decodeAPIC(frameData);
        if (cd) result.coverData = cd;
        break;
      }
    }
  }

  return result.title || result.artist ? result : null;
}

/** Map v2.2 3-char IDs to v2.3 equivalents */
function normaliseFrameId(id: string, isV22: boolean): string {
  if (!isV22) return id;
  const map: Record<string, string> = {
    TT2: "TIT2",
    TP1: "TPE1",
    TAL: "TALB",
    PIC: "APIC",
  };
  return map[id] ?? id;
}

function decodeTextFrame(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  if (u.length < 1) return "";
  const enc = u[0]; // 0=latin1, 1=utf16bom, 2=utf16be, 3=utf8
  const data = buf.slice(1);
  try {
    if (enc === 0 || enc === 3)
      return new TextDecoder("utf-8").decode(data).replace(/\0/g, "").trim();
    if (enc === 1)
      return new TextDecoder("utf-16").decode(data).replace(/\0/g, "").trim();
    if (enc === 2)
      return new TextDecoder("utf-16be").decode(data).replace(/\0/g, "").trim();
  } catch {
    /* fall through */
  }
  return String.fromCharCode(...Array.from(u.slice(1)))
    .replace(/\0/g, "")
    .trim();
}

function decodeAPIC(buf: ArrayBuffer): TrackMeta["coverData"] | undefined {
  const u = new Uint8Array(buf);
  if (u.length < 4) return;
  // encoding(1) + mime(null-terminated) + pictureType(1) + description(null-terminated) + data
  let pos = 1; // skip encoding byte
  let mimeEnd = pos;
  while (mimeEnd < u.length && u[mimeEnd] !== 0) mimeEnd++;
  const mime = new TextDecoder().decode(u.slice(pos, mimeEnd)) || "image/jpeg";
  pos = mimeEnd + 1 + 1; // skip null + picture type byte
  // skip description (null-terminated, possibly UTF-16 with double null)
  const enc = u[0];
  if (enc === 1 || enc === 2) {
    while (pos + 1 < u.length && !(u[pos] === 0 && u[pos + 1] === 0)) pos += 2;
    pos += 2;
  } else {
    while (pos < u.length && u[pos] !== 0) pos++;
    pos++;
  }
  if (pos >= u.length) return;
  return { data: Array.from(u.slice(pos)), format: mime };
}

/* ── ID3v1 fallback ──────────────────────────────────────────────────────── */
function parseID3v1(buf: ArrayBuffer): ParsedMeta | null {
  if (buf.byteLength < 128) return null;
  const u = new Uint8Array(buf, buf.byteLength - 128, 128);
  if (u[0] !== 0x54 || u[1] !== 0x41 || u[2] !== 0x47) return null; // "TAG"
  const dec = (start: number, len: number) =>
    new TextDecoder("latin1")
      .decode(u.slice(start, start + len))
      .replace(/\0/g, "")
      .trim();
  return {
    title: dec(3, 30),
    artist: dec(33, 30),
    album: dec(63, 30),
    duration: 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   MP4 / M4A ATOM PARSER
══════════════════════════════════════════════════════════════════════════ */

function parseMP4(buf: ArrayBuffer): ParsedMeta | null {
  const result: ParsedMeta = { title: "", artist: "", album: "", duration: 0 };
  try {
    // Walk top-level atoms looking for moov → udta → meta → ilst
    const ilst = findAtom(buf, 0, buf.byteLength, [
      "moov",
      "udta",
      "meta",
      "ilst",
    ]);
    if (!ilst) return null;

    // Walk ilst children
    let pos = ilst.dataStart;
    while (pos + 8 <= ilst.end) {
      const size = new DataView(buf, pos, 4).getUint32(0);
      if (size < 8 || pos + size > ilst.end) break;
      const name = String.fromCharCode(
        ...Array.from(new Uint8Array(buf, pos + 4, 4)),
      );
      // data atom is at pos+8; it has 8-byte header (size+type) then 8 bytes flags, then content
      const dataOffset = pos + 8;
      if (dataOffset + 16 <= ilst.end) {
        const dataSize = new DataView(buf, dataOffset, 4).getUint32(0);
        const content = buf.slice(dataOffset + 16, dataOffset + dataSize);
        switch (name) {
          case "\xa9nam":
            result.title = new TextDecoder().decode(content).trim();
            break;
          case "\xa9ART":
            result.artist = new TextDecoder().decode(content).trim();
            break;
          case "\xa9alb":
            result.album = new TextDecoder().decode(content).trim();
            break;
          case "covr": {
            // flags at dataOffset+8 (4 bytes): 13=jpeg, 14=png
            const flags = new DataView(buf, dataOffset + 8, 4).getUint32(0);
            const mime = flags === 14 ? "image/png" : "image/jpeg";
            result.coverData = {
              data: Array.from(new Uint8Array(content)),
              format: mime,
            };
            break;
          }
        }
      }
      pos += size;
    }
    return result.title || result.artist ? result : null;
  } catch {
    return null;
  }
}

interface Atom {
  dataStart: number;
  end: number;
}

function findAtom(
  buf: ArrayBuffer,
  start: number,
  end: number,
  path: string[],
): Atom | null {
  let pos = start;
  const target = path[0];
  while (pos + 8 <= end) {
    const size = new DataView(buf, pos, 4).getUint32(0);
    const name = String.fromCharCode(
      ...Array.from(new Uint8Array(buf, pos + 4, 4)),
    );
    if (size < 8 || pos + size > end) break;
    if (name === target) {
      if (path.length === 1) return { dataStart: pos + 8, end: pos + size };
      // Containers: moov/udta/meta have extra 4 bytes for "version+flags" before children
      const childStart = pos + 8 + (name === "meta" ? 4 : 0);
      return findAtom(buf, childStart, pos + size, path.slice(1));
    }
    pos += size;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   OGG VORBIS COMMENT PARSER
══════════════════════════════════════════════════════════════════════════ */

function parseOgg(buf: ArrayBuffer): ParsedMeta | null {
  // Find first Ogg page with Vorbis comment header (packet type 0x03)
  const u = new Uint8Array(buf);
  let pos = 0;
  while (pos + 27 < u.length) {
    // OggS page magic
    if (
      u[pos] !== 0x4f ||
      u[pos + 1] !== 0x67 ||
      u[pos + 2] !== 0x67 ||
      u[pos + 3] !== 0x53
    ) {
      pos++;
      continue;
    }
    const numSegs = u[pos + 26];
    const segsStart = pos + 27;
    const dataOffset = segsStart + numSegs;
    let pageSize = 0;
    for (let i = 0; i < numSegs; i++) pageSize += u[segsStart + i];

    const packetStart = dataOffset;
    // Vorbis comment packet starts with 0x03 + "vorbis"
    if (u[packetStart] === 0x03) {
      return parseVorbisComment(buf, packetStart + 7); // skip 0x03 + "vorbis"
    }
    pos = dataOffset + pageSize;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   FLAC METADATA BLOCK PARSER
══════════════════════════════════════════════════════════════════════════ */

function parseFLAC(buf: ArrayBuffer): ParsedMeta | null {
  const u = new Uint8Array(buf);
  // fLaC magic
  if (u[0] !== 0x66 || u[1] !== 0x4c || u[2] !== 0x61 || u[3] !== 0x43)
    return null;

  const result: ParsedMeta = { title: "", artist: "", album: "", duration: 0 };
  let pos = 4;
  let last = false;

  while (!last && pos + 4 <= u.length) {
    const header = u[pos];
    last = !!(header & 0x80);
    const blockType = header & 0x7f;
    const blockSize = (u[pos + 1] << 16) | (u[pos + 2] << 8) | u[pos + 3];
    pos += 4;
    if (pos + blockSize > u.length) break;

    if (blockType === 4) {
      // VORBIS_COMMENT block
      const vc = parseVorbisComment(buf, pos);
      if (vc) {
        result.title = vc.title || result.title;
        result.artist = vc.artist || result.artist;
        result.album = vc.album || result.album;
        result.coverData = vc.coverData ?? result.coverData;
      }
    } else if (blockType === 6) {
      // PICTURE block
      const cd = parseFLACPicture(buf, pos, blockSize);
      if (cd) result.coverData = cd;
    }
    pos += blockSize;
  }
  return result.title || result.artist ? result : null;
}

function parseFLACPicture(
  buf: ArrayBuffer,
  offset: number,
  size: number,
): TrackMeta["coverData"] | undefined {
  try {
    const v = new DataView(buf, offset, size);
    /* pictureType */ v.getUint32(0);
    const mimeLen = v.getUint32(4);
    const mime = new TextDecoder().decode(
      new Uint8Array(buf, offset + 8, mimeLen),
    );
    const descLen = v.getUint32(8 + mimeLen);
    const imgOffset = 8 + mimeLen + 4 + descLen + 16; // past desc + width/height/depth/colors
    const imgLen = v.getUint32(8 + mimeLen + 4 + descLen + 16 - 4);
    const data = Array.from(new Uint8Array(buf, offset + imgOffset, imgLen));
    return { data, format: mime || "image/jpeg" };
  } catch {
    return undefined;
  }
}

/* ── Shared Vorbis comment parser (used by Ogg + FLAC) ────────────────── */
function parseVorbisComment(
  buf: ArrayBuffer,
  offset: number,
): ParsedMeta | null {
  try {
    const v = new DataView(buf, offset);
    const u = new Uint8Array(buf, offset);
    // vendor string length (skip it)
    const vLen = v.getUint32(0, true);
    let pos = 4 + vLen;
    const nComments = v.getUint32(pos, true);
    pos += 4;

    const result: ParsedMeta = {
      title: "",
      artist: "",
      album: "",
      duration: 0,
    };

    for (let i = 0; i < nComments && pos + 4 <= u.length; i++) {
      const cLen = v.getUint32(pos, true);
      pos += 4;
      if (pos + cLen > u.length) break;
      const comment = new TextDecoder().decode(u.slice(pos, pos + cLen));
      pos += cLen;
      const eq = comment.indexOf("=");
      if (eq < 0) continue;
      const key = comment.slice(0, eq).toUpperCase();
      const val = comment.slice(eq + 1).trim();
      if (key === "TITLE") result.title = val;
      if (key === "ARTIST") result.artist = val;
      if (key === "ALBUM") result.album = val;
      if (key === "METADATA_BLOCK_PICTURE") {
        try {
          const binStr = atob(val);
          const bytes = new Uint8Array(binStr.length);
          for (let j = 0; j < binStr.length; j++)
            bytes[j] = binStr.charCodeAt(j);
          const dv = new DataView(bytes.buffer);
          const mimeLen = dv.getUint32(4);
          const mime = new TextDecoder().decode(bytes.slice(8, 8 + mimeLen));
          const descLen = dv.getUint32(8 + mimeLen);
          const imgStart = 8 + mimeLen + 4 + descLen + 16;
          result.coverData = {
            data: Array.from(bytes.slice(imgStart)),
            format: mime || "image/jpeg",
          };
        } catch {
          /* skip bad picture block */
        }
      }
    }
    return result.title || result.artist ? result : null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════════════════════ */

export function stripExtension(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim();
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function isAudioFile(file: File) {
  return (
    file.type.startsWith("audio/") ||
    /\.(mp3|ogg|wav|flac|aac|m4a|opus|wma|aiff|aif)$/i.test(file.name)
  );
}
