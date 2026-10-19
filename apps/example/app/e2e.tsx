import { ScrollView, StyleSheet, View } from "react-native";
import { AuthE2eLab } from "../components/e2e-lab";
import { SmokeTestCard } from "../components/SmokeTestCard";
import { SocialButtonGallery } from "../components/social-button-gallery";

export default function AuthE2eScreen() {
  return (
    <ScrollView
      testID="e2e-screen"
      accessibilityLabel="E2E lab"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <SocialButtonGallery />
      <AuthE2eLab />
      <View style={styles.smoke}>
        <SmokeTestCard />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { paddingTop: 48, paddingBottom: 40 },
  smoke: { paddingHorizontal: 16 },
});
