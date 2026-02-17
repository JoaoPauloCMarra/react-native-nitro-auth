const { defineConfig } = require("eslint/config");
const expoMagicConfig = require("eslint-config-expo-magic");

module.exports = defineConfig([
  ...expoMagicConfig,
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": "off",
    },
  },
  {
    files: ["src/Auth.nitro.ts"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": "off",
    },
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
      },
    },
  },
  {
    ignores: ["lib/**", "nitrogen/generated/**", "coverage/**"],
  },
]);
