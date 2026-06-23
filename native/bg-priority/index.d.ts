/* eslint-disable */
/**
 * Enter (`enable = true`) or leave (`enable = false`) OS background mode for the
 * calling process/thread (Windows PROCESS_MODE_BACKGROUND_BEGIN/END, macOS
 * per-thread QOS_CLASS_BACKGROUND/restore).
 *
 * Returns `true` when a native demotion/restoration was applied on this
 * platform, `false` when this platform has no native lever. Never throws.
 */
export function setBackgroundMode(enable: boolean): boolean;
