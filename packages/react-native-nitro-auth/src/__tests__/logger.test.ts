import { logger } from "../utils/logger";

type ConsoleSpies = {
  debugMethod: jest.SpiedFunction<typeof globalThis.console.debug>;
  error: jest.SpiedFunction<typeof globalThis.console.error>;
  log: jest.SpiedFunction<typeof globalThis.console.log>;
  warn: jest.SpiedFunction<typeof globalThis.console.warn>;
};

function callLoggerDebug(message: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(logger, "debug");
  const debugLogger = descriptor?.value as
    | ((message: string) => void)
    | undefined;
  debugLogger?.(message);
}

describe("logger", () => {
  let consoleSpies: ConsoleSpies;

  beforeEach(() => {
    logger.setEnabled(false);
    consoleSpies = {
      debugMethod: jest.spyOn(globalThis.console, "debug"),
      error: jest.spyOn(globalThis.console, "error"),
      log: jest.spyOn(globalThis.console, "log"),
      warn: jest.spyOn(globalThis.console, "warn"),
    };
    consoleSpies.debugMethod.mockImplementation(() => undefined);
    consoleSpies.error.mockImplementation(() => undefined);
    consoleSpies.log.mockImplementation(() => undefined);
    consoleSpies.warn.mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    logger.setEnabled(false);
  });

  it("does not write when disabled", () => {
    logger.log("message");
    logger.warn("message");
    logger.error("message");
    callLoggerDebug("message");

    expect(consoleSpies.log).not.toHaveBeenCalled();
    expect(consoleSpies.warn).not.toHaveBeenCalled();
    expect(consoleSpies.error).not.toHaveBeenCalled();
    expect(consoleSpies.debugMethod).not.toHaveBeenCalled();
  });

  it("prefixes every console method when enabled", () => {
    logger.setEnabled(true);

    logger.log("log");
    logger.warn("warn");
    logger.error("error");
    callLoggerDebug("debug");

    expect(consoleSpies.log).toHaveBeenCalledWith("[NitroAuth]", "log");
    expect(consoleSpies.warn).toHaveBeenCalledWith("[NitroAuth]", "warn");
    expect(consoleSpies.error).toHaveBeenCalledWith("[NitroAuth]", "error");
    expect(consoleSpies.debugMethod).toHaveBeenCalledWith(
      "[NitroAuth]",
      "debug",
    );
  });
});
