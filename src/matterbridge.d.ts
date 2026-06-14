declare module 'matterbridge' {
  import type { AnsiLogger, LogLevel } from 'matterbridge/logger';

  export interface PlatformMatterbridge {
    matterbridgeVersion: string;
  }

  export interface PlatformConfig {
    username?: string;
    password?: string;
    country?: string;
    refreshInterval?: number;
    unregisterOnShutdown?: boolean;
    suctionLevel?: string;
    vacuumAndMopMode?: string;
    [key: string]: unknown;
  }

  export class MatterbridgeDynamicPlatform {
    protected constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig);

    matterbridge: PlatformMatterbridge;
    log: AnsiLogger;
    config: PlatformConfig;
    ready: Promise<void>;
    context?: {
      get<T>(key: string): Promise<T | undefined>;
      set<T>(key: string, value: T): Promise<void>;
    };

    verifyMatterbridgeVersion?(version: string): boolean;
    onStart(reason?: string): Promise<void>;
    onConfigure(): Promise<void>;
    onChangeLoggerLevel(logLevel: LogLevel): Promise<void>;
    onShutdown(reason?: string): Promise<void>;
    registerDevice(device: unknown): Promise<void>;
    unregisterAllDevices(): Promise<void>;
  }
}

declare module 'matterbridge/devices' {
  import type { AnsiLogger } from 'matterbridge/logger';

  export class RoboticVacuumCleaner {
    constructor(
      name: string,
      serial: string,
      mode: string,
      currentRunMode: number,
      supportedRunModes: unknown[],
      currentCleanMode: number,
      supportedCleanModes: unknown[],
      currentPhase: unknown,
      phaseList: unknown,
      operationalState: number,
      operationalStateList: unknown[],
      supportedAreas: unknown[],
      selectedAreas: number[],
      currentArea: number | null,
      supportedMaps: unknown[],
    );

    uniqueId: string;
    addCommandHandler(command: string, handler: (data?: unknown) => Promise<void> | void): void;
    setAttribute(cluster: string, attribute: string, value: unknown, log?: AnsiLogger): void;
  }
}

declare module 'matterbridge/logger' {
  export type LogLevel = string;

  export class AnsiLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  }
}
