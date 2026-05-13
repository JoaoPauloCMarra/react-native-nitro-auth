import type { ReactNode } from "react";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SocialButton } from "../ui/social-button.web";
import { AuthError } from "../utils/auth-error";
import type { AuthProvider, AuthUser, LoginOptions } from "../Auth.nitro";

let mockCurrentUser: AuthUser | undefined;

type LoginFn = (
  provider: AuthProvider,
  options?: LoginOptions,
) => Promise<void>;

const mockLogin = jest.fn<ReturnType<LoginFn>, Parameters<LoginFn>>();

type HostProps = {
  children?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: unknown;
  [key: string]: unknown;
};

jest.mock("react-native", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");

  const createHost =
    (tag: string) =>
    ({ children, onPress, disabled, style: _style, ...props }: HostProps) => {
      const domProps =
        tag === "button"
          ? { ...props, onClick: disabled ? undefined : onPress, disabled }
          : props;

      return ReactModule.createElement(tag, domProps, children);
    };

  return {
    Pressable: createHost("button"),
    Text: createHost("span"),
    View: createHost("div"),
    ActivityIndicator: createHost("span"),
    StyleSheet: { create: <T,>(styles: T) => styles },
  };
});

jest.mock("../Auth.web", () => ({
  AuthModule: {
    get currentUser() {
      return mockCurrentUser;
    },
    get name() {
      return "Auth";
    },
    get grantedScopes() {
      return [];
    },
    get hasPlayServices() {
      return true;
    },
    login: (...args: Parameters<LoginFn>) => mockLogin(...args),
    requestScopes: jest.fn(),
    revokeScopes: jest.fn(),
    getAccessToken: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
    silentRestore: jest.fn(),
    onAuthStateChanged: jest.fn(() => () => {}),
    onTokensRefreshed: jest.fn(() => () => {}),
    setLoggingEnabled: jest.fn(),
    dispose: jest.fn(),
    equals: jest.fn(() => false),
  },
}));

describe("SocialButton (web)", () => {
  beforeEach(() => {
    mockCurrentUser = undefined;
    mockLogin.mockReset();
  });

  it("passes normalized AuthError to onError", async () => {
    mockLogin.mockRejectedValueOnce(
      new Error("token_error: No authorization code in response"),
    );
    const onError = jest.fn();

    render(
      React.createElement(SocialButton, {
        provider: "microsoft",
        onError,
      }),
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });

    const error = onError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe("token_error");
    expect((error as AuthError).underlyingMessage).toBe(
      "token_error: No authorization code in response",
    );
  });
});
