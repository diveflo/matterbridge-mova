import { describe, expect, it } from 'vitest';

import {
  RvcRunModeValue,
  configuredSuctionLevel,
  configuredVacuumAndMopMode,
  defaultRvcCleanMode,
  getRunModeFromMova,
  movaToRvcCleanMode,
  operationalStateName,
  runModeName,
  rvcToMovaCleanMode,
  rvcToMovaFanSpeed,
} from '../src/rvcModes.js';
import { MovaCleaningMode, MovaFanSpeed, MovaState, MovaStatus } from '../src/types.js';

describe('Matter RVC mode conversions', () => {
  it('applies safe configuration defaults', () => {
    expect(configuredSuctionLevel('quiet')).toBe(MovaFanSpeed.Quiet);
    expect(configuredSuctionLevel('unsupported')).toBe(MovaFanSpeed.Standard);
    expect(configuredVacuumAndMopMode('vac-then-mop')).toBe('vac-then-mop');
    expect(configuredVacuumAndMopMode('unsupported')).toBe('vac-mop');
  });

  it('converts every cleaning family and preserves safe fallbacks', () => {
    expect(defaultRvcCleanMode(MovaFanSpeed.Max)).toBe(3);
    expect(movaToRvcCleanMode(MovaCleaningMode.SweepingAndMopping, MovaFanSpeed.Intense)).toBe(2);
    expect(movaToRvcCleanMode(MovaCleaningMode.Mopping, MovaFanSpeed.Max)).toBe(8);
    expect(movaToRvcCleanMode(MovaCleaningMode.Sweeping, MovaFanSpeed.Quiet)).toBe(4);
    expect(rvcToMovaCleanMode(4, 'vac-then-mop')).toBe(MovaCleaningMode.MoppingAfterSweeping);
    expect(rvcToMovaCleanMode(8, 'vac-mop')).toBe(MovaCleaningMode.Mopping);
    expect(rvcToMovaCleanMode(99, 'vac-mop')).toBeUndefined();
    expect(rvcToMovaFanSpeed(99, MovaFanSpeed.Intense)).toBe(MovaFanSpeed.Intense);
  });

  it('maps run modes in priority order and labels unknown values safely', () => {
    expect(getRunModeFromMova(MovaState.Cleaning, MovaStatus.Charging)).toBe(RvcRunModeValue.Cleaning);
    expect(getRunModeFromMova(MovaState.ManualCleaning, MovaStatus.Charging)).toBe(RvcRunModeValue.Idle);
    expect(getRunModeFromMova(MovaState.FastMapping, MovaStatus.Unknown)).toBe(RvcRunModeValue.Mapping);
    expect(getRunModeFromMova(MovaState.Unknown, MovaStatus.Unknown)).toBe(RvcRunModeValue.Idle);
    expect(operationalStateName(999)).toBe('Unknown(999)');
    expect(runModeName(999)).toBe('Unknown(999)');
  });
});
