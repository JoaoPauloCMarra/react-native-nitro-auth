import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { socialButtonEnv } from "./support/social-button-env";
import { OfficialSocialButton } from "../official-buttons.web";
import { AuthError } from "../utils/auth-error";
import type { AuthUser } from "../Auth.nitro";

jest.mock("react-native", () =>
  jest
    .requireActual<typeof import("./support/social-button-env")>(
      "./support/social-button-env",
    )
    .createReactNativeMock(),
);

jest.mock("../ui/social-button-marks", () =>
  jest
    .requireActual<typeof import("./support/social-button-env")>(
      "./support/social-button-env",
    )
    .createMarksMock(),
);

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

jest.mock("../Auth.web", () =>
  jest
    .requireActual<typeof import("./support/social-button-env")>(
      "./support/social-button-env",
    )
    .createAuthWebMock(),
);

describe("OfficialSocialButton (web)", () => {
  beforeEach(() => {
    socialButtonEnv.reset();
  });

  it("uses the dedicated square asset for image-mode icon-only buttons", () => {
    render(
      React.createElement(OfficialSocialButton, {
        provider: "google",
        renderMode: "image",
        iconOnly: true,
        appearance: "dark",
        shape: "rectangular",
      }),
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button.style.width).toBe("48px");
    expect(button.style.height).toBe("48px");
    const image = screen.getByTestId(
      "google-icon-android-dark-rectangular.png",
    );
    expect((image as HTMLImageElement).style.height).toBe("48px");
    expect((image as HTMLImageElement).style.width).toBe("48px");
  });

  it("renders official image artwork when renderMode is omitted", () => {
    render(
      React.createElement(OfficialSocialButton, {
        provider: "google",
        iconOnly: true,
        appearance: "dark",
        shape: "rectangular",
      }),
    );

    expect(
      screen.getByTestId("google-icon-android-dark-rectangular.png"),
    ).toBeTruthy();
    expect(screen.queryByTestId("google-mark.png")).toBeNull();
  });

  it("renders Apple square SVG art and keeps the full accessible name", () => {
    render(
      React.createElement(OfficialSocialButton, {
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
      React.createElement(OfficialSocialButton, {
        provider: "google",
        renderMode: "image",
      }),
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button.style.width).toBe("216px");
    const image = screen.getByTestId("google-android-light-pill.png");
    expect((image as HTMLImageElement).style.height).toBe("48px");
    expect((image as HTMLImageElement).style.width).toBe("216px");
  });

  it("uses iOS artwork and dimensions on iOS", () => {
    socialButtonEnv.platformOS = "ios";
    render(
      React.createElement(OfficialSocialButton, {
        provider: "apple",
        renderMode: "image",
        appearance: "dark",
      }),
    );

    const button = screen.getByRole("button", { name: "Sign in with Apple" });
    expect(button.style.width).toBe(`${(48 * 196) / 48}px`);
    expect(screen.getByTestId("apple-ios-dark-pill.png")).toBeTruthy();
  });

  it("overlays the Google mark on Google SVG artwork", () => {
    render(
      React.createElement(OfficialSocialButton, {
        provider: "google",
        renderMode: "svg",
      }),
    );

    expect(screen.getByTestId("google-android-light-pill.svg")).toBeTruthy();
    const mark = screen.getByTestId("google-mark.png");
    expect(mark.style.position).toBe("absolute");
    expect(mark.style.width).toBe(`${20 * (216 / 180)}px`);
  });

  it.each(["image", "svg"] as const)(
    "keeps the provider mark and the indicator inside %s buttons",
    (renderMode) => {
      const { unmount } = render(
        React.createElement(OfficialSocialButton, {
          provider: "google",
          renderMode,
        }),
      );
      const idle = screen.getByRole("button", { name: "Sign in with Google" });
      const idleSize = [idle.style.width, idle.style.height];
      unmount();

      render(
        React.createElement(OfficialSocialButton, {
          provider: "google",
          renderMode,
          loading: true,
          loadingIndicator: React.createElement("span", {
            "data-testid": "busy-indicator",
          }),
        }),
      );
      const button = screen.getByRole("button", {
        name: "Sign in with Google",
      });
      const indicator = screen.getByTestId("busy-indicator").parentElement;
      expect(button.contains(indicator)).toBe(true);
      expect(button.contains(screen.getByTestId("google-mark.png"))).toBe(true);
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect([button.style.width, button.style.height]).toEqual(idleSize);
    },
  );

  it("signs in through the package login and reports the user", async () => {
    const user: AuthUser = { provider: "google", email: "a@example.com" };
    socialButtonEnv.login.mockImplementationOnce(async () => {
      socialButtonEnv.currentUser = user;
    });
    const onSuccess = jest.fn();

    render(
      React.createElement(OfficialSocialButton, {
        provider: "google",
        renderMode: "image",
        onSuccess,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with Google" }),
    );

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(user);
    });
    expect(socialButtonEnv.login.mock.calls[0]?.[0]).toBe("google");
  });

  it("passes normalized AuthError to onError for a rejected login", async () => {
    socialButtonEnv.login.mockRejectedValueOnce(
      new Error("token_error: No authorization code in response"),
    );
    const onError = jest.fn();

    render(
      React.createElement(OfficialSocialButton, {
        provider: "apple",
        renderMode: "svg",
        onError,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Apple" }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(AuthError);
    expect((onError.mock.calls[0]?.[0] as AuthError).code).toBe("token_error");
  });
});
