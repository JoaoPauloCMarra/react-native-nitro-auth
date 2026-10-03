import { createContext, useContext, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  GoogleSocialButtonContent,
  SocialButton,
  type AuthError,
  type SocialButtonAppearance,
  type SocialButtonContentProps,
  type SocialButtonRenderMode,
  type SocialButtonShape,
} from "react-native-nitro-auth";
import {
  OfficialSocialButton,
  type OfficialSocialButtonRenderMode,
} from "react-native-nitro-auth/official-buttons";
import { OfficialSocialButton as OfficialSvgSocialButton } from "react-native-nitro-auth/official-buttons/svg";

type GalleryMode = SocialButtonRenderMode | OfficialSocialButtonRenderMode;

const modes: GalleryMode[] = ["custom", "image", "svg"];

type GalleryButtonProps = {
  testID: string;
  provider: "google" | "apple";
  mode: GalleryMode;
  iconOnly: boolean;
  appearance: SocialButtonAppearance;
  shape: SocialButtonShape;
  loading: boolean;
  onPress: () => void;
};

function GalleryButton({ mode, ...props }: GalleryButtonProps) {
  if (mode === "custom") {
    return <SocialButton {...props} />;
  }
  if (mode === "svg") {
    return <OfficialSvgSocialButton {...props} renderMode="svg" />;
  }
  return <OfficialSocialButton {...props} renderMode="image" />;
}

type ToggleProps = {
  label: string;
  onPress: () => void;
  selected?: boolean;
  text: string;
  testID?: string;
};

function Toggle({
  label,
  onPress,
  selected = false,
  text,
  testID,
}: ToggleProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.control, selected ? styles.controlSelected : null]}
    >
      <Text style={styles.controlLabel}>{text}</Text>
    </Pressable>
  );
}

export function SocialButtonGallery() {
  const [mode, setMode] = useState<GalleryMode>("custom");
  const [appearance, setAppearance] = useState<SocialButtonAppearance>("light");
  const [shape, setShape] = useState<SocialButtonShape>("pill");
  const [iconOnly, setIconOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastProvider, setLastProvider] = useState("None");

  return (
    <View style={styles.gallery}>
      <Text style={styles.title}>Provider button appearance</Text>
      <Text style={styles.description}>
        Visual checks only. These buttons report presses without signing in.
      </Text>
      <View style={styles.modes}>
        {modes.map((value) => (
          <Toggle
            key={value}
            label={`Show ${value} buttons`}
            selected={mode === value}
            text={value}
            onPress={() => {
              setMode(value);
            }}
          />
        ))}
      </View>
      <View style={styles.modes}>
        <Toggle
          label="Toggle button appearance"
          text={appearance}
          onPress={() => {
            setAppearance(appearance === "light" ? "dark" : "light");
          }}
        />
        <Toggle
          label="Toggle button shape"
          text={shape}
          onPress={() => {
            setShape(shape === "pill" ? "rectangular" : "pill");
          }}
        />
      </View>
      <View
        style={[
          styles.stage,
          {
            backgroundColor: appearance === "light" ? "#FFFFFF" : "#0B0B0C",
          },
        ]}
      >
        <GalleryButton
          testID="gallery-google"
          provider="google"
          mode={mode}
          iconOnly={iconOnly}
          appearance={appearance}
          shape={shape}
          loading={busy}
          onPress={() => {
            setLastProvider("Google");
          }}
        />
        <GalleryButton
          testID="gallery-apple"
          provider="apple"
          mode={mode}
          iconOnly={iconOnly}
          appearance={appearance}
          shape={shape}
          loading={busy}
          onPress={() => {
            setLastProvider("Apple");
          }}
        />
      </View>
      <View style={styles.modes}>
        <Toggle
          label="Toggle button loading"
          testID={busy ? "gallery-loading-active" : "gallery-loading-inactive"}
          selected={busy}
          text={busy ? "Clear loading" : "Show loading"}
          onPress={() => {
            setBusy(!busy);
          }}
        />
        <Toggle
          label="Toggle icon-only buttons"
          selected={iconOnly}
          text={iconOnly ? "Show labels" : "Show icons only"}
          onPress={() => {
            setIconOnly(!iconOnly);
          }}
        />
      </View>
      <Text>Last visual button pressed: {lastProvider}</Text>
    </View>
  );
}

