/**
 * Mova vacuum device implementation with Matter 1.4 RVC clusters.
 *
 * @file mova.ts
 * @license Apache-2.0
 */

import { RoboticVacuumCleaner } from 'matterbridge/devices';

import type { MovaPlatform } from './platform.js';
import type { MovaCloudProtocol } from './movaCloud.js';
import type { MovaDevice, DeviceStatus, RoomInfo, MovaSuctionLevelName, MovaVacuumAndMopMode } from './types.js';
import { MovaState, MovaStatus, MovaCleaningMode, MovaFanSpeed } from './types.js';
import { getOperationalStateFromMova, getOperationalErrorFromMova } from './constants.js';

const BatChargeState = {
  Unknown: 0,
  IsCharging: 1,
  IsAtFullCharge: 2,
  IsNotCharging: 3,
} as const;

export interface MovaVacuumDevice {
  did: string;
  name: string;
  model: string;
  device: RoboticVacuumCleaner;
  updateStatus: (status: DeviceStatus) => void;
  updateRooms: (rooms: RoomInfo[]) => void;
}

// RVC Mode Tag constants
const RvcRunModeTag = {
  Idle: 16384,
  Cleaning: 16385,
  Mapping: 16386,
} as const;

const RvcCleanModeTag = {
  Vacuum: 16385,
  Mop: 16386,
} as const;

// RVC Operational State values (Matter 1.4)
const RvcOperationalStateValue = {
  Stopped: 0x00,
  Running: 0x01,
  Paused: 0x02,
  Error: 0x03,
  SeekingCharger: 0x40,
  Charging: 0x41,
  Docked: 0x42,
} as const;

const ServiceAreaType = {
  Room: 0,
} as const;

const RVC_RUN_MODES = [
  { label: 'Idle', mode: 0, modeTags: [{ value: RvcRunModeTag.Idle }] },
  { label: 'Cleaning', mode: 1, modeTags: [{ value: RvcRunModeTag.Cleaning }] },
  { label: 'Mapping', mode: 2, modeTags: [{ value: RvcRunModeTag.Mapping }] },
];

const RVC_CLEAN_MODES = [
  { label: 'Vacuum', mode: 0, modeTags: [{ value: RvcCleanModeTag.Vacuum }] },
  { label: 'Vacuum & Mop', mode: 1, modeTags: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Mop }] },
  { label: 'Mop Only', mode: 2, modeTags: [{ value: RvcCleanModeTag.Mop }] },
];

// operationalStateLabel must NOT be set for standard states (0-127) per Matter spec
const RVC_OPERATIONAL_STATES = [
  { operationalStateId: RvcOperationalStateValue.Stopped },
  { operationalStateId: RvcOperationalStateValue.Running },
  { operationalStateId: RvcOperationalStateValue.Paused },
  { operationalStateId: RvcOperationalStateValue.Error },
  { operationalStateId: RvcOperationalStateValue.SeekingCharger },
  { operationalStateId: RvcOperationalStateValue.Charging },
  { operationalStateId: RvcOperationalStateValue.Docked },
];

const CONFIG_SUCTION_LEVELS: Record<MovaSuctionLevelName, MovaFanSpeed> = {
  quiet: MovaFanSpeed.Quiet,
  standard: MovaFanSpeed.Standard,
  strong: MovaFanSpeed.Strong,
  turbo: MovaFanSpeed.Turbo,
};

function configuredSuctionLevel(value: unknown): MovaFanSpeed {
  if (typeof value === 'string' && value in CONFIG_SUCTION_LEVELS) {
    return CONFIG_SUCTION_LEVELS[value as MovaSuctionLevelName];
  }
  return MovaFanSpeed.Standard;
}

function configuredVacuumAndMopMode(value: unknown): MovaVacuumAndMopMode {
  return value === 'vac-then-mop' ? 'vac-then-mop' : 'vac-mop';
}

function rvcToMovaCleanMode(rvcMode: number, vacuumAndMopMode: MovaVacuumAndMopMode): MovaCleaningMode | undefined {
  if (rvcMode === 0) return MovaCleaningMode.SweepingAndMopping; // S70 raw 2 = vacuum only
  if (rvcMode === 1) return vacuumAndMopMode === 'vac-then-mop' ? MovaCleaningMode.MoppingAfterSweeping : MovaCleaningMode.Sweeping;
  if (rvcMode === 2) return MovaCleaningMode.Mopping;
  return undefined;
}

