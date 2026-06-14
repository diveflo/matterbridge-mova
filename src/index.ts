/**
 * Matterbridge MOVA Vacuum Plugin
 *
 * This plugin provides Matter 1.4 support for Mova robot vacuum cleaners,
 * enabling control via Apple Home, Google Home, Alexa, and other Matter-compatible platforms.
 *
 * @file index.ts
 * @license Apache-2.0
 */

import { type PlatformMatterbridge, PlatformConfig } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';

import { MovaPlatform } from './platform.js';

/**
 * Initialize the Mova vacuum plugin.
 *
 * This is the standard Matterbridge plugin entry point.
 *
 * @param matterbridge - The Matterbridge instance
 * @param log - Logger instance for the plugin
 * @param config - Platform configuration from Matterbridge
 * @returns The initialized MovaPlatform instance
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): MovaPlatform {
  return new MovaPlatform(matterbridge, log, config);
}
