import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { socialButtonEnv } from "./support/social-button-env";
import { SocialButton, SocialProviderIcon } from "../ui/social-button.web";
import { AuthError } from "../utils/auth-error";
import type { SocialButtonProps } from "../ui/social-button.web";

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

jest.mock("../ui/social-button-assets", () => {
  throw new Error("The root SocialButton must not load official artwork");
});

jest.mock("react-native-svg", () => {
  throw new Error("The root SocialButton must not load react-native-svg");
});

jest.mock("../Auth.web", () =>
  jest
    .requireActual<typeof import("./support/social-button-env")>(
      "./support/social-button-env",
    )
    .createAuthWebMock(),
);

describe("SocialButton (web)", () => {
  beforeEach(() => {
    socialButtonEnv.reset();
  });

  it("renders an accessible Google icon-only button without a text label", () => {
    render(
      React.createElement(SocialButton, { provider: "google", iconOnly: true }),
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("false");
    expect(screen.queryByText("Sign in with Google")).toBeNull();
    const logo = screen.getByTestId("google-mark.png");
    expect((logo as HTMLImageElement).style.height).toBe("24px");
    expect(button.style.width).toBe("48px");
    expect(button.style.height).toBe("48px");
  });

  it("sizes labeled custom buttons without the official artwork table", () => {
    render(React.createElement(SocialButton, { provider: "apple" }));

    const button = screen.getByRole("button", { name: "Sign in with Apple" });
    expect(button.style.width).toBe("264px");
    expect(button.style.height).toBe("48px");
    expect(screen.getByText("Sign in with Apple")).toBeTruthy();
    expect(screen.getByTestId("apple-mark-light.png")).toBeTruthy();
  });

  it.each(["image", "svg"])(
    "falls back to custom content when untyped callers pass %s",
    (renderMode) => {
      const globals = globalThis as { __DEV__?: boolean | undefined };
      const previousDev = globals.__DEV__;
      globals.__DEV__ = true;
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const props = {
          provider: "google",
          renderMode,
        } as unknown as SocialButtonProps;
        render(React.createElement(SocialButton, props));

        const button = screen.getByRole("button", {
          name: "Sign in with Google",
        });
        expect(button.style.width).toBe("264px");
        expect(screen.getByText("Sign in with Google")).toBeTruthy();
        expect(screen.getByTestId("google-mark.png")).toBeTruthy();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("react-native-nitro-auth/official-buttons"),
        );
      } finally {
        warn.mockRestore();
        globals.__DEV__ = previousDev;
      }
    },
  );

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

  it("preserves the artwork layout while an async press is busy and blocks reentry", async () => {
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
    expect(screen.getAllByTestId("google-mark.png").length).toBeGreaterThan(0);
    expect(button.style.width).toBe("48px");
    expect(button.style.height).toBe("48px");

    resolvePress?.();
    await waitFor(() => {
      expect(button.getAttribute("aria-busy")).toBe("false");
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the provider mark and the indicator inside custom buttons", () => {
    const { unmount } = render(
      React.createElement(SocialButton, {
        provider: "google",
      }),
    );
    const idle = screen.getByRole("button", { name: "Sign in with Google" });
    const idleSize = [idle.style.width, idle.style.height];
    unmount();

    render(
      React.createElement(SocialButton, {
        provider: "google",
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
    expect([button.style.width, button.style.height]).toEqual(idleSize);
    expect(button.style.marginBottom || "0px").toBe("0px");
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
    expect(button.style.marginBottom || "0px").toBe("0px");
    expect(screen.getByTestId("google-mark.png")).toBeTruthy();
  });

  it.each(["ios", "android"] as const)(
    "renders font-free provider icons on %s",
    (platform) => {
      socialButtonEnv.platformOS = platform;
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
      expect(screen.getByTestId("google-mark.png").style.height).toBe("24px");
      expect(screen.getByTestId("apple-mark-light.png").style.height).toBe(
        "24px",
      );
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
    socialButtonEnv.login.mockRejectedValueOnce(
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
