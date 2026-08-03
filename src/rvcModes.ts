/**
 * Matter RVC mode definitions and MOVA-to-Matter conversions.
 *
 * @file rvcModes.ts
 * @license Apache-2.0
 */

import type { MovaSuctionLevelName, MovaVacuumAndMopMode } from './types.js';
import { MovaCleaningMode, MovaFanSpeed, MovaState, MovaStatus } from './types.js';

export const BatChargeState = {
  Unknown: 0,
  IsCharging: 1,
  IsAtFullCharge: 2,
  IsNotCharging: 3,
} as const;

const RvcRunModeTag = {
  Idle: 16384,
  Cleaning: 16385,
  Mapping: 16386,
} as const;

const RvcCleanModeTag = {
  Quiet: 0x0002,
  Min: 0x0006,
  Max: 0x0007,
  DeepClean: 0x4000,
  Vacuum: 16385,
  Mop: 16386,
} as const;

export const RvcOperationalStateValue = {
  Stopped: 0x00,
  Running: 0x01,
  Paused: 0x02,
  Error: 0x03,
  SeekingCharger: 0x40,
  Charging: 0x41,
  Docked: 0x42,
} as const;

export const RvcRunModeValue = {
  Idle: 1,
  Cleaning: 2,
  Mapping: 3,
} as const;

export const SERVICE_AREA_ROOM_TYPE = 0;

export const RVC_RUN_MODES = [
  { label: 'Idle', mode: RvcRunModeValue.Idle, modeTags: [{ value: RvcRunModeTag.Idle }] },
  { label: 'Cleaning', mode: RvcRunModeValue.Cleaning, modeTags: [{ value: RvcRunModeTag.Cleaning }] },
  { label: 'Mapping', mode: RvcRunModeValue.Mapping, modeTags: [{ value: RvcRunModeTag.Mapping }] },
];

interface RvcCleanModeDefinition {
  label: string;
  mode: number;
  modeTags: Array<{ value: number }>;
  cleanMode: 'vac' | 'vac-mop' | 'mop';
  fanSpeed?: MovaFanSpeed;
}

const cleanModeTags = {
  vacuumQuiet: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Quiet }],
  vacuumStandard: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Min }],
  vacuumIntense: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Max }],
  vacuumMax: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.DeepClean }],
  vacuumAndMopQuiet: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Mop }, { value: RvcCleanModeTag.Quiet }],
  vacuumAndMopStandard: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Mop }, { value: RvcCleanModeTag.Min }],
  vacuumAndMopIntense: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Mop }, { value: RvcCleanModeTag.Max }],
  vacuumAndMopMax: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Mop }, { value: RvcCleanModeTag.DeepClean }],
  mop: [{ value: RvcCleanModeTag.Mop }],
};

const RVC_CLEAN_MODES: RvcCleanModeDefinition[] = [
  { label: 'Vacuum Quiet', mode: 0, modeTags: cleanModeTags.vacuumQuiet, cleanMode: 'vac', fanSpeed: MovaFanSpeed.Quiet },
  { label: 'Vacuum Standard', mode: 1, modeTags: cleanModeTags.vacuumStandard, cleanMode: 'vac', fanSpeed: MovaFanSpeed.Standard },
  { label: 'Vacuum Intense', mode: 2, modeTags: cleanModeTags.vacuumIntense, cleanMode: 'vac', fanSpeed: MovaFanSpeed.Intense },
  { label: 'Vacuum Max', mode: 3, modeTags: cleanModeTags.vacuumMax, cleanMode: 'vac', fanSpeed: MovaFanSpeed.Max },
  { label: 'Vacuum & Mop Quiet', mode: 4, modeTags: cleanModeTags.vacuumAndMopQuiet, cleanMode: 'vac-mop', fanSpeed: MovaFanSpeed.Quiet },
  { label: 'Vacuum & Mop Standard', mode: 5, modeTags: cleanModeTags.vacuumAndMopStandard, cleanMode: 'vac-mop', fanSpeed: MovaFanSpeed.Standard },
  { label: 'Vacuum & Mop Intense', mode: 6, modeTags: cleanModeTags.vacuumAndMopIntense, cleanMode: 'vac-mop', fanSpeed: MovaFanSpeed.Intense },
  { label: 'Vacuum & Mop Max', mode: 7, modeTags: cleanModeTags.vacuumAndMopMax, cleanMode: 'vac-mop', fanSpeed: MovaFanSpeed.Max },
  { label: 'Mop Only', mode: 8, modeTags: cleanModeTags.mop, cleanMode: 'mop' },
];

const cleanModeByMode = new Map(RVC_CLEAN_MODES.map((mode) => [mode.mode, mode]));

export const RVC_SUPPORTED_CLEAN_MODES = RVC_CLEAN_MODES.map(({ label, mode, modeTags }) => ({ label, mode, modeTags }));

// Standard states (0-127) must not have an operationalStateLabel.
export const RVC_OPERATIONAL_STATES = [
  { operationalStateId: RvcOperationalStateValue.Stopped },
  { operationalStateId: RvcOperationalStateValue.Running },
  { operationalStateId: RvcOperationalStateValue.Paused },
  { operationalStateId: RvcOperationalStateValue.Error },
  { operationalStateId: RvcOperationalStateValue.SeekingCharger },
  { operationalStateId: RvcOperationalStateValue.Charging },
  { operationalStateId: RvcOperationalStateValue.Docked },
];

