import type { Auth } from "../../Auth.nitro";

export const mockAuthConfig = (extra?: Record<string, unknown>): void => {
  jest.resetModules();
  jest.doMock(
    "expo-constants",
    () => ({
      __esModule: true,
      default: { expoConfig: { extra: extra ?? {} } },
    }),
    { virtual: true },
  );
};

export const loadAuthModule = async (
  extra?: Record<string, unknown>,
): Promise<Auth> => {
  mockAuthConfig(extra);
  const module = await import("../../Auth.web");
  return module.AuthModule;
};

export const loadAuthInstances = async (
  extra?: Record<string, unknown>,
): Promise<{ first: Auth; second: Auth }> => {
  mockAuthConfig(extra);
  const module = await import("../../Auth.web");
  const first = module.AuthModule;
  module.resetAuthModule(module.AuthModule);
  return { first, second: module.AuthModule };
};

export const loadAuthService = async (extra?: Record<string, unknown>) => {
  mockAuthConfig(extra);
  const module = await import("../../service.web");
  return module.AuthService;
};

const defineGlobal = (target: object, name: string, value: unknown): void => {
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value,
  });
};

export const installWindowOpen = (value: unknown): void => {
  defineGlobal(window, "open", value);
};

export const installFetch = (value: unknown): void => {
  defineGlobal(globalThis, "fetch", value);
};

export const installAppleId = (value: unknown): void => {
  defineGlobal(window, "AppleID", value);
};

export const createPopupWindow = (href = ""): Window =>
  ({
    closed: false,
    close: jest.fn(),
    location: { href },
  }) as unknown as Window;
