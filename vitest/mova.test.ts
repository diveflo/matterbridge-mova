import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMovaApiUrl,
  getMovaSendCommandEndpoint,
  getMovaTenantId,
  getMovaUserAgent,
  getOperationalErrorFromMova,
  getOperationalStateFromMova,
  isSupportedModel,
} from '../src/constants.js';
import { discoverAndRegisterDevices } from '../src/mova.js';
import { MovaCleaningMode, MovaErrorCode, MovaFanSpeed, MovaState, MovaStatus, MovaWaterFlow, type DeviceStatus, type MovaDevice, type RoomInfo } from '../src/types.js';

type CommandHandler = (data?: unknown) => Promise<void>;

const rvcMock = vi.hoisted(() => {
  class FakeRoboticVacuumCleaner {
    static instances: FakeRoboticVacuumCleaner[] = [];

    public uniqueId = '';
    public readonly handlers = new Map<string, CommandHandler>();
    public readonly attributes: Array<{ cluster: string; attribute: string; value: unknown }> = [];
    public readonly constructorArgs: unknown[];

    constructor(...args: unknown[]) {
      this.constructorArgs = args;
      FakeRoboticVacuumCleaner.instances.push(this);
    }

    addCommandHandler(command: string, handler: CommandHandler): void {
      this.handlers.set(command, handler);
    }

    setAttribute(cluster: string, attribute: string, value: unknown): void {
      this.attributes.push({ cluster, attribute, value });
    }

    async execute(command: string, data?: unknown): Promise<void> {
      const handler = this.handlers.get(command);
      if (!handler) {
        throw new Error(`Missing command handler: ${command}`);
      }
      await handler(data);
    }

    lastAttribute(cluster: string, attribute: string): unknown {
      const matches = this.attributes.filter((entry) => entry.cluster === cluster && entry.attribute === attribute);
      return matches.at(-1)?.value;
    }
  }

  return { FakeRoboticVacuumCleaner };
});

vi.mock('matterbridge/devices', () => ({
  RoboticVacuumCleaner: rvcMock.FakeRoboticVacuumCleaner,
}));

const RvcOperationalState = {
  Running: 1,
  Paused: 2,
  UnableToCompleteOperation: 2,
  Stuck: 65,
  SeekingCharger: 64,
  Charging: 65,
  Docked: 66,
} as const;

const rooms: RoomInfo[] = [
  { id: 11, name: 'Kitchen', floorId: 0 },
  { id: 12, name: 'Hallway', floorId: 1 },
];

const movaDevice: MovaDevice = {
  did: 'vacuum-1',
  name: 'MOVA S70',
  model: 'mova.vacuum.s70',
  mac: '00:11:22:33:44:55',
  online: true,
  ownerId: 'owner-1',
};

function status(overrides: Partial<DeviceStatus> = {}): DeviceStatus {
  return {
    state: MovaState.Idle,
    status: MovaStatus.Charging,
    battery: 87,
    fanSpeed: MovaFanSpeed.Standard,
    waterFlow: MovaWaterFlow.Medium,
    cleaningMode: MovaCleaningMode.SweepingAndMopping,
    errorCode: MovaErrorCode.None,
    ...overrides,
  };
}

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
  return {
    locate: vi.fn(async () => true),
    stopCleaning: vi.fn(async () => true),
    startCleaning: vi.fn(async () => true),
    cleanRooms: vi.fn(async () => true),
    pauseCleaning: vi.fn(async () => true),
    resumeCleaning: vi.fn(async () => true),
    goHome: vi.fn(async () => true),
  };
}

async function createRegisteredVacuum(options: { config?: Record<string, unknown>; initialStatus?: DeviceStatus | null; roomList?: RoomInfo[] } = {}) {
  const log = createLog();
  const cloud = createCloud();
  const registerDevice = vi.fn(async () => {});
  const platform = {
    log,
    config: options.config ?? {},
    registerDevice,
  };

  const registered = await discoverAndRegisterDevices(platform as never, cloud as never, movaDevice, options.roomList ?? rooms, options.initialStatus ?? status());
  const endpoint = rvcMock.FakeRoboticVacuumCleaner.instances.at(-1);

  if (!registered || !endpoint) {
    throw new Error('Expected test vacuum to be registered');
  }

  return { registered, endpoint, cloud, log, registerDevice };
}

