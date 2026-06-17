import { describe, expect, it, vi } from 'vitest';

import { MIOT_ACTIONS, MIOT_ACTION_PARAMS, MIOT_PROPERTIES, MOVA_DEVICE_LIST_ENDPOINT, MOVA_STATUS_VALUES } from '../src/constants.js';
import { MovaCloudProtocol } from '../src/movaCloud.js';
import { MovaCleaningMode, MovaErrorCode, MovaFanSpeed, MovaState, MovaStatus, MovaWaterFlow } from '../src/types.js';

function createLog() {
  return {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    notice: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function createCloud() {
  return new MovaCloudProtocol(createLog() as never);
}

function prop(siid: number, piid: number, value: unknown, code = 0) {
  return { siid, piid, value, code };
}

describe('MOVA cloud response parsing', () => {
  it('discovers only supported MOVA vacuums and preserves cloud metadata needed later', async () => {
    const cloud = createCloud();
    const apiCall = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, data: { page: {} } })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          page: {
            records: [
              {
                did: 'vacuum-1',
                model: 'mova.vacuum.s70',
                mac: '00:11:22:33:44:55',
                localip: '192.168.1.5',
                online: true,
                masterUid: 'owner-1',
                bindDomain: 'us.iot.mova-tech.com',
                property: 'primary',
                customName: 'Downstairs',
              },
              {
                did: 'lamp-1',
                model: 'mova.light.foo',
                mac: 'aa:bb:cc:dd:ee:ff',
                online: true,
                masterUid: 'owner-2',
              },
            ],
          },
        },
      });
    (cloud as any).apiCall = apiCall;

    const devices = await cloud.getDevices();

    expect(apiCall).toHaveBeenNthCalledWith(1, MOVA_DEVICE_LIST_ENDPOINT, 'POST', { page: 1, pageSize: 100 });
    expect(apiCall).toHaveBeenNthCalledWith(2, MOVA_DEVICE_LIST_ENDPOINT, 'POST');
    expect(devices).toEqual([
      {
        did: 'vacuum-1',
        name: 'Downstairs',
        model: 'mova.vacuum.s70',
        mac: '00:11:22:33:44:55',
        localIp: '192.168.1.5',
        online: true,
        ownerId: 'owner-1',
        bindDomain: 'us.iot.mova-tech.com',
        property: 'primary',
      },
    ]);
  });

  it('parses wrapped get_properties responses into a complete DeviceStatus', async () => {
    const cloud = createCloud();
    (cloud as any).sendCloudCommand = vi.fn(async () => ({
      result: [
        prop(MIOT_PROPERTIES.operatingMode.siid, MIOT_PROPERTIES.operatingMode.piid, MovaState.Cleaning),
        prop(MIOT_PROPERTIES.deviceStatus.siid, MIOT_PROPERTIES.deviceStatus.piid, MovaStatus.Sweeping),
        prop(MIOT_PROPERTIES.batteryLevel.siid, MIOT_PROPERTIES.batteryLevel.piid, 81),
        prop(MIOT_PROPERTIES.suctionLevel.siid, MIOT_PROPERTIES.suctionLevel.piid, MovaFanSpeed.Max),
        prop(MIOT_PROPERTIES.waterFlow.siid, MIOT_PROPERTIES.waterFlow.piid, MovaWaterFlow.High),
        prop(MIOT_PROPERTIES.cleaningMode.siid, MIOT_PROPERTIES.cleaningMode.piid, MovaCleaningMode.Sweeping),
        prop(MIOT_PROPERTIES.deviceFault.siid, MIOT_PROPERTIES.deviceFault.piid, MovaErrorCode.None),
        prop(MIOT_PROPERTIES.waterTankInstalled.siid, MIOT_PROPERTIES.waterTankInstalled.piid, 1),
        prop(MIOT_PROPERTIES.mopPadInstalled.siid, MIOT_PROPERTIES.mopPadInstalled.piid, 0),
        prop(MIOT_PROPERTIES.dustCollectionStatus.siid, MIOT_PROPERTIES.dustCollectionStatus.piid, 2),
        prop(MIOT_PROPERTIES.cleanWaterTankStatus.siid, MIOT_PROPERTIES.cleanWaterTankStatus.piid, 3),
        prop(MIOT_PROPERTIES.dirtyWaterTankStatus.siid, MIOT_PROPERTIES.dirtyWaterTankStatus.piid, 4),
      ],
    }));

    await expect(cloud.getDeviceProperties('vacuum-1')).resolves.toEqual({
      state: MovaState.Cleaning,
      status: MovaStatus.Sweeping,
      battery: 81,
      fanSpeed: MovaFanSpeed.Max,
      waterFlow: MovaWaterFlow.High,
      cleaningMode: MovaCleaningMode.Sweeping,
      errorCode: MovaErrorCode.None,
      waterTankInstalled: true,
      mopPadInstalled: false,
      dustCollectionStatus: 2,
      cleanWaterTankStatus: 3,
      dirtyWaterTankStatus: 4,
    });
  });

  it('ignores failed property entries and falls back to safe defaults', async () => {
    const cloud = createCloud();
    (cloud as any).sendCloudCommand = vi.fn(async () => [
      prop(MIOT_PROPERTIES.batteryLevel.siid, MIOT_PROPERTIES.batteryLevel.piid, 75, -1),
      prop(MIOT_PROPERTIES.deviceStatus.siid, MIOT_PROPERTIES.deviceStatus.piid, MovaStatus.Charging),
    ]);

    await expect(cloud.getDeviceProperties('vacuum-1')).resolves.toEqual({
      state: MovaState.Unknown,
      status: MovaStatus.Charging,
      battery: 0,
      fanSpeed: MovaFanSpeed.Standard,
      waterFlow: MovaWaterFlow.Medium,
      cleaningMode: undefined,
      errorCode: MovaErrorCode.None,
      waterTankInstalled: undefined,
      mopPadInstalled: undefined,
      dustCollectionStatus: undefined,
      cleanWaterTankStatus: undefined,
      dirtyWaterTankStatus: undefined,
    });
  });

  it('returns cached rooms from MQTT without reaching cloud storage', async () => {
    const cloud = createCloud();
    (cloud as any).cachedRooms.set('vacuum-1', [
      { id: 11, name: 'Kitchen', floorId: 4 },
      { id: 12, name: 'Hallway', floorId: 8 },
    ]);

    await expect(cloud.getRoomInfo('vacuum-1')).resolves.toEqual([
      { id: 11, name: 'Kitchen', floorId: 4 },
      { id: 12, name: 'Hallway', floorId: 8 },
    ]);
  });
});