function movaToRvcCleanMode(cleaningMode: MovaCleaningMode): number {
  if (cleaningMode === MovaCleaningMode.SweepingAndMopping) return 0;
  if (cleaningMode === MovaCleaningMode.Mopping) return 2;
  return 1;
}

/**
 * Discover and register Mova vacuum as Matter RVC device.
 *
 * @param platform
 * @param cloud
 * @param device
 * @param rooms
 * @param initialStatus
 */
export async function discoverAndRegisterDevices(
  platform: MovaPlatform,
  cloud: MovaCloudProtocol,
  device: MovaDevice,
  rooms: RoomInfo[],
  initialStatus: DeviceStatus | null,
): Promise<MovaVacuumDevice | null> {
  const { log } = platform;
  const suctionLevel = configuredSuctionLevel(platform.config.suctionLevel);
  const vacuumAndMopMode = configuredVacuumAndMopMode(platform.config.vacuumAndMopMode);

  log.info(`Creating Matter RVC device for ${device.name} (${device.model})`);

  // Generate service areas from rooms
  // Note: mapId must be null when supportedMaps is empty (Matter spec requirement)
  const supportedAreas =
    rooms.length > 0
      ? rooms.map((room) => ({
          areaId: room.id,
          mapId: null, // Must be null when supportedMaps is empty
          areaInfo: {
            locationInfo: {
              locationName: room.name,
              floorNumber: room.floorId ?? null,
              areaType: ServiceAreaType.Room,
            },
            landmarkInfo: null,
          },
        }))
      : [
          // Default area if no rooms available
          {
            areaId: 1,
            mapId: null,
            areaInfo: {
              locationInfo: {
                locationName: 'Home',
                floorNumber: null,
                areaType: ServiceAreaType.Room,
              },
              landmarkInfo: null,
            },
          },
        ];
  let supportedAreaIds = supportedAreas.map((area) => area.areaId);
  const initialSelectedAreas = [...supportedAreaIds];

  // Determine initial operational state
  const initialOperationalState = initialStatus ? getOperationalStateFromMova(initialStatus.state, initialStatus.status) : RvcOperationalStateValue.Docked;

  // Determine initial run mode from status (must match logic in updateStatus)
  // Definitive dock statuses override any stale state values
  const definitiveDockedStatuses = [MovaStatus.Charging, MovaStatus.ChargingComplete, MovaStatus.Sleeping, MovaStatus.Standby, MovaStatus.Idle];
  let initialRunMode = 0; // Idle
  if (initialStatus && !definitiveDockedStatuses.includes(initialStatus.status)) {
    const activeCleaningStates = [MovaState.Cleaning, MovaState.Mopping, MovaState.ManualCleaning, MovaState.ZonedCleaning, MovaState.SpotCleaning, MovaState.CruiseRunning];
    const activeCleaningStatuses = [
      MovaStatus.Sweeping,
      MovaStatus.Mopping,
      MovaStatus.SweepingAndMopping,
      MovaStatus.SegmentCleaning,
      MovaStatus.ZoneCleaning,
      MovaStatus.SpotCleaning,
    ];
    if (activeCleaningStates.includes(initialStatus.state) || activeCleaningStatuses.includes(initialStatus.status)) {
      initialRunMode = 1; // Cleaning
    } else if (initialStatus.state === MovaState.FastMapping || initialStatus.status === MovaStatus.FastMapping) {
      initialRunMode = 2; // Mapping
    }
  }

  // Create the RVC device using RoboticVacuumCleaner class
  // Use 'server' mode for Apple Home compatibility
  const rvc = new RoboticVacuumCleaner(
    device.name, // name
    device.did, // serial
    'server', // mode - server for Apple Home compatibility
    initialRunMode, // currentRunMode - computed from initial status
    RVC_RUN_MODES, // supportedRunModes
    0, // currentCleanMode (Vacuum)
    RVC_CLEAN_MODES, // supportedCleanModes
    null, // currentPhase
    null, // phaseList
    initialOperationalState, // operationalState
    RVC_OPERATIONAL_STATES, // operationalStateList
    supportedAreas, // supportedAreas
    initialSelectedAreas, // selectedAreas
    null, // currentArea
    [], // supportedMaps
  );

  // Set additional identifiers
  rvc.uniqueId = device.did;

  // State tracking for updates
  let trackedRunMode = initialRunMode;
  let trackedCleanMode = 0; // Vacuum
  let trackedOperationalState = initialOperationalState;
  let trackedError: number | null | undefined = undefined; // undefined = not yet set
  let selectedAreas: number[] = [...initialSelectedAreas];

  function normalizeSelectedAreas(areas: number[] | undefined): number[] {
    if (!areas) {
      return [...supportedAreaIds];
    }
    if (areas.length === 0) {
      return [...supportedAreaIds];
    }

    return Array.from(new Set(areas));
  }

  function isWholeHomeSelection(areas: number[]): boolean {
    return supportedAreaIds.length > 0 && areas.length === supportedAreaIds.length && supportedAreaIds.every((id) => areas.includes(id));
  }

  // ============================================================================
  // Command Handlers
  // ============================================================================

  // Identify command (locate vacuum)
  rvc.addCommandHandler('identify', async () => {
    log.info(`Identify command for ${device.name}`);
    await cloud.locate(device.did);
  });

  // changeToMode command handler - shared by RvcRunMode and RvcCleanMode clusters
  // Matterbridge passes the cluster name (e.g., "rvcRunMode", "rvcCleanMode") to distinguish
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rvc.addCommandHandler('changeToMode', async (data: any) => {
    const newMode = data.request?.newMode ?? data.newMode;
    const clusterName = data.cluster as string | undefined;

    log.debug(`changeToMode: cluster=${clusterName}, newMode=${newMode}`);

    if (newMode === undefined) {
      log.warn(`changeToMode: newMode is undefined, cannot process command`);
      return;
    }

    // Matterbridge passes cluster name as string: "rvcRunMode" or "rvcCleanMode"
    const isRunMode = clusterName === 'rvcRunMode' || clusterName === undefined;
    const isCleanMode = clusterName === 'rvcCleanMode';

    if (isRunMode) {
      // RvcRunMode: Change running mode (Idle=0, Cleaning=1, Mapping=2)
      log.info(`RvcRunMode.changeToMode for ${device.name}: mode=${newMode}`);

      if (newMode === 0) {
        // Idle - Stop cleaning
        const success = await cloud.stopCleaning(device.did);
        if (success) {
          trackedRunMode = 0;
          rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
          rvc.setAttribute('ServiceArea', 'currentArea', null, log);
        }
      } else if (newMode === 1) {
        // Cleaning - Start cleaning
        const movaCleanMode = rvcToMovaCleanMode(trackedCleanMode, vacuumAndMopMode) ?? rvcToMovaCleanMode(0, vacuumAndMopMode)!;
        const cleanWholeHome = isWholeHomeSelection(selectedAreas);
        log.info(`Starting ${cleanWholeHome ? 'cleaning' : `rooms ${selectedAreas.join(', ')}`} with mode=${trackedCleanMode}, suction=${suctionLevel}`);

        const success = !cleanWholeHome
          ? await cloud.cleanRooms(device.did, selectedAreas, 1, movaCleanMode, suctionLevel)
          : await cloud.startCleaning(device.did, movaCleanMode, suctionLevel);
        if (success) {
          trackedRunMode = 1;
          rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
          trackedOperationalState = RvcOperationalStateValue.Running;
          rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
        }
      } else if (newMode === 2) {
        // Mapping - Not directly controllable via MIOT
        // Fast mapping must be initiated from the Mova app
        log.warn(`Mapping mode (2) cannot be started via Matter - use the Mova app to initiate mapping`);
      }
    } else if (isCleanMode) {
      // RvcCleanMode: Change cleaning mode (vacuum/mop selection)
      log.info(`RvcCleanMode.changeToMode for ${device.name}: mode=${newMode}`);

      if (rvcToMovaCleanMode(newMode, vacuumAndMopMode) === undefined) {
        log.warn(`Unsupported clean mode ${newMode}`);
        return;
      }

      // Reject mode changes while actively cleaning - Mova vacuums can't change mode mid-operation
      if (trackedOperationalState === RvcOperationalStateValue.Running) {
        log.warn(`Cannot change clean mode while actively cleaning - pause or stop first`);
        return; // Reject the mode change
      }

      // Update the tracked mode - will be applied when cleaning starts via cleanRooms()
      trackedCleanMode = newMode;
      rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
    }
  });

  // RvcOperationalState: Pause command
  rvc.addCommandHandler('pause', async () => {
    log.info(`Pause command for ${device.name}`);
    const success = await cloud.pauseCleaning(device.did);
    if (success) {
      // Set run mode to Idle and operational state to Paused
      trackedRunMode = 0; // Idle
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
      trackedOperationalState = RvcOperationalStateValue.Paused;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }
  });

  // RvcOperationalState: Resume command
  rvc.addCommandHandler('resume', async () => {
    log.info(`Resume command for ${device.name}`);
    const success = await cloud.resumeCleaning(device.did);
    if (success) {
      // Set run mode to Cleaning and operational state to Running
      trackedRunMode = 1; // Cleaning
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
      trackedOperationalState = RvcOperationalStateValue.Running;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }
  });

  // RvcOperationalState: GoHome command
  // Acts as a stop operation: stops cleaning first, then sends vacuum home
  rvc.addCommandHandler('goHome', async () => {
    log.info(`GoHome command for ${device.name} - stopping cleaning and returning to dock`);

    // Stop cleaning first (this halts any active cleaning operation)
    await cloud.stopCleaning(device.did);

    // Then send to dock
    const success = await cloud.goHome(device.did);
    if (success) {
      trackedRunMode = 0; // Idle
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
      trackedOperationalState = RvcOperationalStateValue.SeekingCharger;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
      rvc.setAttribute('ServiceArea', 'currentArea', null, log);
    }
  });

  // ServiceArea: SelectAreas command
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rvc.addCommandHandler('selectAreas', async (data: any) => {
    const areas: number[] | undefined = data.request?.newAreas ?? data.newAreas;
    const nextAreas = normalizeSelectedAreas(areas);

    selectedAreas = nextAreas;
    log.info(`SelectAreas command for ${device.name}: ${isWholeHomeSelection(selectedAreas) ? 'all rooms' : selectedAreas.join(', ')}`);
    rvc.setAttribute('ServiceArea', 'selectedAreas', selectedAreas, log);
  });

  // ============================================================================
  // Status Update Handler
  // ============================================================================

  /**
   *
   * @param status
   */
  function updateStatus(status: DeviceStatus): void {
    // Update operational state
    const newOperationalState = getOperationalStateFromMova(status.state, status.status);
    if (newOperationalState !== trackedOperationalState) {
      log.info(`Operational state: ${trackedOperationalState} -> ${newOperationalState} (state=${status.state}, status=${status.status})`);
      trackedOperationalState = newOperationalState;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }

    // Update run mode based on state and status
    // IMPORTANT: Check definitive dock statuses FIRST - these override stale state values
    // The device may report state=ManualCleaning while status=Charging when idle at dock
    let newRunMode = 0; // Idle
    const definitiveDockedStatuses = [MovaStatus.Charging, MovaStatus.ChargingComplete, MovaStatus.Sleeping, MovaStatus.Standby, MovaStatus.Idle];

    if (!definitiveDockedStatuses.includes(status.status)) {
      // Only check for active cleaning if NOT at dock
      const activeCleaningStates = [MovaState.Cleaning, MovaState.Mopping, MovaState.ManualCleaning, MovaState.ZonedCleaning, MovaState.SpotCleaning, MovaState.CruiseRunning];
      const activeCleaningStatuses = [
        MovaStatus.Sweeping,
        MovaStatus.Mopping,
        MovaStatus.SweepingAndMopping,
        MovaStatus.SegmentCleaning,
        MovaStatus.ZoneCleaning,
        MovaStatus.SpotCleaning,
      ];

      if (activeCleaningStates.includes(status.state) || activeCleaningStatuses.includes(status.status)) {
        newRunMode = 1; // Cleaning
      } else if (status.state === MovaState.FastMapping || status.status === MovaStatus.FastMapping) {
        newRunMode = 2; // Mapping - only for explicit fast mapping mode (user-initiated)
      }
    }
    if (newRunMode !== trackedRunMode) {
      log.info(`Run mode: ${trackedRunMode} -> ${newRunMode} (state=${status.state}, status=${status.status})`);
      trackedRunMode = newRunMode;
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
    }

    // Update error state (Matter requires operationalError to always be set)
    const newError = getOperationalErrorFromMova(status.errorCode);
    if (newError !== trackedError) {
      trackedError = newError;
      // errorStateId 0 = NoError, always set this attribute
      const errorStateId = trackedError ?? 0;
      rvc.setAttribute('RvcOperationalState', 'operationalError', { errorStateId }, log);
    }

    // Update battery level and charging state (skip 0% - likely from partial MQTT update without battery data)
    if (status.battery > 0) {
      try {
        rvc.setAttribute('PowerSource', 'batPercentRemaining', status.battery * 2, log); // Matter uses 0-200

        // Set charging state based on MovaState AND MovaStatus
        // Device may report state=DustBagDryingPaused but status=Charging
        let chargeState: number = BatChargeState.Unknown;
        const isCharging = status.state === MovaState.Charging || status.status === MovaStatus.Charging;
        const isChargingComplete = status.status === MovaStatus.ChargingComplete;

        if (isCharging || isChargingComplete) {
          chargeState = status.battery >= 100 ? BatChargeState.IsAtFullCharge : BatChargeState.IsCharging;
        } else if ((status.state === MovaState.Idle || status.state === MovaState.Dormant || status.state === MovaState.Sleeping) && status.battery >= 100) {
          chargeState = BatChargeState.IsAtFullCharge;
        } else {
          chargeState = BatChargeState.IsNotCharging;
        }
        rvc.setAttribute('PowerSource', 'batChargeState', chargeState, log);
        log.debug(`Battery: ${status.battery}%, state: ${status.state}, status: ${status.status}, chargeState: ${chargeState}`);
      } catch {
        // PowerSource may not be available
      }
    }

    if (status.cleaningMode !== undefined) {
      const newCleanMode = movaToRvcCleanMode(status.cleaningMode);
      if (newCleanMode !== trackedCleanMode) {
        trackedCleanMode = newCleanMode;
        rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
      }
    } else if (trackedCleanMode === undefined) {
      trackedCleanMode = 0;
      rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
    }

    // Update current area if cleaning
    try {
      rvc.setAttribute('ServiceArea', 'currentArea', status.currentArea ?? null, log);
    } catch {
      // ServiceArea may not be supported
    }
  }

  // ============================================================================
  // Room Update Handler
  // ============================================================================

  /**
   *
   * @param newRooms
   */
  function updateRooms(newRooms: RoomInfo[]): void {
    if (newRooms.length === 0) {
      return;
    }

    log.info(`Updating ServiceArea with ${newRooms.length} rooms: ${newRooms.map((r) => r.name).join(', ')}`);

    // Generate new service areas from rooms
    // Note: mapId must be null when supportedMaps is empty (Matter spec requirement)
    const newSupportedAreas = newRooms.map((room) => ({
      areaId: room.id,
      mapId: null, // Must be null when supportedMaps is empty
      areaInfo: {
        locationInfo: {
          locationName: room.name,
          floorNumber: room.floorId ?? null,
          areaType: ServiceAreaType.Room,
        },
        landmarkInfo: null,
      },
    }));
    supportedAreaIds = newSupportedAreas.map((area) => area.areaId);

    if (selectedAreas.length > 0) {
      selectedAreas = selectedAreas.filter((areaId) => supportedAreaIds.includes(areaId));
    } else {
      selectedAreas = [...supportedAreaIds];
    }

    try {
      rvc.setAttribute('ServiceArea', 'supportedAreas', newSupportedAreas, log);
      rvc.setAttribute('ServiceArea', 'selectedAreas', selectedAreas, log);
      log.info(`ServiceArea updated successfully with ${newRooms.length} rooms`);
    } catch (error) {
      log.error(`Failed to update ServiceArea: ${error}`);
    }
  }

  // ============================================================================
  // Register Device
  // ============================================================================

  try {
    await platform.registerDevice(rvc);
    log.info(`Registered ${device.name} as Matter RVC device with full cluster support`);

    // Force-set operational state and run mode to override any persisted values from previous sessions
    // This is critical because matterbridge persists attribute values, and our tracking
    // variables won't know about stale persisted values
    rvc.setAttribute('RvcOperationalState', 'operationalState', initialOperationalState, log);
    log.info(`Set initial operational state to ${initialOperationalState} (0=Stopped, 1=Running, 2=Paused, 3=Error, 64=SeekingCharger, 65=Charging, 66=Docked)`);

    rvc.setAttribute('RvcRunMode', 'currentMode', initialRunMode, log);
    log.info(`Set initial run mode to ${initialRunMode} (0=Idle, 1=Cleaning, 2=Mapping)`);

    rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
    log.info(`Set initial clean mode to ${trackedCleanMode} (0=Vacuum, 1=Vacuum&Mop, 2=MopOnly)`);

    // Set initial error state (required by Matter - must always be set)
    const initialError = initialStatus ? getOperationalErrorFromMova(initialStatus.errorCode) : null;
    rvc.setAttribute('RvcOperationalState', 'operationalError', { errorStateId: initialError ?? 0 }, log);

    // Set initial status AFTER device is registered (endpoint must be active)
    if (initialStatus) {
      updateStatus(initialStatus);
    }

    return {
      did: device.did,
      name: device.name,
      model: device.model,
      device: rvc,
      updateStatus,
      updateRooms,
    };
  } catch (error) {
    log.error(`Failed to register device ${device.name}: ${error}`);
    return null;
  }
}
