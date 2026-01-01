import { NitroModules } from "react-native-nitro-modules";
import type { Auth } from "./Auth.nitro";

export const AuthService = NitroModules.createHybridObject<Auth>("Auth");
