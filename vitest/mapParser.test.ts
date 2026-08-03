import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { parseRoomsFromMapData } from '../src/mapParser.js';

function compressedBase64(value: string | Buffer): string {
  return deflateSync(value).toString('base64');
}

describe('MOVA map parser formats', () => {
  it('parses plain JSON and ignores invalid segment records', () => {
    const payload = JSON.stringify({
      seg_inf: {
        '1': { type: 99, name: '' },
        'invalid': { type: 4 },
        '2': null,
      },
    });

    expect(parseRoomsFromMapData(payload)).toEqual([{ id: 1, name: 'Room', floorId: 99 }]);
    expect(parseRoomsFromMapData([])).toEqual([]);
    expect(parseRoomsFromMapData('')).toEqual([]);
    expect(parseRoomsFromMapData(JSON.stringify([]))).toEqual([]);
  });

  it('parses directly compressed JSON maps', () => {
    const payload = compressedBase64(JSON.stringify({ seg_inf: { '3': { type: 6 } } }));

    expect(parseRoomsFromMapData(payload)).toEqual([{ id: 3, name: 'Bathroom', floorId: 6 }]);
  });

  it('parses JSON and compressed nested rism payloads', () => {
    const segmentInfo = { seg_inf: { '4': { type: 7 } } };
    const jsonRism = Buffer.from(JSON.stringify(segmentInfo)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const compressedRism = compressedBase64(JSON.stringify(segmentInfo));

    expect(parseRoomsFromMapData({ rism: jsonRism })).toEqual([{ id: 4, name: 'Balcony', floorId: 7 }]);
    expect(parseRoomsFromMapData({ rism: compressedRism })).toEqual([{ id: 4, name: 'Balcony', floorId: 7 }]);
  });

  it('extracts embedded JSON from noisy compressed map layers', () => {
    const rism = Buffer.from(JSON.stringify({ seg_inf: { '5': { type: 8 } } })).toString('base64');
    const outerPayload = compressedBase64(Buffer.concat([Buffer.alloc(1_200, 0), Buffer.from(JSON.stringify({ rism }))]));
    const embeddedRism = compressedBase64(`binary-prefix ${JSON.stringify({ note: 'escaped "} brace', seg_inf: { '6': { type: 9 } } })} trailing-data`);

    expect(parseRoomsFromMapData(outerPayload)).toEqual([{ id: 5, name: 'Corridor', floorId: 8 }]);
    expect(parseRoomsFromMapData({ rism: embeddedRism })).toEqual([{ id: 6, name: 'Utility Room', floorId: 9 }]);
  });

  it('returns an empty room list for incomplete and corrupt encoded payloads', () => {
    const corruptZlib = Buffer.from([0x78, 0x00]).toString('base64');

    expect(parseRoomsFromMapData(corruptZlib)).toEqual([]);
    expect(parseRoomsFromMapData({ rism: corruptZlib })).toEqual([]);
    expect(parseRoomsFromMapData({ rism: 42 })).toEqual([]);
    expect(parseRoomsFromMapData({ other: 'data' })).toEqual([]);
    expect(parseRoomsFromMapData({ seg_inf: [] })).toEqual([]);
  });
});
