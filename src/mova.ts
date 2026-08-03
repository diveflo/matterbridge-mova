/**
 * Mova vacuum device implementation with Matter 1.4 RVC clusters.
 *
 * @file mova.ts
 * @license Apache-2.0
 */

import { RoboticVacuumCleaner } from 'matterbridge/devices';

import type { MovaPlatform } from './platform.js';
import type { MovaCloudProtocol } from './movaCloud.js';
import type { MovaDevice, DeviceStatus, RoomInfo } from './types.js';
import { MovaState, MovaStatus, MovaCleaningMode } from './types.js';
import { getOperationalStateFromMova, getOperationalErrorFromMova } from './constants.js';
import {
  BatChargeState,
  RvcOperationalStateValue,
  RvcRunModeValue,
  RVC_OPERATIONAL_STATES,
  RVC_RUN_MODES,
  RVC_SUPPORTED_CLEAN_MODES,
  SERVICE_AREA_ROOM_TYPE,
  configuredSuctionLevel,
  configuredVacuumAndMopMode,
  defaultRvcCleanMode,
  getRunModeFromMova,
  movaToRvcCleanMode,
  operationalStateName,
  runModeName,
  rvcToMovaCleanMode,
  rvcToMovaFanSpeed,
} from './rvcModes.js';

export interface MovaVacuumDevice {
  did: string;
  name: string;
  model: string;
  device: RoboticVacuumCleaner;
  updateStatus: (status: DeviceStatus) => void;
  updateRooms: (rooms: RoomInfo[]) => void;
}

type MatterCommandData = Record<string, unknown>;

function asCommandData(value: unknown): MatterCommandData | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as MatterCommandData) : undefined;
}

function commandField(data: unknown, field: string): unknown {
  const command = asCommandData(data);
  const request = asCommandData(command?.request);
  return request?.[field] ?? command?.[field];
}

function commandCluster(data: unknown): string | undefined {
  const cluster = asCommandData(data)?.cluster;
  return typeof cluster === 'string' ? cluster : undefined;
}

function commandMode(data: unknown): number | undefined {
  const mode = commandField(data, 'newMode');
  return typeof mode === 'number' && Number.isSafeInteger(mode) ? mode : undefined;
}

