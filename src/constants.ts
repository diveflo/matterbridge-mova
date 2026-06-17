/**
 * Constants and mappings for the Matterbridge MOVA plugin.
 * Includes Mova state mappings and cloud API constants.
 *
 * @file constants.ts
 * @license Apache-2.0
 */

import { MovaState, MovaStatus, MovaErrorCode, type MiotProperty, type MiotAction } from './types.js';

// RVC Operational State IDs (Matter 1.4)
const RvcOperationalStateId = {
  Stopped: 0x00,
  Running: 0x01,
  Paused: 0x02,
  Error: 0x03,
  SeekingCharger: 0x40,
  Charging: 0x41,
  Docked: 0x42,
} as const;

// RVC Operational Error IDs (Matter 1.4)
const RvcOperationalErrorId = {
  NoError: 0,
  UnableToStartOrResume: 1,
  UnableToCompleteOperation: 2,
  CommandInvalidInState: 3,
  FailedToFindChargingDock: 64,
  Stuck: 65,
  DustBinMissing: 66,
  DustBinFull: 67,
  WaterTankEmpty: 68,
  WaterTankMissing: 69,
  WaterTankLidOpen: 70,
  MopCleaningPadMissing: 71,
} as const;

// Mova State to Matter Operational State mapping
const movaStateToOperationalState: Partial<Record<MovaState, number>> = {
  [MovaState.Unknown]: RvcOperationalStateId.Stopped,
  [MovaState.Idle]: RvcOperationalStateId.Docked,
  [MovaState.Paused]: RvcOperationalStateId.Paused,
  [MovaState.Cleaning]: RvcOperationalStateId.Running,
  [MovaState.GoCharging]: RvcOperationalStateId.SeekingCharger,
  [MovaState.Error]: RvcOperationalStateId.Error,
  [MovaState.Mopping]: RvcOperationalStateId.Running,
  [MovaState.Charging]: RvcOperationalStateId.Charging,
  [MovaState.Drying]: RvcOperationalStateId.Docked,
  [MovaState.Dormant]: RvcOperationalStateId.Docked,
  [MovaState.Washing]: RvcOperationalStateId.Docked,
  [MovaState.Returning]: RvcOperationalStateId.SeekingCharger,
  [MovaState.Defecating]: RvcOperationalStateId.Docked,
  [MovaState.Building]: RvcOperationalStateId.Running,
  [MovaState.ManualCleaning]: RvcOperationalStateId.Running,
  [MovaState.Sleeping]: RvcOperationalStateId.Docked,
  [MovaState.WaitingForTask]: RvcOperationalStateId.Docked,
  [MovaState.StationPaused]: RvcOperationalStateId.Paused,
  [MovaState.ManualPaused]: RvcOperationalStateId.Paused,
  [MovaState.ZonedPaused]: RvcOperationalStateId.Paused,
  [MovaState.ZonedCleaning]: RvcOperationalStateId.Running,
  [MovaState.SpotCleaning]: RvcOperationalStateId.Running,
  [MovaState.FastMapping]: RvcOperationalStateId.Running,
  [MovaState.CruiseWaiting]: RvcOperationalStateId.Docked,
  [MovaState.CruiseRunning]: RvcOperationalStateId.Running,
  [MovaState.SecondCleaning]: RvcOperationalStateId.Running,
  [MovaState.HumanFollowing]: RvcOperationalStateId.Running,
  [MovaState.SpotCleaningPaused]: RvcOperationalStateId.Paused,
  [MovaState.ReturningAutoEmpty]: RvcOperationalStateId.SeekingCharger,
  [MovaState.CleaningAutoEmpty]: RvcOperationalStateId.Running,
  [MovaState.StationCleaning]: RvcOperationalStateId.Docked,
  [MovaState.ReturningToDrain]: RvcOperationalStateId.SeekingCharger,
  [MovaState.Draining]: RvcOperationalStateId.Docked,
  [MovaState.AutoWaterDraining]: RvcOperationalStateId.Docked,
  [MovaState.Emptying]: RvcOperationalStateId.Docked,
  [MovaState.DustBagDrying]: RvcOperationalStateId.Docked,
  [MovaState.DustBagDryingPaused]: RvcOperationalStateId.Paused,
  [MovaState.HeadingToExtraCleaning]: RvcOperationalStateId.Running,
  [MovaState.ExtraCleaning]: RvcOperationalStateId.Running,
  [MovaState.FindingPetPaused]: RvcOperationalStateId.Paused,
  [MovaState.FindingPet]: RvcOperationalStateId.Running,
  [MovaState.Shortcut]: RvcOperationalStateId.Running,
  [MovaState.Monitoring]: RvcOperationalStateId.Running,
  [MovaState.MonitoringPaused]: RvcOperationalStateId.Paused,
  [MovaState.InitialDeepCleaning]: RvcOperationalStateId.Running,
  [MovaState.InitialDeepCleaningPaused]: RvcOperationalStateId.Paused,
  [MovaState.Sanitizing]: RvcOperationalStateId.Running,
  [MovaState.SanitizingWithDry]: RvcOperationalStateId.Running,
};

