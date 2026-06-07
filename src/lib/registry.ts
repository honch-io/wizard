import type { FrameworkConfig } from './framework-config';
import { Integration } from './constants';
import { HONCH_TARGETS } from '@frameworks/honch-targets';

/**
 * Map of target id -> FrameworkConfig, built from the Honch target list.
 * Framework detection iterates these in HONCH_TARGETS order (most specific
 * first: esp-idf before c-posix, firmware before mobile).
 */
export const FRAMEWORK_REGISTRY = Object.fromEntries(
  HONCH_TARGETS.map((config) => [config.metadata.integration, config]),
) as Record<Integration, FrameworkConfig>;
