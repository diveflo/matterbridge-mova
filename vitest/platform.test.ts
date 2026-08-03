import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MovaState, MovaStatus, MovaFanSpeed, MovaWaterFlow, MovaErrorCode, type DeviceStatus, type MovaDevice, type RoomInfo } from '../src/types.js';

const mocks = vi.hoisted(() => {
  const cloudInstances: FakeMovaCloudProtocol[] = [];
  const discoverAndRegisterDevices = vi.fn();
  let matterbridgeVersionSupported = true;

  class FakeMatterbridgeDynamicPlatform {
    public matterbridge: unknown;
    public log: unknown;
    public config: Record<string, unknown>;
    public ready = Promise.resolve();
    public context?: {
      get<T>(key: string): Promise<T | undefined>;
      set<T>(key: string, value: T): Promise<void>;
    };
    public unregisterAllDevices = vi.fn(async () => {});
    public verifyMatterbridgeVersion = vi.fn(() => matterbridgeVersionSupported);

    constructor(matterbridge: unknown, log: unknown, config: Record<string, unknown>) {
      this.matterbridge = matterbridge;
      this.log = log;
      this.config = config;
    }

    async onConfigure(): Promise<void> {}

    async onShutdown(_reason?: string): Promise<void> {}
  }

  class FakeMovaCloudProtocol {
    public login = vi.fn(async () => ({ success: true }));
    public getDevices = vi.fn(async () => []);
    public getRoomInfo = vi.fn(async () => []);
    public tryFetchMapOnStartup = vi.fn(async () => false);
    public getCachedRooms = vi.fn(() => []);
    public getDeviceProperties = vi.fn(async () => null);
    public connectMqtt = vi.fn(async () => false);
    public onDeviceStatus = vi.fn();
    public onRoomUpdate = vi.fn();
    public disconnect = vi.fn(async () => {});

    constructor() {
      cloudInstances.push(this);
    }
  }

  return {
    FakeMatterbridgeDynamicPlatform,
    FakeMovaCloudProtocol,
    cloudInstances,
    discoverAndRegisterDevices,
    setMatterbridgeVersionSupported: (supported: boolean) => {
      matterbridgeVersionSupported = supported;
    },
  };
});

vi.mock('matterbridge', () => ({
  MatterbridgeDynamicPlatform: mocks.FakeMatterbridgeDynamicPlatform,
}));

vi.mock('../src/movaCloud.js', () => ({
  MovaCloudProtocol: mocks.FakeMovaCloudProtocol,
}));

vi.mock('../src/mova.js', () => ({
  discoverAndRegisterDevices: mocks.discoverAndRegisterDevices,
}));

const { MovaPlatform } = await import('../src/platform.js');

const matterbridge = {
  matterbridgeVersion: '3.9.0',
};

const cloudDevice: MovaDevice = {
  did: 'vacuum-1',
  name: 'MOVA S70',
  model: 'mova.vacuum.s70',
  mac: '00:11:22:33:44:55',
  online: true,
  ownerId: 'owner-1',
  bindDomain: 'us.iot.mova-tech.com',
};

const discoveredDevice = {
  did: cloudDevice.did,
  name: cloudDevice.name,
  model: cloudDevice.model,
  updateStatus: vi.fn(),
  updateRooms: vi.fn(),
};

const activeStatus: DeviceStatus = {
  state: MovaState.Cleaning,
  status: MovaStatus.Sweeping,
  battery: 80,
  fanSpeed: MovaFanSpeed.Standard,
  waterFlow: MovaWaterFlow.Medium,
  errorCode: MovaErrorCode.None,
};

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

function createPlatform(config: Record<string, unknown> = {}) {
  const log = createLog();
  const platform = new MovaPlatform(matterbridge as never, log as never, config as never);
  const cloud = mocks.cloudInstances.at(-1);

  if (!cloud) {
    throw new Error('Expected cloud protocol instance');
  }

  return { platform, cloud, log };
}

