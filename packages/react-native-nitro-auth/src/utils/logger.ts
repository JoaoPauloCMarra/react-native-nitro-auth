let enabled = false;

export const logger = {
  setEnabled: (value: boolean) => {
    enabled = value;
  },
  log: (...args: any[]) => enabled && console.log("[NitroAuth]", ...args),
  warn: (...args: any[]) => enabled && console.warn("[NitroAuth]", ...args),
  error: (...args: any[]) => enabled && console.error("[NitroAuth]", ...args),
  debug: (...args: any[]) => enabled && console.debug("[NitroAuth]", ...args),
};
