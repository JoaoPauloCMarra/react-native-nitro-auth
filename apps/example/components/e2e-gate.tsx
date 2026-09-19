import { Pressable, StyleSheet, Text } from "react-native";
import { Link } from "expo-router";

export function E2eGate() {
  return (
    <>
      <Link href={"/e2e"} asChild>
        <Pressable
          testID="open-e2e-lab"
          accessibilityRole="link"
          accessibilityLabel="Open E2E lab"
          style={styles.gate}
        >
          <Text style={styles.label}>E2E lab</Text>
        </Pressable>
      </Link>
      <Link href="/e2e-credentials" asChild>
        <Pressable
          testID="open-e2e-credentials"
          accessibilityRole="link"
          accessibilityLabel="Open credentials lab"
          style={styles.secondaryGate}
        >
          <Text style={styles.label}>Credentials lab</Text>
        </Pressable>
      </Link>
    </>
  );
}

const styles = StyleSheet.create({
  gate: {
    alignSelf: "flex-start",
    marginTop: 20,
    paddingVertical: 6,
  },
  secondaryGate: {
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  label: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
});
