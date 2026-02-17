const { defineConfig } = require("eslint/config");
const expoMagicConfig = require("eslint-config-expo-magic");

module.exports = defineConfig([...expoMagicConfig]);