// Mova Status to Matter Operational State mapping
const movaStatusToOperationalState: Partial<Record<MovaStatus, number>> = {
  [MovaStatus.Unknown]: RvcOperationalStateId.Stopped,
  [MovaStatus.Idle]: RvcOperationalStateId.Docked,
  [MovaStatus.Paused]: RvcOperationalStateId.Paused,
  [MovaStatus.Cleaning]: RvcOperationalStateId.Running,
  [MovaStatus.BackHome]: RvcOperationalStateId.SeekingCharger,
  [MovaStatus.PartCleaning]: RvcOperationalStateId.Running,
  [MovaStatus.FollowWall]: RvcOperationalStateId.Running,
  [MovaStatus.Charging]: RvcOperationalStateId.Charging,
  [MovaStatus.OTA]: RvcOperationalStateId.Stopped,
  [MovaStatus.FCT]: RvcOperationalStateId.Stopped,
  [MovaStatus.WifiSet]: RvcOperationalStateId.Stopped,
  [MovaStatus.PowerOff]: RvcOperationalStateId.Stopped,
  [MovaStatus.Factory]: RvcOperationalStateId.Stopped,
  [MovaStatus.Error]: RvcOperationalStateId.Error,
  [MovaStatus.RemoteControl]: RvcOperationalStateId.Running,
  [MovaStatus.Sleeping]: RvcOperationalStateId.Docked,
  [MovaStatus.SelfRepair]: RvcOperationalStateId.Running,
  [MovaStatus.FactoryTest]: RvcOperationalStateId.Stopped,
  [MovaStatus.Standby]: RvcOperationalStateId.Docked,
  [MovaStatus.SegmentCleaning]: RvcOperationalStateId.Running,
  [MovaStatus.ZoneCleaning]: RvcOperationalStateId.Running,
  [MovaStatus.SpotCleaning]: RvcOperationalStateId.Running,
  [MovaStatus.FastMapping]: RvcOperationalStateId.Running,
  [MovaStatus.CruisingPath]: RvcOperationalStateId.Running,
  [MovaStatus.CruisingPoint]: RvcOperationalStateId.Running,
  [MovaStatus.SummonClean]: RvcOperationalStateId.Running,
  [MovaStatus.Shortcut]: RvcOperationalStateId.Running,
  [MovaStatus.PersonFollow]: RvcOperationalStateId.Running,
  [MovaStatus.WaterCheck]: RvcOperationalStateId.Docked,
  [MovaStatus.Sweeping]: RvcOperationalStateId.Running,
  [MovaStatus.Mopping]: RvcOperationalStateId.Running,
  [MovaStatus.SweepingAndMopping]: RvcOperationalStateId.Running,
  [MovaStatus.Drying]: RvcOperationalStateId.Docked,
  [MovaStatus.Washing]: RvcOperationalStateId.Docked,
  [MovaStatus.ReturningWashing]: RvcOperationalStateId.SeekingCharger,
  [MovaStatus.Building]: RvcOperationalStateId.Running,
  [MovaStatus.ChargingComplete]: RvcOperationalStateId.Docked,
  [MovaStatus.Upgrading]: RvcOperationalStateId.Stopped,
  [MovaStatus.CleanSummarizing]: RvcOperationalStateId.Docked,
  [MovaStatus.StationReset]: RvcOperationalStateId.Docked,
  [MovaStatus.ReturningDrain]: RvcOperationalStateId.SeekingCharger,
  [MovaStatus.SelfRepairing]: RvcOperationalStateId.Running,
  [MovaStatus.SelfWashing]: RvcOperationalStateId.Docked,
  [MovaStatus.BackWashing]: RvcOperationalStateId.Docked,
  [MovaStatus.SelfRefresh]: RvcOperationalStateId.Docked,
  [MovaStatus.SelfDrying]: RvcOperationalStateId.Docked,
  [MovaStatus.WaterCheckStart]: RvcOperationalStateId.Docked,
  [MovaStatus.WaterDraining]: RvcOperationalStateId.Docked,
  [MovaStatus.DryingStart]: RvcOperationalStateId.Docked,
  [MovaStatus.AutoEmptying]: RvcOperationalStateId.Docked,
  [MovaStatus.FillingWater]: RvcOperationalStateId.Docked,
};

