import { logger } from "../utils/logger";

describe("logger", () => {
  const originalConsole = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };

  beforeEach(() => {
    logger.setEnabled(false);
    console.debug = jest.fn();
    console.error = jest.fn();
    console.log = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    logger.setEnabled(false);
  });

  it("does not write when disabled", () => {
    logger.log("message");
    logger.warn("message");
    logger.error("message");
    logger.debug("message");

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.debug).not.toHaveBeenCalled();
  });

  it("prefixes every console method when enabled", () => {
    logger.setEnabled(true);

    logger.log("log");
    logger.warn("warn");
    logger.error("error");
    logger.debug("debug");

    expect(console.log).toHaveBeenCalledWith("[NitroAuth]", "log");
    expect(console.warn).toHaveBeenCalledWith("[NitroAuth]", "warn");
    expect(console.error).toHaveBeenCalledWith("[NitroAuth]", "error");
    expect(console.debug).toHaveBeenCalledWith("[NitroAuth]", "debug");
  });
});