describe('MOVA cloud command payloads', () => {
  it('sets clean mode and suction before starting whole-home cleaning', async () => {
    const cloud = createCloud();
    const sendCommand = vi.fn(async () => ({ ok: true }));
    cloud.sendCommand = sendCommand;

    await expect(cloud.startCleaning('vacuum-1', MovaCleaningMode.MoppingAfterSweeping, MovaFanSpeed.Max)).resolves.toBe(true);

    expect(sendCommand).toHaveBeenNthCalledWith(1, 'vacuum-1', 'set_properties', [
      {
        siid: MIOT_PROPERTIES.cleaningMode.siid,
        piid: MIOT_PROPERTIES.cleaningMode.piid,
        value: MovaCleaningMode.MoppingAfterSweeping,
      },
    ]);
    expect(sendCommand).toHaveBeenNthCalledWith(2, 'vacuum-1', 'set_properties', [
      {
        siid: MIOT_PROPERTIES.suctionLevel.siid,
        piid: MIOT_PROPERTIES.suctionLevel.piid,
        value: MovaFanSpeed.Max,
      },
    ]);
    expect(sendCommand).toHaveBeenNthCalledWith(3, 'vacuum-1', 'action', [MIOT_ACTIONS.startClean.siid, MIOT_ACTIONS.startClean.aiid, []]);
  });

  it('builds the MOVA segment-cleaning payload with repeat, suction, water level, and order', async () => {
    const cloud = createCloud();
    const sendCommand = vi.fn(async () => ({ ok: true }));
    cloud.sendCommand = sendCommand;

    await expect(cloud.cleanRooms('vacuum-1', [12, 11], 2, MovaCleaningMode.SweepingAndMopping, MovaFanSpeed.Intense)).resolves.toBe(true);

    expect(sendCommand).toHaveBeenNthCalledWith(1, 'vacuum-1', 'set_properties', [
      {
        siid: MIOT_PROPERTIES.cleaningMode.siid,
        piid: MIOT_PROPERTIES.cleaningMode.piid,
        value: MovaCleaningMode.SweepingAndMopping,
      },
    ]);
    expect(sendCommand).toHaveBeenNthCalledWith(2, 'vacuum-1', 'set_properties', [
      {
        siid: MIOT_PROPERTIES.suctionLevel.siid,
        piid: MIOT_PROPERTIES.suctionLevel.piid,
        value: MovaFanSpeed.Intense,
      },
    ]);
    expect(sendCommand).toHaveBeenNthCalledWith(3, 'vacuum-1', 'action', [
      MIOT_ACTIONS.startCustom.siid,
      MIOT_ACTIONS.startCustom.aiid,
      [
        { piid: MIOT_ACTION_PARAMS.status, value: MOVA_STATUS_VALUES.segmentCleaning },
        {
          piid: MIOT_ACTION_PARAMS.cleaningProperties,
          value: JSON.stringify({
            selects: [
              [12, 2, MovaFanSpeed.Intense, 0, 1],
              [11, 2, MovaFanSpeed.Intense, 0, 2],
            ],
          }),
        },
      ],
    ]);
  });

  it('uses mop water level for mop-only segment cleaning', async () => {
    const cloud = createCloud();
    const sendCommand = vi.fn(async () => ({ ok: true }));
    cloud.sendCommand = sendCommand;

    await cloud.cleanRooms('vacuum-1', [12], 1, MovaCleaningMode.Mopping);

    expect(sendCommand).toHaveBeenLastCalledWith('vacuum-1', 'action', [
      MIOT_ACTIONS.startCustom.siid,
      MIOT_ACTIONS.startCustom.aiid,
      [
        { piid: MIOT_ACTION_PARAMS.status, value: MOVA_STATUS_VALUES.segmentCleaning },
        {
          piid: MIOT_ACTION_PARAMS.cleaningProperties,
          value: JSON.stringify({ selects: [[12, 1, MovaFanSpeed.Standard, 2, 1]] }),
        },
      ],
    ]);
  });
});