describe('MOVA platform lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.cloudInstances.length = 0;
    mocks.discoverAndRegisterDevices.mockReset();
    mocks.setMatterbridgeVersionSupported(true);
    discoveredDevice.updateStatus.mockReset();
    discoveredDevice.updateRooms.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('clamps too-low refresh intervals and validates the Matterbridge version', () => {
    const { platform, log } = createPlatform({ refreshInterval: 5 });

    expect(platform.verifyMatterbridgeVersion).toHaveBeenCalledWith('3.4.0');
    expect((platform as any).refreshInterval).toBe(30);
    expect(log.warn).toHaveBeenCalledWith('Refresh interval too low, setting to 30 seconds');
  });

  it('uses a safe default for invalid refresh intervals', () => {
    const { platform, log } = createPlatform({ refreshInterval: 'soon' });

    expect((platform as any).refreshInterval).toBe(120);
    expect(log.warn).toHaveBeenCalledWith('Invalid refresh interval, using 120 seconds');
  });

  it('rejects unsupported Matterbridge versions', () => {
    mocks.setMatterbridgeVersionSupported(false);

    expect(() => createPlatform()).toThrow('This plugin requires Matterbridge version >= "3.4.0"');
  });

  it('does not login when required credentials are missing', async () => {
    const { platform, cloud, log } = createPlatform({ username: 'user@example.com', country: 'eu' });

    await platform.onStart('test');

    expect(log.error).toHaveBeenCalledWith('Missing username or password in configuration');
    expect(cloud.login).not.toHaveBeenCalled();
  });

  it('does not login when country is missing', async () => {
    const { platform, cloud, log } = createPlatform({ username: 'user@example.com', password: 'secret' });

    await platform.onStart('test');

    expect(log.error).toHaveBeenCalledWith('Missing or unsupported country/region in configuration');
    expect(cloud.login).not.toHaveBeenCalled();
  });

  it('does not login when country is unsupported', async () => {
    const { platform, cloud, log } = createPlatform({ username: 'user@example.com', password: 'secret', country: 'invalid' });

    await platform.onStart('test');

    expect(log.error).toHaveBeenCalledWith('Missing or unsupported country/region in configuration');
    expect(cloud.login).not.toHaveBeenCalled();
  });

  it('logs failed cloud login and does not discover devices', async () => {
    const { platform, cloud, log } = createPlatform({ username: 'user@example.com', password: 'secret', country: 'eu' });
    cloud.login.mockResolvedValueOnce({ success: false, error: 'bad credentials' } as never);

    await platform.onStart('test');

    expect(cloud.login).toHaveBeenCalledWith('user@example.com', 'secret', 'eu');
    expect(log.error).toHaveBeenCalledWith('Failed to login to Mova Cloud: bad credentials');
    expect(cloud.getDevices).not.toHaveBeenCalled();
  });

  it('handles an empty cloud account and logger-level changes', async () => {
    const { platform, cloud, log } = createPlatform({ username: 'user@example.com', password: 'secret', country: 'eu' });

    await platform.onStart();
    await platform.onChangeLoggerLevel('debug' as never);

    expect(cloud.getDevices).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith('No Mova vacuums found');
    expect(log.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: debug');
  });

  it('discovers devices, prefers cloud-fetched rooms, saves rooms, and registers the Matter device', async () => {
    const { platform, cloud } = createPlatform({ username: 'user@example.com', password: 'secret', country: 'eu' });
    const rooms: RoomInfo[] = [{ id: 11, name: 'Kitchen' }];
    const status = activeStatus;
    const stored = new Map<string, unknown>();
    (platform as any).context = {
      get: vi.fn(async (key: string) => stored.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        stored.set(key, value);
      }),
    };
    cloud.getDevices.mockResolvedValueOnce([cloudDevice] as never);
    cloud.getRoomInfo.mockResolvedValueOnce([]);
    cloud.tryFetchMapOnStartup.mockResolvedValueOnce(true);
    cloud.getCachedRooms.mockReturnValueOnce(rooms as never);
    cloud.getDeviceProperties.mockResolvedValueOnce(status as never);
    mocks.discoverAndRegisterDevices.mockResolvedValueOnce(discoveredDevice);

    await platform.onStart('test');

    expect(cloud.login).toHaveBeenCalledWith('user@example.com', 'secret', 'eu');
    expect(cloud.tryFetchMapOnStartup).toHaveBeenCalledWith(cloudDevice.did);
    expect((platform as any).context.set).toHaveBeenCalledWith('rooms_vacuum-1', rooms);
    expect(mocks.discoverAndRegisterDevices).toHaveBeenCalledWith(platform, cloud, cloudDevice, rooms, status);
    expect((platform as any).devices.get(cloudDevice.did)).toBe(discoveredDevice);
  });

  it('falls back to persisted rooms when MQTT and proactive cloud fetch have no rooms', async () => {
    const { platform, cloud } = createPlatform({ username: 'user@example.com', password: 'secret', country: 'eu' });
    const cachedRooms: RoomInfo[] = [{ id: 12, name: 'Hallway' }];
    (platform as any).context = {
      get: vi.fn(async () => cachedRooms),
      set: vi.fn(async () => {}),
    };
    cloud.getDevices.mockResolvedValueOnce([cloudDevice] as never);
    cloud.getRoomInfo.mockResolvedValueOnce([]);
    cloud.tryFetchMapOnStartup.mockResolvedValueOnce(false);
    mocks.discoverAndRegisterDevices.mockResolvedValueOnce(discoveredDevice);

    await platform.onStart('test');

    expect((platform as any).context.get).toHaveBeenCalledWith('rooms_vacuum-1');
    expect(mocks.discoverAndRegisterDevices).toHaveBeenCalledWith(platform, cloud, cloudDevice, cachedRooms, null);
  });

  it('tolerates missing and failing persistent room storage', async () => {
    const { platform, log } = createPlatform();
    const storedRooms: RoomInfo[] = [{ id: 11, name: 'Kitchen' }];

    await expect((platform as any).loadCachedRooms(cloudDevice.did)).resolves.toEqual([]);
    await expect((platform as any).saveCachedRooms(cloudDevice.did, storedRooms)).resolves.toBeUndefined();

    (platform as any).context = {
      get: vi.fn(async () => {
        throw new Error('read failed');
      }),
      set: vi.fn(async () => {
        throw new Error('write failed');
      }),
    };
    await expect((platform as any).loadCachedRooms(cloudDevice.did)).resolves.toEqual([]);
    await expect((platform as any).saveCachedRooms(cloudDevice.did, storedRooms)).resolves.toBeUndefined();
    await expect((platform as any).saveCachedRooms(cloudDevice.did, [])).resolves.toBeUndefined();

    expect(log.debug).toHaveBeenCalledWith('Failed to load cached rooms: Error: read failed');
    expect(log.debug).toHaveBeenCalledWith('Failed to save cached rooms: Error: write failed');
  });

  it('warns when no rooms are available and continues after device registration errors', async () => {
    const { platform, cloud, log } = createPlatform({ username: 'user@example.com', password: 'secret', country: 'eu' });
    cloud.getDevices.mockResolvedValueOnce([cloudDevice] as never);
    cloud.getRoomInfo.mockResolvedValueOnce([]);
    cloud.tryFetchMapOnStartup.mockResolvedValueOnce(false);
    mocks.discoverAndRegisterDevices.mockRejectedValueOnce(new Error('registration failed'));

    await platform.onStart('test');

    expect(log.warn).toHaveBeenCalledWith(`No rooms found for ${cloudDevice.name}. Device may be sleeping.`);
    expect(log.warn).toHaveBeenCalledWith('Tip: Start a cleaning cycle to wake the device and fetch room data.');
    expect(log.error).toHaveBeenCalledWith(`Failed to register device ${cloudDevice.name}: Error: registration failed`);
    expect(log.info).toHaveBeenCalledWith('Registered 0 Mova vacuum(s)');
  });

  it('configures MQTT callbacks to update status, rooms, and persistent room cache', async () => {
    const { platform, cloud, log } = createPlatform({ refreshInterval: 120 });
    const saved = new Map<string, unknown>();
    (platform as any).context = {
      get: vi.fn(async (key: string) => saved.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        saved.set(key, value);
      }),
    };
    (platform as any).devices.set(cloudDevice.did, discoveredDevice);
    (platform as any).cloudDevices.set(cloudDevice.did, cloudDevice);
    cloud.connectMqtt.mockResolvedValueOnce(true);

    await platform.onConfigure();
    const statusCallback = cloud.onDeviceStatus.mock.calls[0]?.[1] as (status: DeviceStatus) => void;
    const roomCallback = cloud.onRoomUpdate.mock.calls[0]?.[1] as (rooms: RoomInfo[]) => void;
    const rooms: RoomInfo[] = [{ id: 11, name: 'Kitchen' }];

    statusCallback(activeStatus);
    roomCallback(rooms);
    await Promise.resolve();

    expect(cloud.connectMqtt).toHaveBeenCalledWith(cloudDevice);
    expect(log.info).toHaveBeenCalledWith(`MQTT connected for ${discoveredDevice.name}`);
    expect(discoveredDevice.updateStatus).toHaveBeenCalledWith(activeStatus);
    expect(discoveredDevice.updateRooms).toHaveBeenCalledWith(rooms);
    expect(saved.get('rooms_vacuum-1')).toEqual(rooms);

    vi.spyOn(platform as any, 'saveCachedRooms').mockRejectedValueOnce(new Error('cache failed'));
    roomCallback(rooms);
    await Promise.resolve();
    await Promise.resolve();
    expect(log.debug).toHaveBeenCalledWith('Failed to save rooms: Error: cache failed');
  });

  it('uses polling when MQTT is unavailable and repairs a missing device timer', async () => {
    const { platform, cloud, log } = createPlatform({ refreshInterval: 120 });
    (platform as any).devices.set(cloudDevice.did, discoveredDevice);
    (platform as any).cloudDevices.set(cloudDevice.did, cloudDevice);
    cloud.connectMqtt.mockResolvedValueOnce(false);

    await platform.onConfigure();
    await platform.onConfigure();

    expect(log.info).toHaveBeenCalledWith(`Using cloud polling for ${discoveredDevice.name}`);
    const existingTimer = (platform as any).devicePollingTimers.get(cloudDevice.did);
    clearTimeout(existingTimer);
    (platform as any).devicePollingTimers.delete(cloudDevice.did);

    await vi.advanceTimersByTimeAsync(120_000);

    expect((platform as any).devicePollingTimers.has(cloudDevice.did)).toBe(true);
    (platform as any).scheduleDevicePoll(cloudDevice.did, 120);
    expect((platform as any).devicePollingTimers.has(cloudDevice.did)).toBe(true);

    (platform as any).handleDeviceStatus('unknown-device', activeStatus);
    expect(discoveredDevice.updateStatus).not.toHaveBeenCalled();
  });

  it('polls active devices more frequently and idle devices less frequently', async () => {
    const { platform, cloud, log } = createPlatform({ refreshInterval: 120 });
    (platform as any).devices.set(cloudDevice.did, discoveredDevice);
    cloud.getDeviceProperties.mockResolvedValueOnce(activeStatus as never).mockResolvedValueOnce({ ...activeStatus, state: MovaState.Idle, status: MovaStatus.Idle } as never);

    await platform.onConfigure();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(discoveredDevice.updateStatus).toHaveBeenCalledWith(activeStatus);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(discoveredDevice.updateStatus).toHaveBeenCalledWith({ ...activeStatus, state: MovaState.Idle, status: MovaStatus.Idle });
    expect(log.info).toHaveBeenCalledWith('Device vacuum-1 state changed: polling interval now 120s (idle)');
  });

  it('reschedules polling after empty responses and request failures', async () => {
    const { platform, cloud, log } = createPlatform({ refreshInterval: 120 });
    (platform as any).devices.set(cloudDevice.did, discoveredDevice);
    cloud.getDeviceProperties.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline'));

    await platform.onConfigure();
    await vi.advanceTimersByTimeAsync(120_000);
    expect((platform as any).devicePollingTimers.has(cloudDevice.did)).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(log.error).toHaveBeenCalledWith('Failed to get status for vacuum-1: Error: offline');
    expect((platform as any).devicePollingTimers.has(cloudDevice.did)).toBe(true);
  });

  it('disconnects cloud, clears timers, and unregisters devices on shutdown when configured', async () => {
    const { platform, cloud } = createPlatform({ unregisterOnShutdown: true });
    (platform as any).devices.set(cloudDevice.did, discoveredDevice);

    await platform.onConfigure();
    expect((platform as any).statusInterval).not.toBeNull();
    expect((platform as any).devicePollingTimers.size).toBe(1);

    await platform.onShutdown('test');

    expect(cloud.disconnect).toHaveBeenCalled();
    expect(platform.unregisterAllDevices).toHaveBeenCalled();
    expect((platform as any).statusInterval).toBeNull();
    expect((platform as any).devicePollingTimers.size).toBe(0);
  });

  it('does not publish or reschedule an in-flight poll after shutdown', async () => {
    const { platform, cloud } = createPlatform({ refreshInterval: 120 });
    (platform as any).devices.set(cloudDevice.did, discoveredDevice);

    let resolveStatus: (status: DeviceStatus | null) => void = () => {};
    const pendingStatus = new Promise<DeviceStatus | null>((resolve) => {
      resolveStatus = resolve;
    });
    cloud.getDeviceProperties.mockReturnValueOnce(pendingStatus as never);

    await platform.onConfigure();
    vi.advanceTimersByTime(120_000);
    await platform.onShutdown('test');
    resolveStatus(activeStatus);
    await Promise.resolve();
    await Promise.resolve();

    expect(discoveredDevice.updateStatus).not.toHaveBeenCalled();
    expect((platform as any).devicePollingTimers.size).toBe(0);
    (platform as any).scheduleDevicePoll(cloudDevice.did, 120);
    expect((platform as any).devicePollingTimers.size).toBe(0);
  });
});
