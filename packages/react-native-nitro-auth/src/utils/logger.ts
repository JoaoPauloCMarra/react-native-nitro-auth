let enabled = false;

export const logger = {
  setEnabled(value: boolean): void {
    enabled = value;
  },
  log: (...args: unknown[]) => {
    if (enabled) console.log("[NitroAuth]", ...args);
  },
  warn: (...args: unknown[]) => {
    if (enabled) console.warn("[NitroAuth]", ...args);
  },
  error: (...args: unknown[]) => {
    if (enabled) console.error("[NitroAuth]", ...args);
  },
  debug: (...args: unknown[]) => {
    if (enabled) console.debug("[NitroAuth]", ...args);
  },
};