// Mova Error Code to Matter Operational Error mapping
const movaErrorToOperationalError: Partial<Record<MovaErrorCode, number | null>> = {
  [MovaErrorCode.None]: null,
  [MovaErrorCode.Drop]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.Cliff]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.Bumper]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.Gesture]: RvcOperationalErrorId.UnableToStartOrResume,
  [MovaErrorCode.BumperRepeat]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.DropRepeat]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.OpticalFlow]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.NoBox]: RvcOperationalErrorId.DustBinMissing,
  [MovaErrorCode.NoTankBox]: RvcOperationalErrorId.WaterTankMissing,
  [MovaErrorCode.WaterBoxEmpty]: RvcOperationalErrorId.WaterTankEmpty,
  [MovaErrorCode.BoxFull]: RvcOperationalErrorId.DustBinFull,
  [MovaErrorCode.Brush]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.SideBrush]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.Fan]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.LeftWheelMotor]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.RightWheelMotor]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.TurnSuffocate]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.ForwardSuffocate]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.ChargerGet]: RvcOperationalErrorId.FailedToFindChargingDock,
  [MovaErrorCode.BatteryLow]: RvcOperationalErrorId.UnableToStartOrResume,
  [MovaErrorCode.ChargeFault]: RvcOperationalErrorId.UnableToStartOrResume,
  [MovaErrorCode.BatteryPercentage]: RvcOperationalErrorId.UnableToStartOrResume,
  [MovaErrorCode.Heart]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.CameraOcclusion]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.CameraFault]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.EventBattery]: RvcOperationalErrorId.UnableToStartOrResume,
  [MovaErrorCode.ForwardLooking]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.Gyroscope]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.WheelJammed]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.DirtyTankFull]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.DirtyTankMissing]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.WaterTankLidOpen]: RvcOperationalErrorId.WaterTankLidOpen,
  [MovaErrorCode.MopPadMissing]: RvcOperationalErrorId.MopCleaningPadMissing,
  [MovaErrorCode.FilterBlocked]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.StationDisconnected]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.NavigationBlocked]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.CannotReachArea]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.DustBagFull]: RvcOperationalErrorId.DustBinFull,
  [MovaErrorCode.DustBagMissing]: RvcOperationalErrorId.DustBinMissing,
  [MovaErrorCode.WaterPump]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.CleanTankMissing]: RvcOperationalErrorId.WaterTankMissing,
  [MovaErrorCode.LidarBlocked]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.RouteBlocked]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.MainBrushJammed]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.SideBrushJammed]: RvcOperationalErrorId.Stuck,
  [MovaErrorCode.FilterClogged]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.DustBinNotInstalled]: RvcOperationalErrorId.DustBinMissing,
  [MovaErrorCode.StationWaterEmpty]: RvcOperationalErrorId.WaterTankEmpty,
  [MovaErrorCode.StationWaterDirty]: RvcOperationalErrorId.UnableToCompleteOperation,
  [MovaErrorCode.StationDustFull]: RvcOperationalErrorId.DustBinFull,
  [MovaErrorCode.ReturnFailed]: RvcOperationalErrorId.FailedToFindChargingDock,
};