describe('MOVA to Matter status mapping', () => {
  it('builds stable MOVA API identifiers used by cloud requests', () => {
    expect(getMovaApiUrl('eu')).toBe('https://eu.iot.mova-tech.com:13267');
    expect(getMovaSendCommandEndpoint()).toBe('/dreame-iot-com-eu/device/sendCommand');
    expect(getMovaSendCommandEndpoint('us.iot.mova-tech.com')).toBe('/dreame-iot-com-us/device/sendCommand');
    expect(getMovaTenantId()).toBe('000002');
    expect(getMovaUserAgent()).toContain('Mova_Smarthome');
    expect(isSupportedModel('mova.vacuum.s70')).toBe(true);
    expect(isSupportedModel('dreame.vacuum.r20')).toBe(false);
  });

  it('treats definitive dock statuses as authoritative when stale state still says cleaning', () => {
    expect(getOperationalStateFromMova(MovaState.ManualCleaning, MovaStatus.Charging)).toBe(RvcOperationalState.Charging);
    expect(getOperationalStateFromMova(MovaState.ZonedCleaning, MovaStatus.ChargingComplete)).toBe(RvcOperationalState.Docked);
  });

  it('uses active states, known statuses, known states, and safe fallbacks in priority order', () => {
    expect(getOperationalStateFromMova(MovaState.FastMapping, MovaStatus.Unknown)).toBe(RvcOperationalState.Running);
    expect(getOperationalStateFromMova(MovaState.Unknown, MovaStatus.BackHome)).toBe(RvcOperationalState.SeekingCharger);
    expect(getOperationalStateFromMova(MovaState.Dormant, MovaStatus.Unknown)).toBe(RvcOperationalState.Docked);
    expect(getOperationalStateFromMova(999 as MovaState, MovaStatus.Unknown)).toBe(RvcOperationalState.Running);
    expect(getOperationalStateFromMova(MovaState.Unknown, MovaStatus.Unknown)).toBe(0);
    expect(getOperationalStateFromMova(-999 as MovaState, MovaStatus.Unknown)).toBe(RvcOperationalState.Docked);
  });

  it('keeps paused status higher priority than active states', () => {
    expect(getOperationalStateFromMova(MovaState.Cleaning, MovaStatus.Paused)).toBe(RvcOperationalState.Paused);
  });

  it('maps unknown real error codes to a generic Matter operational error but ignores device-specific non-errors', () => {
    expect(getOperationalErrorFromMova(42 as MovaErrorCode)).toBe(RvcOperationalState.UnableToCompleteOperation);
    expect(getOperationalErrorFromMova(43 as MovaErrorCode)).toBeNull();
    expect(getOperationalErrorFromMova(150 as MovaErrorCode)).toBe(RvcOperationalState.UnableToCompleteOperation);
  });

  it('maps physical blockage errors to Matter stuck so controllers can show actionable failures', () => {
    expect(getOperationalErrorFromMova(MovaErrorCode.MainBrushJammed)).toBe(RvcOperationalState.Stuck);
  });
});

