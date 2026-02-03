let enabled = false;

export const logger = {
  setEnabled(value: boolean): void {
    enabled = value;
  },
  log: (...args: unknown[]) => enabled && console.log("[NitroAuth]", ...args),
  warn: (...args: unknown[]) => enabled && console.warn("[NitroAuth]", ...args),
  error: (...args: unknown[]) => enabled && console.error("[NitroAuth]", ...args),
  debug: (...args: unknown[]) => enabled && console.debug("[NitroAuth]", ...args),
};