// MIOT Property IDs (siid/piid pairs)
export const MIOT_PROPERTIES = {
  operatingMode: { siid: 2, piid: 1 } as MiotProperty,
  deviceFault: { siid: 2, piid: 2 } as MiotProperty,
  batteryLevel: { siid: 3, piid: 1 } as MiotProperty,
  chargingState: { siid: 3, piid: 2 } as MiotProperty,
  deviceStatus: { siid: 4, piid: 1 } as MiotProperty,
  suctionLevel: { siid: 4, piid: 4 } as MiotProperty,
  waterFlow: { siid: 4, piid: 5 } as MiotProperty,
  cleaningMode: { siid: 4, piid: 23 } as MiotProperty,
  selfWashBaseStatus: { siid: 4, piid: 25 } as MiotProperty,
  waterTankInstalled: { siid: 5, piid: 1 } as MiotProperty,
  mopPadInstalled: { siid: 5, piid: 2 } as MiotProperty,
  dustCollectionStatus: { siid: 9, piid: 1 } as MiotProperty,
  cleanWaterTankStatus: { siid: 9, piid: 2 } as MiotProperty,
  dirtyWaterTankStatus: { siid: 9, piid: 3 } as MiotProperty,
};

// MIOT Action IDs (siid/aiid pairs)
export const MIOT_ACTIONS = {
  startClean: { siid: 2, aiid: 1 } as MiotAction,
  pauseClean: { siid: 2, aiid: 2 } as MiotAction,
  charge: { siid: 3, aiid: 1 } as MiotAction,
  startCustom: { siid: 4, aiid: 1 } as MiotAction,
  stopClean: { siid: 4, aiid: 2 } as MiotAction,
  clearWarning: { siid: 4, aiid: 3 } as MiotAction,
  requestMap: { siid: 6, aiid: 1 } as MiotAction,
  locate: { siid: 7, aiid: 1 } as MiotAction,
};

// Action parameter IDs for START_CUSTOM
export const MIOT_ACTION_PARAMS = {
  status: 1,
  cleaningProperties: 10,
};

// Status values for START_CUSTOM action
export const MOVA_STATUS_VALUES = {
  segmentCleaning: 18,
};

// Mova Cloud API configuration
const MOVA_API_DOMAIN = '.iot.mova-tech.com';
const MOVA_API_PORT = '13267';
const MOVA_USER_AGENT = 'Mova_Smarthome/1.2.4 (iPhone; iOS 18.4.1; Scale/3.00)';
const MOVA_TENANT_ID = '000002';

export const MOVA_AUTH_HEADER = 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=';
export const MOVA_PASSWORD_SALT = 'RAylYC%fmSKp7%Tq';
export const MOVA_CLIENT_ID = 'dreame_appv1';

export const MOVA_AUTH_ENDPOINT = '/dreame-auth/oauth/token';
export const MOVA_DEVICE_LIST_ENDPOINT = '/dreame-user-iot/iotuserbind/device/listV2';
export const MOVA_GET_DEVICE_DATA_ENDPOINT = '/dreame-user-iot/iotuserdata/getDeviceData';
export const MOVA_OSS_DOWNLOAD_ENDPOINT = '/dreame-user-iot/iotfile/getOss1dDownloadUrl';
export const MOVA_DOWNLOAD_ENDPOINT = '/dreame-user-iot/iotfile/getDownloadUrl';

