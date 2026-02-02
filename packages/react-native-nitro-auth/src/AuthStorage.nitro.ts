import type { HybridObject } from "react-native-nitro-modules";

/**
 * Custom storage adapter for persisting auth state.
 *
 * On native platforms, this must be a native HybridObject (Swift/Kotlin).
 * For JS-based storage (AsyncStorage, MMKV), use the JS wrapper approach
 * documented in the README.
 */
export interface AuthStorageAdapter extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  /**
   * Called to save a value to the custom storage.
   */
  save(key: string, value: string): void;
  /**
   * Called to load a value from the custom storage.
   */
  load(key: string): string | undefined;
  /**
   * Called to remove a value from the custom storage.
   */
  remove(key: string): void;
}
