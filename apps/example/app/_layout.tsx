import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthService } from "react-native-nitro-auth";

AuthService.setLoggingEnabled(true);

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </>
  );
}