export function getMovaSendCommandEndpoint(bindDomain?: string): string {
  const shard = bindDomain?.split('.', 1)[0] || 'eu';
  return `/dreame-iot-com-${shard}/device/sendCommand`;
}

export function getMovaApiUrl(country: string): string {
  return `https://${country}${MOVA_API_DOMAIN}:${MOVA_API_PORT}`;
}

export function getMovaUserAgent(): string {
  return MOVA_USER_AGENT;
}

export function getMovaTenantId(): string {
  return MOVA_TENANT_ID;
}

export function isSupportedModel(model: string): boolean {
  return model.startsWith('mova.vacuum');
}

// Statuses that definitively indicate device is at dock (override stale state values)
const definitiveDockedStatuses = new Set([
  MovaStatus.Charging,
  MovaStatus.ChargingComplete,
  MovaStatus.Sleeping,
  MovaStatus.Standby,
  MovaStatus.Idle,
  MovaStatus.Drying,
  MovaStatus.Washing,
  MovaStatus.SelfWashing,
  MovaStatus.SelfDrying,
  MovaStatus.AutoEmptying,
  MovaStatus.FillingWater,
]);

// States that indicate active operations away from dock
const activeOperationStates = new Set([
  MovaState.Cleaning,
  MovaState.Mopping,
  MovaState.ZonedCleaning,
  MovaState.SpotCleaning,
  MovaState.ManualCleaning,
  MovaState.CruiseRunning,
  MovaState.Building,
  MovaState.FastMapping,
  MovaState.Returning,
  MovaState.GoCharging,
]);

const highConfidenceCleaningStates = new Set([MovaState.Cleaning, MovaState.Mopping]);

/**
 * Map Mova state/status to Matter RVC operational state.
 * Prioritizes paused status, definitive dock statuses, then checks for active operations.
 */
export function getOperationalStateFromMova(state: MovaState, status: MovaStatus): number {
  const stateMapping = movaStateToOperationalState[state];
  const statusMapping = movaStatusToOperationalState[status];

  // Paused status takes priority - if vacuum reports paused, honor it
  if (status === MovaStatus.Paused) {
    return RvcOperationalStateId.Paused;
  }

  if (highConfidenceCleaningStates.has(state)) {
    return RvcOperationalStateId.Running;
  }

  // Dock statuses override stale state values (e.g., state=ManualCleaning but status=Charging)
  if (definitiveDockedStatuses.has(status) && statusMapping !== undefined) {
    return statusMapping;
  }

  if (activeOperationStates.has(state) && stateMapping !== undefined) {
    return stateMapping;
  }

  if (status !== MovaStatus.Unknown && statusMapping !== undefined) {
    return statusMapping;
  }

  if (stateMapping !== undefined) {
    return stateMapping;
  }

  if (state > 0 && state !== MovaState.Idle && state !== MovaState.Sleeping && state !== MovaState.Dormant) {
    return RvcOperationalStateId.Running;
  }

  return RvcOperationalStateId.Docked;
}

/**
 * Map Mova error code to Matter RVC operational error.
 * Error codes 43-99 are device-specific status codes and not treated as errors.
 */
export function getOperationalErrorFromMova(errorCode: MovaErrorCode): number | null {
  if (errorCode === MovaErrorCode.None) {
    return null;
  }

  if (errorCode in movaErrorToOperationalError) {
    return movaErrorToOperationalError[errorCode] ?? null;
  }

  // Unknown codes 1-42 and 100+ are real errors; 43-99 are device-specific status codes
  const code = errorCode as number;
  if ((code >= 1 && code <= 42) || code >= 100) {
    return RvcOperationalErrorId.UnableToCompleteOperation;
  }

  return null;
}
