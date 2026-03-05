# Nitro Auth Proguard Rules
-keep class com.auth.AuthAdapter {
    public static <methods>;
}
-keep class com.auth.MicrosoftAuthActivity { *; }
-keep class com.auth.GoogleSignInActivity { *; }
-keep class com.auth.NitroAuthModule { *; }
-keep class com.auth.NitroAuthPackage { *; }
-keep class com.margelo.nitro.com.auth.** { *; }
-keep class com.google.android.gms.auth.api.signin.** { *; }
