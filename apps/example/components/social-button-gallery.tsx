import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SocialButton,
  type SocialButtonAppearance,
  type SocialButtonRenderMode,
  type SocialButtonShape,
} from "react-native-nitro-auth";

const modes: SocialButtonRenderMode[] = ["custom", "image", "svg"];

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
  const [mode, setMode] = useState<SocialButtonRenderMode>("custom");
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
        <SocialButton
          testID="gallery-google"
          provider="google"
          renderMode={mode}
          iconOnly={iconOnly}
          appearance={appearance}
          shape={shape}
          loading={busy}
          onPress={() => {
            setLastProvider("Google");
          }}
        />
        <SocialButton
          testID="gallery-apple"
          provider="apple"
          renderMode={mode}
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
});