const BUSY_HOLD_MS = 3000;

type BusyReport = (loading: boolean, disabled: boolean) => void;

const BusyReportContext = createContext<BusyReport>(() => {});

function BusyObserverContent(props: SocialButtonContentProps) {
  const report = useContext(BusyReportContext);
  const { loading, disabled } = props;
  useEffect(() => {
    report(loading, disabled);
  }, [report, loading, disabled]);
  return <GoogleSocialButtonContent {...props} />;
}

const observerComponents = { google: BusyObserverContent };

export function SocialButtonBehaviorLab() {
  const [disabledPresses, setDisabledPresses] = useState(0);
  const [busyPresses, setBusyPresses] = useState(0);
  const [errorCode, setErrorCode] = useState("none");
  const [microsoftPresses, setMicrosoftPresses] = useState(0);
  const [iconSize, setIconSize] = useState("pending");
  const [observerLoading, setObserverLoading] = useState(false);
  const [observed, setObserved] = useState({ loading: false, disabled: false });

  const report: BusyReport = (loading, disabled) => {
    setObserved((current) =>
      current.loading === loading && current.disabled === disabled
        ? current
        : { loading, disabled },
    );
  };

  const tokens = [
    `disabled-press=${disabledPresses}:`,
    `busy-press=${busyPresses}:`,
    `onError=${errorCode}:`,
    `ms-press=${microsoftPresses}:`,
    `icon-size=${iconSize}:`,
    `pkg-busy=${observed.loading}:pkg-disabled=${observed.disabled}:`,
  ];

  return (
    <View testID="gallery-behavior" style={styles.gallery}>
      <Text style={styles.title}>Button behavior</Text>
      <Text style={styles.description}>
        Visual checks only. Every button has its own onPress, so none signs in.
      </Text>
      <Text style={styles.probeText}>{tokens.join(" ")}</Text>
      <View style={styles.stage}>
        <SocialButton
          testID="gallery-disabled"
          provider="google"
          disabled
          onPress={() => {
            setDisabledPresses((count) => count + 1);
          }}
        />
        <SocialButton
          testID="gallery-busy"
          provider="apple"
          loadingIndicator={null}
          onPress={async () => {
            setBusyPresses((count) => count + 1);
            await new Promise((resolve) => setTimeout(resolve, BUSY_HOLD_MS));
          }}
        />
        <SocialButton
          testID="gallery-error"
          provider="google"
          onPress={() => {
            throw new Error("timeout");
          }}
          onError={(error: AuthError) => {
            setErrorCode(error.code);
          }}
        />
        <SocialButton
          testID="gallery-microsoft"
          provider="microsoft"
          variant="outline"
          onPress={() => {
            setMicrosoftPresses((count) => count + 1);
          }}
        />
        <View
          style={styles.measured}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setIconSize(`${Math.round(width)}x${Math.round(height)}`);
          }}
        >
          <SocialButton
            testID="gallery-icon-only"
            provider="apple"
            iconOnly
            onPress={() => {}}
          />
        </View>
        <BusyReportContext value={report}>
          <SocialButton
            testID="gallery-busy-observer"
            provider="google"
            loading={observerLoading}
            loadingIndicator={null}
            customComponents={observerComponents}
            onPress={() => {}}
          />
        </BusyReportContext>
      </View>
      <Toggle
        label="Toggle observed loading"
        testID="gallery-observer-loading"
        selected={observerLoading}
        text={
          observerLoading ? "Clear observed loading" : "Show observed loading"
        }
        onPress={() => {
          setObserverLoading(!observerLoading);
        }}
      />
      <View
        testID="gallery-probe"
        accessible
        accessibilityLabel={tokens.join(" ")}
        style={styles.resultsProbe}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { padding: 16, gap: 12, backgroundColor: "#FFFFFF" },
  title: { fontSize: 20, fontWeight: "600", color: "#111827" },
  description: { fontSize: 14, lineHeight: 20, color: "#374151" },
  modes: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  stage: {
    paddingVertical: 20,
    gap: 16,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  control: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  controlSelected: { backgroundColor: "#DBEAFE" },
  controlLabel: { fontSize: 14, color: "#111827" },
  resultsProbe: { height: 1 },
  probeText: { fontSize: 11, color: "#111827", fontFamily: "Menlo" },
  measured: { alignSelf: "center" },
});
