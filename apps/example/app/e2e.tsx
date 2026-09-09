import { ScrollView, View } from "react-native";
import { AuthE2eLab } from "../components/e2e-lab";
import { SmokeTestCard } from "../components/SmokeTestCard";

export default function AuthE2eScreen() {
  return (
    <ScrollView
      testID="e2e-screen"
      accessibilityLabel="E2E lab"
      style={{ flex: 1, backgroundColor: "#f8fafc" }}
      contentContainerStyle={{ paddingTop: 48, paddingBottom: 40 }}
    >
      <AuthE2eLab />
      <View style={{ paddingHorizontal: 16 }}>
        <SmokeTestCard />
      </View>
    </ScrollView>
  );
}
