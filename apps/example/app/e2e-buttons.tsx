import { ScrollView, StyleSheet } from "react-native";
import { SocialButtonBehaviorLab } from "../components/social-button-gallery";

export default function ButtonBehaviorScreen() {
  return (
    <ScrollView
      testID="e2e-buttons-screen"
      accessibilityLabel="Button behavior lab"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <SocialButtonBehaviorLab />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  content: {
    paddingBottom: 40,
    paddingTop: 48,
  },
});