describe('MOVA robotic vacuum endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rvcMock.FakeRoboticVacuumCleaner.instances = [];
  });

  it('registers a Matter RVC with service areas generated from rooms', async () => {
    const { registered, endpoint, registerDevice } = await createRegisteredVacuum();

    expect(registerDevice).toHaveBeenCalledWith(endpoint);
    expect(registered.did).toBe(movaDevice.did);
    expect(endpoint.uniqueId).toBe(movaDevice.did);

    expect(endpoint.constructorArgs[0]).toBe('MOVA S70');
    expect(endpoint.constructorArgs[2]).toBe('server');
    expect(endpoint.constructorArgs[11]).toEqual([
      {
        areaId: 11,
        mapId: null,
        areaInfo: {
          locationInfo: { locationName: 'Kitchen', floorNumber: 0, areaType: 0 },
          landmarkInfo: null,
        },
      },
      {
        areaId: 12,
        mapId: null,
        areaInfo: {
          locationInfo: { locationName: 'Hallway', floorNumber: 1, areaType: 0 },
          landmarkInfo: null,
        },
      },
    ]);
    expect(endpoint.constructorArgs[12]).toEqual([11, 12]);
    expect(endpoint.constructorArgs[14]).toEqual([]);
  });

  it('returns null and logs when Matterbridge rejects device registration', async () => {
    const log = createLog();
    const registerError = new Error('registration failed');
    const platform = {
      log,
      config: {},
      registerDevice: vi.fn(async () => {
        throw registerError;
      }),
    };

    await expect(discoverAndRegisterDevices(platform as never, createCloud() as never, movaDevice, rooms, status())).resolves.toBeNull();
    expect(log.error).toHaveBeenCalledWith(`Failed to register device ${movaDevice.name}: ${registerError}`);
  });

  it('uses a whole-home fallback area when the cloud has not supplied rooms yet', async () => {
    const { endpoint } = await createRegisteredVacuum({ roomList: [] });

    expect(endpoint.constructorArgs[11]).toEqual([
      {
        areaId: 1,
        mapId: null,
        areaInfo: {
          locationInfo: { locationName: 'Home', floorNumber: null, areaType: 0 },
          landmarkInfo: null,
        },
      },
    ]);
    expect(endpoint.constructorArgs[12]).toEqual([1]);
  });

  it('starts whole-home cleaning with the configured suction and vacuum/mop mode', async () => {
    const { endpoint, cloud } = await createRegisteredVacuum({
      config: { suctionLevel: 'turbo', vacuumAndMopMode: 'vac-then-mop' },
    });

    await endpoint.execute('changeToMode', { cluster: 'rvcCleanMode', request: { newMode: 1 } });
    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: { newMode: 1 } });

    expect(cloud.startCleaning).toHaveBeenCalledWith(movaDevice.did, MovaCleaningMode.MoppingAfterSweeping, MovaFanSpeed.Turbo);
    expect(cloud.cleanRooms).not.toHaveBeenCalled();
    expect(endpoint.lastAttribute('RvcRunMode', 'currentMode')).toBe(1);
    expect(endpoint.lastAttribute('RvcOperationalState', 'operationalState')).toBe(RvcOperationalState.Running);
  });

  it('ignores malformed, unsupported, and app-only mode changes without sending cloud commands', async () => {
    const { endpoint, cloud, log } = await createRegisteredVacuum();

    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: {} });
    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: { newMode: 2 } });
    await endpoint.execute('changeToMode', { cluster: 'rvcCleanMode', request: { newMode: 99 } });

    expect(log.warn).toHaveBeenCalledWith('changeToMode: newMode is undefined, cannot process command');
    expect(log.warn).toHaveBeenCalledWith('Mapping mode (2) cannot be started via Matter - use the Mova app to initiate mapping');
    expect(log.warn).toHaveBeenCalledWith('Unsupported clean mode 99');
    expect(cloud.startCleaning).not.toHaveBeenCalled();
    expect(cloud.cleanRooms).not.toHaveBeenCalled();
    expect(cloud.stopCleaning).not.toHaveBeenCalled();
  });

  it('leaves Matter attributes unchanged when a cloud command fails', async () => {
    const { endpoint, cloud } = await createRegisteredVacuum();
    cloud.startCleaning.mockResolvedValueOnce(false);
    const beforeRunModeUpdates = endpoint.attributes.filter((entry) => entry.cluster === 'RvcRunMode' && entry.attribute === 'currentMode').length;

    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: { newMode: 1 } });

    expect(cloud.startCleaning).toHaveBeenCalled();
    expect(endpoint.attributes.filter((entry) => entry.cluster === 'RvcRunMode' && entry.attribute === 'currentMode')).toHaveLength(beforeRunModeUpdates);
    expect(endpoint.lastAttribute('RvcOperationalState', 'operationalState')).toBe(RvcOperationalState.Charging);
  });

  it('cleans only selected rooms when the service-area selection is narrower than the whole home', async () => {
    const { endpoint, cloud } = await createRegisteredVacuum();

    await endpoint.execute('selectAreas', { request: { newAreas: [12] } });
    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: { newMode: 1 } });

    expect(cloud.cleanRooms).toHaveBeenCalledWith(movaDevice.did, [12], 1, MovaCleaningMode.SweepingAndMopping, MovaFanSpeed.Standard);
    expect(cloud.startCleaning).not.toHaveBeenCalled();
    expect(endpoint.lastAttribute('ServiceArea', 'selectedAreas')).toEqual([12]);
  });

  it('treats an empty service-area selection as all rooms, matching Matter controller semantics', async () => {
    const { endpoint, cloud } = await createRegisteredVacuum();

    await endpoint.execute('selectAreas', { request: { newAreas: [] } });
    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: { newMode: 1 } });

    expect(endpoint.lastAttribute('ServiceArea', 'selectedAreas')).toEqual([11, 12]);
    expect(cloud.startCleaning).toHaveBeenCalledWith(movaDevice.did, MovaCleaningMode.SweepingAndMopping, MovaFanSpeed.Standard);
  });

  it('does not change cleaning mode while the vacuum is actively running', async () => {
    const { endpoint, cloud, log } = await createRegisteredVacuum();

    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: { newMode: 1 } });
    await endpoint.execute('changeToMode', { cluster: 'rvcCleanMode', request: { newMode: 2 } });
    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: { newMode: 1 } });

    expect(log.warn).toHaveBeenCalledWith('Cannot change clean mode while actively cleaning - pause or stop first');
    expect(cloud.startCleaning).toHaveBeenLastCalledWith(movaDevice.did, MovaCleaningMode.SweepingAndMopping, MovaFanSpeed.Standard);
  });

  it('pauses, resumes, stops, identifies, and returns home through the expected cloud commands', async () => {
    const { endpoint, cloud } = await createRegisteredVacuum();

    await endpoint.execute('identify');
    await endpoint.execute('pause');
    await endpoint.execute('resume');
    await endpoint.execute('changeToMode', { cluster: 'rvcRunMode', request: { newMode: 0 } });
    await endpoint.execute('goHome');

    expect(cloud.locate).toHaveBeenCalledWith(movaDevice.did);
    expect(cloud.pauseCleaning).toHaveBeenCalledWith(movaDevice.did);
    expect(cloud.resumeCleaning).toHaveBeenCalledWith(movaDevice.did);
    expect(cloud.stopCleaning).toHaveBeenCalledTimes(2);
    expect(cloud.goHome).toHaveBeenCalledWith(movaDevice.did);
    expect(endpoint.lastAttribute('RvcOperationalState', 'operationalState')).toBe(RvcOperationalState.SeekingCharger);
    expect(endpoint.lastAttribute('ServiceArea', 'currentArea')).toBeNull();
  });

  it('updates Matter attributes from cloud status without letting stale cleaning states override docked status', async () => {
    const { registered, endpoint } = await createRegisteredVacuum();

    registered.updateStatus(
      status({
        state: MovaState.ManualCleaning,
        status: MovaStatus.Charging,
        battery: 100,
        currentArea: 12,
      }),
    );

    expect(endpoint.lastAttribute('RvcOperationalState', 'operationalState')).toBe(RvcOperationalState.Charging);
    expect(endpoint.lastAttribute('RvcRunMode', 'currentMode')).toBe(0);
    expect(endpoint.lastAttribute('PowerSource', 'batPercentRemaining')).toBe(200);
    expect(endpoint.lastAttribute('PowerSource', 'batChargeState')).toBe(2);
    expect(endpoint.lastAttribute('ServiceArea', 'currentArea')).toBe(12);
  });

  it('reflects active cleaning, mapping, clean-mode, battery, and error changes from cloud status', async () => {
    const { registered, endpoint } = await createRegisteredVacuum();

    registered.updateStatus(
      status({
        state: MovaState.Cleaning,
        status: MovaStatus.Sweeping,
        battery: 50,
        cleaningMode: MovaCleaningMode.Mopping,
        errorCode: MovaErrorCode.MainBrushJammed,
      }),
    );
    registered.updateStatus(status({ state: MovaState.FastMapping, status: MovaStatus.FastMapping, battery: 100 }));
    registered.updateStatus(status({ state: MovaState.Idle, status: MovaStatus.Idle, battery: 100 }));

    expect(endpoint.attributes).toContainEqual({ cluster: 'RvcOperationalState', attribute: 'operationalState', value: RvcOperationalState.Running });
    expect(endpoint.attributes).toContainEqual({ cluster: 'RvcRunMode', attribute: 'currentMode', value: 1 });
    expect(endpoint.attributes).toContainEqual({ cluster: 'RvcRunMode', attribute: 'currentMode', value: 2 });
    expect(endpoint.attributes).toContainEqual({ cluster: 'RvcCleanMode', attribute: 'currentMode', value: 2 });
    expect(endpoint.attributes).toContainEqual({ cluster: 'RvcOperationalState', attribute: 'operationalError', value: { errorStateId: RvcOperationalState.Stuck } });
    expect(endpoint.attributes).toContainEqual({ cluster: 'PowerSource', attribute: 'batChargeState', value: 3 });
    expect(endpoint.attributes).toContainEqual({ cluster: 'PowerSource', attribute: 'batChargeState', value: 2 });
  });

  it('keeps the previous battery attributes when MQTT sends a partial zero-battery update', async () => {
    const { registered, endpoint } = await createRegisteredVacuum();

    registered.updateStatus(status({ battery: 73 }));
    registered.updateStatus(status({ battery: 0 }));

    expect(endpoint.lastAttribute('PowerSource', 'batPercentRemaining')).toBe(146);
  });

  it('updates rooms while preserving still-valid user selections', async () => {
    const { registered, endpoint } = await createRegisteredVacuum();

    await endpoint.execute('selectAreas', { request: { newAreas: [12] } });
    registered.updateRooms([
      { id: 12, name: 'Hallway', floorId: 1 },
      { id: 13, name: 'Bedroom' },
    ]);

    expect(endpoint.lastAttribute('ServiceArea', 'supportedAreas')).toEqual([
      {
        areaId: 12,
        mapId: null,
        areaInfo: {
          locationInfo: { locationName: 'Hallway', floorNumber: 1, areaType: 0 },
          landmarkInfo: null,
        },
      },
      {
        areaId: 13,
        mapId: null,
        areaInfo: {
          locationInfo: { locationName: 'Bedroom', floorNumber: null, areaType: 0 },
          landmarkInfo: null,
        },
      },
    ]);
    expect(endpoint.lastAttribute('ServiceArea', 'selectedAreas')).toEqual([12]);
  });

  it('ignores empty room updates and resets selection when all previously selected rooms disappear', async () => {
    const { registered, endpoint } = await createRegisteredVacuum();

    const supportedAreasBefore = endpoint.lastAttribute('ServiceArea', 'supportedAreas');
    registered.updateRooms([]);
    expect(endpoint.lastAttribute('ServiceArea', 'supportedAreas')).toBe(supportedAreasBefore);

    await endpoint.execute('selectAreas', { request: { newAreas: [99] } });
    registered.updateRooms([{ id: 12, name: 'Hallway' }]);
    expect(endpoint.lastAttribute('ServiceArea', 'selectedAreas')).toEqual([]);

    registered.updateRooms([{ id: 13, name: 'Bedroom' }]);
    expect(endpoint.lastAttribute('ServiceArea', 'selectedAreas')).toEqual([13]);
  });

  it('logs and keeps running when ServiceArea room updates cannot be written', async () => {
    const { registered, endpoint, log } = await createRegisteredVacuum();
    const originalSetAttribute = endpoint.setAttribute.bind(endpoint);
    const serviceAreaError = new Error('service area unavailable');
    const setAttribute = vi.spyOn(endpoint, 'setAttribute');
    setAttribute.mockImplementation((cluster: string, attribute: string, value: unknown) => {
      if (cluster === 'ServiceArea' && attribute === 'supportedAreas') {
        throw serviceAreaError;
      }
      originalSetAttribute(cluster, attribute, value);
    });

    registered.updateRooms([{ id: 14, name: 'Office' }]);

    expect(log.error).toHaveBeenCalledWith(`Failed to update ServiceArea: ${serviceAreaError}`);
  });
});
