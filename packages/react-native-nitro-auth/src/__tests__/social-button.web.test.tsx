import type { ReactNode } from "react";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SocialButton, SocialProviderIcon } from "../ui/social-button.web";
import { AuthError } from "../utils/auth-error";
import type { AuthProvider, AuthUser, LoginOptions } from "../Auth.nitro";

let mockCurrentUser: AuthUser | undefined;
let mockPlatformOS: "web" | "ios" | "android" = "web";
let mockFontScale = 1;

type LoginFn = (
  provider: AuthProvider,
  options?: LoginOptions,
) => Promise<void>;

const mockLogin = jest.fn<ReturnType<LoginFn>, Parameters<LoginFn>>();

type MockHostProps = {
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

jest.mock("react-native", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");

  const flattenStyle = (style: unknown): Record<string, unknown> => {
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.map(flattenStyle));
    }
    return style !== null && typeof style === "object"
      ? (style as Record<string, unknown>)
      : {};
  };

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
      ...props
    }: MockHostProps) => {
      const domProps = {
        ...props,
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

  const image = ({ source, style }: MockHostProps): React.ReactElement => {
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
        return mockPlatformOS;
      },
    },
    Pressable: createHost("button"),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: createHost("span"),
    View: createHost("div"),
    useWindowDimensions: () => ({
      width: 360,
      height: 800,
      fontScale: mockFontScale,
    }),
  };
});

jest.mock("react-native-svg", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");

  return {
    SvgXml: ({
      height,
      width,
      xml,
    }: {
      height?: number;
      width?: number;
      xml: string;
    }) => {
      const artworkId = xml.match(/data-id="([^"]+)"/u)?.[1] ?? "unknown-svg";
      return ReactModule.createElement("svg", {
        "data-testid": artworkId,
        height,
        width,
      });
    },
  };
});

