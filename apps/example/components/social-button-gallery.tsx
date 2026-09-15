import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SocialButton,
  type SocialButtonRenderMode,
} from "react-native-nitro-auth";

const modes: SocialButtonRenderMode[] = ["custom", "image", "svg"];

export function SocialButtonGallery() {
  const [mode, setMode] = useState<SocialButtonRenderMode>("custom");
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
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`Show ${value} buttons`}
            accessibilityState={{ selected: mode === value }}
            onPress={() => {
              setMode(value);
            }}
            style={styles.control}
          >
            <Text>{value}</Text>
          </Pressable>
        ))}
      </View>
      <SocialButton
        provider="google"
        renderMode={mode}
        iconOnly={iconOnly}
        appearance="light"
        shape="pill"
        loading={busy}
        onPress={() => {
          setLastProvider("Google");
        }}
      />
      <SocialButton
        provider="apple"
        renderMode={mode}
        iconOnly={iconOnly}
        appearance="light"
        shape="pill"
        loading={busy}
        onPress={() => {
          setLastProvider("Apple");
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle button loading"
        onPress={() => {
          setBusy(!busy);
        }}
        style={styles.control}
      >
        <Text>{busy ? "Clear loading" : "Show loading"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle icon-only buttons"
        onPress={() => {
          setIconOnly(!iconOnly);
        }}
        style={styles.control}
      >
        <Text>{iconOnly ? "Show labels" : "Show icons only"}</Text>
      </Pressable>
      <Text>Last visual button pressed: {lastProvider}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { padding: 16, gap: 16, backgroundColor: "#FFFFFF" },
  title: { fontSize: 20, fontWeight: "600", color: "#111827" },
  description: { fontSize: 14, lineHeight: 20, color: "#374151" },
  modes: { flexDirection: "row", gap: 8 },
  control: {
    minHeight: 48,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
});
