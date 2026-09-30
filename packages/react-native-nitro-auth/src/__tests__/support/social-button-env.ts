import type { ReactElement, ReactNode } from "react";
import type { AuthProvider, AuthUser, LoginOptions } from "../../Auth.nitro";

type LoginFn = (
  provider: AuthProvider,
  options?: LoginOptions,
) => Promise<void>;

type MockHostProps = {
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: { busy?: boolean; disabled?: boolean };
  accessible?: boolean;
  accessibilityElementsHidden?: boolean;
  allowFontScaling?: boolean;
  importantForAccessibility?: string;
  children?: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  pointerEvents?: string;
  resizeMode?: string;
  source?: unknown;
  style?: unknown;
  xml?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
};

export const socialButtonEnv = {
  currentUser: undefined as AuthUser | undefined,
  platformOS: "web" as "web" | "ios" | "android",
  fontScale: 1,
  login: jest.fn<ReturnType<LoginFn>, Parameters<LoginFn>>(),
  reset(): void {
    this.currentUser = undefined;
    this.platformOS = "web";
    this.fontScale = 1;
    this.login.mockReset();
  },
};

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  return style !== null && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

export function createReactNativeMock() {
  const ReactModule = jest.requireActual<typeof import("react")>("react");

  const createHost =
    (tag: string) =>
    ({
      accessibilityElementsHidden: _accessibilityElementsHidden,
      accessibilityLabel,
      accessibilityRole,
      accessibilityState,
      accessible: _accessible,
      children,
      disabled,
      allowFontScaling: _allowFontScaling,
      importantForAccessibility: _importantForAccessibility,
      onPress,
      pointerEvents: _pointerEvents,
      style,
      testID,
      ...props
    }: MockHostProps) => {
      const domProps = {
        ...props,
        "data-testid": testID,
        "aria-label": accessibilityLabel,
        "aria-busy": accessibilityState?.busy,
        "aria-disabled": accessibilityState?.disabled,
        "data-role": accessibilityRole,
        style: flattenStyle(style),
        ...(tag === "button"
          ? {
              disabled,
              onClick: disabled ? undefined : onPress,
              type: "button",
            }
          : {}),
      };

      return ReactModule.createElement(tag, domProps, children);
    };

  const image = ({ source, style }: MockHostProps): ReactElement => {
    const uri =
      source !== null && typeof source === "object" && "uri" in source
        ? String(source.uri)
        : "unknown-image";

    return ReactModule.createElement("img", {
      alt: "",
      "data-testid": uri,
      src: uri,
      style: flattenStyle(style),
    });
  };

  return {
    ActivityIndicator: createHost("span"),
    Image: image,
    Platform: {
      get OS() {
        return socialButtonEnv.platformOS;
      },
    },
    Pressable: createHost("button"),
    StyleSheet: { create: <T>(styles: T) => styles },
    Text: createHost("span"),
    View: createHost("div"),
    useWindowDimensions: () => ({
      width: 360,
      height: 800,
      fontScale: socialButtonEnv.fontScale,
    }),
  };
}

export function createMarksMock() {
  return {
    appleMarks: {
      dark: { uri: "apple-mark-dark.png" },
      light: { uri: "apple-mark-light.png" },
    },
    googleMark: { uri: "google-mark.png" },
  };
}

export function createAuthWebMock() {
  return {
    AuthModule: {
      get currentUser() {
        return socialButtonEnv.currentUser;
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
      login: (...args: Parameters<LoginFn>) => socialButtonEnv.login(...args),
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
  };
}