jest.mock("../ui/social-button-assets", () => {
  const makeArtwork = (id: string, width: number, height: number) => ({
    image: { uri: `${id}.png` },
    svg: `<svg data-id="${id}.svg" />`,
    width,
    height,
  });

  const makeProviderArtwork = (
    provider: string,
    width: number,
    height: number,
    iosWidth = width + 8,
    iosHeight = height + 4,
  ) => ({
    android: {
      light: {
        pill: makeArtwork(`${provider}-android-light-pill`, width, height),
        rectangular: makeArtwork(
          `${provider}-android-light-rectangular`,
          width,
          height,
        ),
      },
      dark: {
        pill: makeArtwork(`${provider}-android-dark-pill`, width, height),
        rectangular: makeArtwork(
          `${provider}-android-dark-rectangular`,
          width,
          height,
        ),
      },
    },
    ios: {
      light: {
        pill: makeArtwork(`${provider}-ios-light-pill`, iosWidth, iosHeight),
        rectangular: makeArtwork(
          `${provider}-ios-light-rectangular`,
          iosWidth,
          iosHeight,
        ),
      },
      dark: {
        pill: makeArtwork(`${provider}-ios-dark-pill`, iosWidth, iosHeight),
        rectangular: makeArtwork(
          `${provider}-ios-dark-rectangular`,
          iosWidth,
          iosHeight,
        ),
      },
    },
  });

  return {
    appleIconLogos: {
      dark: '<svg data-id="apple-square-dark" />',
      light: '<svg data-id="apple-square-light" />',
    },
    appleLogos: {
      dark: '<svg data-id="apple-horizontal-dark" />',
      light: '<svg data-id="apple-horizontal-light" />',
    },
    googleLogo: { uri: "google-logo.png" },
    iconOnlyArtwork: {
      apple: makeProviderArtwork("apple-icon", 40, 40, 44, 44),
      google: makeProviderArtwork("google-icon", 40, 40, 44, 44),
    },
    socialButtonArtwork: {
      apple: makeProviderArtwork("apple", 188, 44),
      google: makeProviderArtwork("google", 180, 40),
    },
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
    mockPlatformOS = "web";
    mockFontScale = 1;
    mockLogin.mockReset();
  });

  it("renders an accessible Google icon-only button without a text label", () => {
    render(
      React.createElement(SocialButton, { provider: "google", iconOnly: true }),
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("false");
    expect(screen.queryByText("Sign in with Google")).toBeNull();
    const logo = screen.getByTestId("google-logo.png");
    expect((logo as HTMLImageElement).style.height).toBe("24px");
    expect((logo as HTMLImageElement).style.width).toBe("24px");
  });

  it("uses the dedicated square asset for image-mode icon-only buttons", () => {
    render(
      React.createElement(SocialButton, {
        provider: "google",
        renderMode: "image",
        iconOnly: true,
        appearance: "dark",
        shape: "rectangular",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeTruthy();
    const image = screen.getByTestId(
      "google-icon-android-dark-rectangular.png",
    );
    expect((image as HTMLImageElement).style.height).toBe("48px");
    expect((image as HTMLImageElement).style.width).toBe("48px");
  });

  it("renders Apple square SVG art and keeps the full accessible name", () => {
    render(
      React.createElement(SocialButton, {
        provider: "apple",
        renderMode: "svg",
        iconOnly: true,
        appearance: "light",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Sign in with Apple" }),
    ).toBeTruthy();
    expect(
      screen.getByTestId("apple-icon-android-light-pill.svg"),
    ).toBeTruthy();
    expect(screen.queryByText("Sign in with Apple")).toBeNull();
  });

  it("uses Android artwork on web and preserves the source ratio", () => {
    render(
      React.createElement(SocialButton, {
        provider: "google",
        renderMode: "image",
      }),
    );

    const image = screen.getByTestId("google-android-light-pill.png");
    expect((image as HTMLImageElement).style.height).toBe("48px");
    expect((image as HTMLImageElement).style.width).toBe("216px");
  });

  it("keeps a custom provider renderer visual-only and receives iconOnly", () => {
    const customComponent = jest.fn(
      (props: { label: string; iconOnly: boolean }) =>
        React.createElement(
          "span",
          { "data-testid": "custom-content" },
          `${props.label}:${props.iconOnly}`,
        ),
    );
    const onPress = jest.fn();

    render(
      React.createElement(SocialButton, {
        provider: "apple",
        iconOnly: true,
        customComponents: { apple: customComponent },
        onPress,
      }),
    );

    expect(screen.getByTestId("custom-content").textContent).toBe(
      "Sign in with Apple:true",
    );
    expect(customComponent.mock.calls[0]?.[0]).not.toHaveProperty("onPress");
    expect(
      screen.getByRole("button", { name: "Sign in with Apple" }),
    ).toBeTruthy();
  });

  it("keeps branded artwork visible while an async press is busy and blocks reentry", async () => {
    let resolvePress: (() => void) | undefined;
    const pendingPress = new Promise<void>((resolve) => {
      resolvePress = resolve;
    });
    const onPress = jest.fn(() => pendingPress);

    render(
      React.createElement(SocialButton, {
        provider: "google",
        iconOnly: true,
        onPress,
      }),
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(onPress).toHaveBeenCalledTimes(1);
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("google-logo.png")).toBeTruthy();

    resolvePress?.();
    await waitFor(() => {
      expect(button.getAttribute("aria-busy")).toBe("false");
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("lets custom content own loading without a second indicator or reserved gap", () => {
    render(
      React.createElement(SocialButton, {
        provider: "google",
        iconOnly: true,
        loading: true,
        loadingIndicator: null,
      }),
    );
    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector("span")).toBeNull();
    expect(button.style.marginBottom).toBe("0px");
    expect(screen.getByTestId("google-logo.png")).toBeTruthy();
  });

  it.each(["ios", "android"] as const)(
    "renders font-free provider icons on %s",
    (platform) => {
      mockPlatformOS = platform;
      render(
        React.createElement(
          "div",
          null,
          React.createElement(SocialProviderIcon, {
            provider: "google",
            size: 24,
          }),
          React.createElement(SocialProviderIcon, {
            provider: "apple",
            size: 24,
          }),
        ),
      );
      expect(screen.getByTestId("google-logo.png").style.width).toBe("24px");
      expect(
        screen.getByTestId("apple-square-light").getAttribute("width"),
      ).toBe("24");
      expect(screen.queryByRole("button")).toBeNull();
    },
  );

  it("passes normalized AuthError to onError for a rejected custom press", async () => {
    const onError = jest.fn();
    render(
      React.createElement(SocialButton, {
        provider: "google",
        onPress: () => Promise.reject(new Error("token_error: invalid state")),
        onError,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with Google" }),
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(AuthError);
    expect(onError.mock.calls[0]?.[0].code).toBe("token_error");
  });

  it("preserves Microsoft custom-mode login and normalizes AuthError", async () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with Microsoft" }),
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(AuthError);
    expect((onError.mock.calls[0]?.[0] as AuthError).code).toBe("token_error");
  });
});
