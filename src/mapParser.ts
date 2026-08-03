/**
 * Pure parsing helpers for MOVA map payloads.
 *
 * MOVA maps may be plain JSON, base64-encoded JSON, or nested zlib/base64
 * payloads containing a `seg_inf` object.
 *
 * @file mapParser.ts
 * @license Apache-2.0
 */

import { inflateSync } from 'node:zlib';

import type { RoomInfo } from './types.js';

const ROOM_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'Room',
  1: 'Living Room',
  2: 'Primary Bedroom',
  3: 'Study',
  4: 'Kitchen',
  5: 'Dining Hall',
  6: 'Bathroom',
  7: 'Balcony',
  8: 'Corridor',
  9: 'Utility Room',
  10: 'Closet',
  11: 'Meeting Room',
  12: 'Office',
  13: 'Fitness Area',
  14: 'Recreation Area',
  15: 'Secondary Bedroom',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function findContainingJson(source: string, property: string): Record<string, unknown> | null {
  const propertyIndex = source.indexOf(`"${property}"`);
  if (propertyIndex === -1) return null;

  for (let start = propertyIndex; start >= 0; start--) {
    if (source[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < source.length; end++) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (source[end] === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (source[end] === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
      if (depth !== 0) continue;

      const candidate = source.slice(start, end + 1);
      if (candidate.length >= 50_000 || !candidate.includes(`"${property}"`)) break;

      const parsed = parseJsonRecord(candidate);
      if (parsed) return parsed;
      break;
    }
  }

  return null;
}

function decodeMapPayload(mapData: unknown): Record<string, unknown> | null {
  if (isRecord(mapData)) return mapData;
  if (typeof mapData !== 'string' || mapData.length === 0) return null;

  const json = parseJsonRecord(mapData);
  if (json) return json;

  try {
    const decoded = Buffer.from(mapData, 'base64');
    if (decoded.length === 0) return null;

    if (decoded[0] !== 0x78) {
      return parseJsonRecord(decoded.toString('utf-8'));
    }

    const decompressed = inflateSync(decoded);
    const directJson = parseJsonRecord(decompressed.toString('utf-8'));
    if (directJson) return directJson;
    const searchStart = Math.max(0, decompressed.length - 50_000);
    return findContainingJson(decompressed.subarray(searchStart).toString('latin1'), 'rism');
  } catch {
    return null;
  }
}

function decodeRismPayload(rism: unknown): Record<string, unknown> | null {
  if (typeof rism !== 'string' || rism.length === 0) return null;

  try {
    const standardBase64 = rism.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(standardBase64, 'base64');
    if (decoded.length === 0) return null;

    if (decoded[0] !== 0x78) {
      return parseJsonRecord(decoded.toString('utf-8'));
    }

    const decompressed = inflateSync(decoded).toString('utf-8');
    const json = parseJsonRecord(decompressed);
    if (json) return json;

    const containingObject = findContainingJson(decompressed, 'seg_inf');
    return containingObject?.seg_inf ? containingObject : null;
  } catch {
    return null;
  }
}

function parseSegmentInfo(value: unknown): RoomInfo[] {
  if (!isRecord(value)) return [];

  const rooms: RoomInfo[] = [];
  const typeCounters = new Map<number, number>();

  for (const [segmentId, segmentValue] of Object.entries(value)) {
    const id = Number.parseInt(segmentId, 10);
    if (!Number.isInteger(id) || !isRecord(segmentValue)) continue;

    const roomType = typeof segmentValue.type === 'number' ? segmentValue.type : 0;
    let name: string | undefined;

    if (typeof segmentValue.name === 'string' && segmentValue.name.length > 0) {
      const decoded = Buffer.from(segmentValue.name, 'base64').toString('utf-8').trim();
      if (decoded.length > 0) name = decoded;
    }

    if (!name) {
      const count = (typeCounters.get(roomType) ?? 0) + 1;
      typeCounters.set(roomType, count);
      const typeName = ROOM_TYPE_NAMES[roomType] ?? 'Room';
      name = count === 1 ? typeName : `${typeName} ${count}`;
    }

    rooms.push({ id, name, floorId: roomType });
  }

  return rooms;
}

/** Parse room definitions from any supported MOVA map representation. */
export function parseRoomsFromMapData(mapData: unknown): RoomInfo[] {
  const parsed = decodeMapPayload(mapData);
  if (!parsed) return [];

  if (parsed.seg_inf) return parseSegmentInfo(parsed.seg_inf);

  const rism = decodeRismPayload(parsed.rism);
  return rism?.seg_inf ? parseSegmentInfo(rism.seg_inf) : [];
}