const highConfidenceCleaningStates = new Set([MovaState.Cleaning, MovaState.Mopping]);
const activeCleaningStates = new Set([...highConfidenceCleaningStates, MovaState.ZonedCleaning, MovaState.SpotCleaning, MovaState.ManualCleaning, MovaState.CruiseRunning]);
const activeCleaningStatuses = new Set([
  MovaStatus.Cleaning,
  MovaStatus.Sweeping,
  MovaStatus.Mopping,
  MovaStatus.SweepingAndMopping,
  MovaStatus.SegmentCleaning,
  MovaStatus.ZoneCleaning,
  MovaStatus.SpotCleaning,
]);
const definitiveDockedStatuses = new Set([MovaStatus.Charging, MovaStatus.ChargingComplete, MovaStatus.Sleeping, MovaStatus.Standby, MovaStatus.Idle]);

const suctionLevels: Record<MovaSuctionLevelName, MovaFanSpeed> = {
  quiet: MovaFanSpeed.Quiet,
  standard: MovaFanSpeed.Standard,
  intense: MovaFanSpeed.Intense,
  max: MovaFanSpeed.Max,
};

export function configuredSuctionLevel(value: unknown): MovaFanSpeed {
  if (typeof value === 'string' && value in suctionLevels) return suctionLevels[value as MovaSuctionLevelName];
  return MovaFanSpeed.Standard;
}

export function configuredVacuumAndMopMode(value: unknown): MovaVacuumAndMopMode {
  return value === 'vac-then-mop' ? 'vac-then-mop' : 'vac-mop';
}

export function rvcToMovaCleanMode(rvcMode: number, vacuumAndMopMode: MovaVacuumAndMopMode): MovaCleaningMode | undefined {
  const mode = cleanModeByMode.get(rvcMode);
  if (!mode) return undefined;

  if (mode.cleanMode === 'vac') return MovaCleaningMode.SweepingAndMopping;
  if (mode.cleanMode === 'vac-mop') return vacuumAndMopMode === 'vac-then-mop' ? MovaCleaningMode.MoppingAfterSweeping : MovaCleaningMode.Sweeping;
  return MovaCleaningMode.Mopping;
}

export function rvcToMovaFanSpeed(rvcMode: number, fallback: MovaFanSpeed): MovaFanSpeed {
  return cleanModeByMode.get(rvcMode)?.fanSpeed ?? fallback;
}

function rvcCleanModeFor(cleanMode: RvcCleanModeDefinition['cleanMode'], fanSpeed: MovaFanSpeed): number {
  return RVC_CLEAN_MODES.find((entry) => entry.cleanMode === cleanMode && (entry.fanSpeed === fanSpeed || entry.fanSpeed === undefined))?.mode ?? 1;
}

export function defaultRvcCleanMode(fanSpeed: MovaFanSpeed): number {
  return rvcCleanModeFor('vac', fanSpeed);
}

export function movaToRvcCleanMode(cleaningMode: MovaCleaningMode, fanSpeed: MovaFanSpeed): number {
  if (cleaningMode === MovaCleaningMode.SweepingAndMopping) return rvcCleanModeFor('vac', fanSpeed);
  if (cleaningMode === MovaCleaningMode.Mopping) return rvcCleanModeFor('mop', fanSpeed);
  return rvcCleanModeFor('vac-mop', fanSpeed);
}

export function getRunModeFromMova(state: MovaState, status: MovaStatus): number {
  if (highConfidenceCleaningStates.has(state)) return RvcRunModeValue.Cleaning;
  if (definitiveDockedStatuses.has(status)) return RvcRunModeValue.Idle;
  if (activeCleaningStates.has(state) || activeCleaningStatuses.has(status)) return RvcRunModeValue.Cleaning;
  if (state === MovaState.FastMapping || status === MovaStatus.FastMapping) return RvcRunModeValue.Mapping;
  return RvcRunModeValue.Idle;
}

const operationalStateNames = new Map<number, string>([
  [RvcOperationalStateValue.Stopped, 'Stopped'],
  [RvcOperationalStateValue.Running, 'Running'],
  [RvcOperationalStateValue.Paused, 'Paused'],
  [RvcOperationalStateValue.Error, 'Error'],
  [RvcOperationalStateValue.SeekingCharger, 'SeekingCharger'],
  [RvcOperationalStateValue.Charging, 'Charging'],
  [RvcOperationalStateValue.Docked, 'Docked'],
]);

const runModeNames = new Map<number, string>([
  [RvcRunModeValue.Idle, 'Idle'],
  [RvcRunModeValue.Cleaning, 'Cleaning'],
  [RvcRunModeValue.Mapping, 'Mapping'],
]);

export function operationalStateName(value: number): string {
  return operationalStateNames.get(value) ?? `Unknown(${value})`;
}

export function runModeName(value: number): string {
  return runModeNames.get(value) ?? `Unknown(${value})`;
}