function commandAreas(data: unknown): number[] | undefined | null {
  const areas = commandField(data, 'newAreas');
  if (areas === undefined) return undefined;
  if (!Array.isArray(areas) || !areas.every((area) => typeof area === 'number' && Number.isSafeInteger(area))) return null;
  return areas;
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
  const initialCleanMode = initialStatus
    ? movaToRvcCleanMode(initialStatus.cleaningMode ?? MovaCleaningMode.SweepingAndMopping, initialStatus.fanSpeed)
    : defaultRvcCleanMode(suctionLevel);

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
              areaType: SERVICE_AREA_ROOM_TYPE,
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
                areaType: SERVICE_AREA_ROOM_TYPE,
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
  const initialRunMode = initialStatus ? getRunModeFromMova(initialStatus.state, initialStatus.status) : RvcRunModeValue.Idle;

  // Create the RVC device using RoboticVacuumCleaner class
  // Use 'server' mode for Apple Home compatibility
  const rvc = new RoboticVacuumCleaner(
    device.name, // name
    device.did, // serial
    'server', // mode - server for Apple Home compatibility
    initialRunMode, // currentRunMode - computed from initial status
    RVC_RUN_MODES, // supportedRunModes
    initialCleanMode, // currentCleanMode
    RVC_SUPPORTED_CLEAN_MODES, // supportedCleanModes
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
  let trackedCleanMode = initialCleanMode;
  let trackedOperationalState = initialOperationalState;
  let trackedError: number | null | undefined = undefined; // undefined = not yet set
  let selectedAreas: number[] = [...initialSelectedAreas];
  let trackedCurrentArea: number | null = null;

  async function runOptimisticCloudCommand(description: string, command: () => Promise<boolean>, rollback: () => void): Promise<void> {
    try {
      const success = await command();
      if (success) return;
      log.warn(`${description} failed; reverting optimistic Matter state`);
    } catch (error) {
      log.error(`${description} failed: ${error}`);
    }

    try {
      rollback();
    } catch (error) {
      log.error(`${description} rollback failed: ${error}`);
    }
  }

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

  function currentAreaForSelection(areas: number[]): number | null {
    return areas[0] ?? supportedAreaIds[0] ?? null;
  }

  function setCurrentArea(area: number | null): void {
    trackedCurrentArea = area;
    rvc.setAttribute('ServiceArea', 'currentArea', trackedCurrentArea, log);
  }

  function setCurrentAreaAfterCommand(area: number | null): void {
    setTimeout(() => {
      setCurrentArea(area);
    }, 0);
  }

  function setOperationalStateAfterCommand(operationalState: number): void {
    setTimeout(() => {
      trackedOperationalState = operationalState;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }, 0);
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
  rvc.addCommandHandler('changeToMode', async (data: unknown) => {
    const newMode = commandMode(data);
    const clusterName = commandCluster(data);

    log.debug(`changeToMode: cluster=${clusterName}, newMode=${newMode}`);

    if (newMode === undefined) {
      log.warn(`changeToMode: newMode is undefined, cannot process command`);
      return;
    }

    // Matterbridge passes cluster name as string: "rvcRunMode" or "rvcCleanMode"
    const isRunMode = clusterName === 'rvcRunMode' || clusterName === undefined;
    const isCleanMode = clusterName === 'rvcCleanMode';

    if (isRunMode) {
      // RvcRunMode: Change running mode (Idle=1, Cleaning=2, Mapping=3)
      log.info(`RvcRunMode.changeToMode for ${device.name}: mode=${newMode}`);

      if (newMode === RvcRunModeValue.Idle) {
        // Idle - Stop cleaning
        const previousRunMode = trackedRunMode;
        const previousOperationalState = trackedOperationalState;
        const previousCurrentArea = trackedCurrentArea;

        trackedRunMode = RvcRunModeValue.Idle;
        trackedOperationalState = RvcOperationalStateValue.Docked;
        setCurrentAreaAfterCommand(null);

        await runOptimisticCloudCommand(
          `Stop cleaning for ${device.name}`,
          () => cloud.stopCleaning(device.did),
          () => {
            trackedRunMode = previousRunMode;
            rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
            trackedOperationalState = previousOperationalState;
            rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
            setCurrentArea(previousCurrentArea);
          },
        );
      } else if (newMode === RvcRunModeValue.Cleaning) {
        // Cleaning - Start cleaning
        const movaCleanMode = rvcToMovaCleanMode(trackedCleanMode, vacuumAndMopMode) ?? MovaCleaningMode.SweepingAndMopping;
        const movaFanSpeed = rvcToMovaFanSpeed(trackedCleanMode, suctionLevel);
        const cleanWholeHome = isWholeHomeSelection(selectedAreas);
        const targetAreas = [...selectedAreas];
        const targetCurrentArea = currentAreaForSelection(targetAreas);
        const previousRunMode = trackedRunMode;
        const previousOperationalState = trackedOperationalState;
        const previousCurrentArea = trackedCurrentArea;
        log.info(`Starting ${cleanWholeHome ? 'cleaning' : `rooms ${selectedAreas.join(', ')}`} with mode=${trackedCleanMode}, suction=${movaFanSpeed}`);

        trackedRunMode = RvcRunModeValue.Cleaning;
        trackedOperationalState = RvcOperationalStateValue.Running;
        setCurrentAreaAfterCommand(targetCurrentArea);

        await runOptimisticCloudCommand(
          `Start cleaning for ${device.name}`,
          () => (!cleanWholeHome ? cloud.cleanRooms(device.did, targetAreas, 1, movaCleanMode, movaFanSpeed) : cloud.startCleaning(device.did, movaCleanMode, movaFanSpeed)),
          () => {
            trackedRunMode = previousRunMode;
            rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
            trackedOperationalState = previousOperationalState;
            rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
            setCurrentArea(previousCurrentArea);
          },
        );
      } else if (newMode === RvcRunModeValue.Mapping) {
        // Mapping - Not directly controllable via MIOT
        // Fast mapping must be initiated from the Mova app
        log.warn(`Mapping mode (${RvcRunModeValue.Mapping}) cannot be started via Matter - use the Mova app to initiate mapping`);
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
      trackedRunMode = RvcRunModeValue.Idle;
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
      trackedRunMode = RvcRunModeValue.Cleaning;
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
      trackedOperationalState = RvcOperationalStateValue.Running;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }
  });

  // RvcOperationalState: GoHome command
  // Acts as a stop operation: stops cleaning first, then sends vacuum home
  rvc.addCommandHandler('goHome', async () => {
    log.info(`GoHome command for ${device.name} - stopping cleaning and returning to dock`);

    const previousRunMode = trackedRunMode;
    const previousOperationalState = trackedOperationalState;
    const previousCurrentArea = trackedCurrentArea;

    trackedRunMode = RvcRunModeValue.Idle;
    trackedOperationalState = RvcOperationalStateValue.SeekingCharger;
    setCurrentAreaAfterCommand(null);
    setOperationalStateAfterCommand(RvcOperationalStateValue.SeekingCharger);

    await runOptimisticCloudCommand(
      `Return to dock for ${device.name}`,
      async () => {
        // Stop cleaning first (this halts any active cleaning operation), then send to dock.
        await cloud.stopCleaning(device.did);
        return cloud.goHome(device.did);
      },
      () => {
        trackedRunMode = previousRunMode;
        rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
        trackedOperationalState = previousOperationalState;
        rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
        setCurrentArea(previousCurrentArea);
      },
    );
  });

  // ServiceArea: SelectAreas command
  rvc.addCommandHandler('selectAreas', async (data: unknown) => {
    const areas = commandAreas(data);
    if (areas === null) {
      log.warn(`SelectAreas command for ${device.name} ignored invalid area list`);
      return;
    }
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
    const newRunMode = getRunModeFromMova(status.state, status.status);
    const newCurrentArea = status.currentArea ?? (newRunMode === RvcRunModeValue.Cleaning ? currentAreaForSelection(selectedAreas) : null);
    log.info(
      `Status mapping for ${device.name}: MOVA state=${status.state}, status=${status.status}, currentArea=${status.currentArea ?? 'null'} -> Matter operationalState=${operationalStateName(newOperationalState)}(${newOperationalState}), runMode=${runModeName(newRunMode)}(${newRunMode}), currentArea=${newCurrentArea ?? 'null'}`,
    );

    if (newOperationalState !== trackedOperationalState) {
      log.info(`Operational state: ${trackedOperationalState} -> ${newOperationalState} (state=${status.state}, status=${status.status})`);
      trackedOperationalState = newOperationalState;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
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
      const newCleanMode = movaToRvcCleanMode(status.cleaningMode, status.fanSpeed);
      if (newCleanMode !== trackedCleanMode) {
        trackedCleanMode = newCleanMode;
        rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
      }
    } else if (trackedCleanMode === undefined) {
      trackedCleanMode = defaultRvcCleanMode(suctionLevel);
      rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
    }

    // Update current area if cleaning
    try {
      setCurrentArea(newCurrentArea);
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
          areaType: SERVICE_AREA_ROOM_TYPE,
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
    log.info(`Set initial run mode to ${initialRunMode} (1=Idle, 2=Cleaning, 3=Mapping)`);

    rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
    log.info(`Set initial clean mode to ${trackedCleanMode} (0-3=Vacuum suction, 4-7=Vacuum&Mop suction, 8=MopOnly)`);

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