describe('MOVA cloud map parsing', () => {
  it('extracts custom and generated room names from seg_inf map data', () => {
    const cloud = createCloud();

    const rooms = (cloud as any).parseRoomsFromMapData({
      seg_inf: {
        '11': { type: 4, name: Buffer.from('Kitchen Island').toString('base64') },
        '12': { type: 2 },
        '13': { type: 2 },
      },
    });

    expect(rooms).toEqual([
      { id: 11, name: 'Kitchen Island', floorId: 4 },
      { id: 12, name: 'Primary Bedroom', floorId: 2 },
      { id: 13, name: 'Primary Bedroom 2', floorId: 2 },
    ]);
  });

  it('stores rooms found during proactive map fetch and calls room update callbacks', async () => {
    const cloud = createCloud();
    const rooms = [{ id: 11, name: 'Kitchen', floorId: 4 }];
    const roomCallback = vi.fn();
    (cloud as any).deviceOwnerIds.set('vacuum-1', 'owner-1');
    (cloud as any).fetchMapFromCloudStorage = vi.fn(async (did: string, path: string) => {
      if (path.endsWith('/1')) {
        (cloud as any).cachedRooms.set(did, rooms);
        roomCallback(rooms);
      }
    });
    cloud.onRoomUpdate('vacuum-1', roomCallback);

    await expect(cloud.tryFetchMapOnStartup('vacuum-1')).resolves.toBe(true);
    expect((cloud as any).fetchMapFromCloudStorage).toHaveBeenCalledWith('vacuum-1', 'ali_dreame/owner-1/vacuum-1/1');
    expect(cloud.getCachedRooms('vacuum-1')).toEqual(rooms);
    expect(roomCallback).toHaveBeenCalledWith(rooms);
  });
});
