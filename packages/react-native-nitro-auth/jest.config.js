module.exports = {
  testEnvironment: "jsdom",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(.*/)?(react-native|@react-native|react-native-nitro-modules)/)",
  ],
  testMatch: ["**/__tests__/**/*.test.(ts|tsx|js)"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.nitro.ts",
    "!src/__tests__/**",
    "!src/ui/**",
    "!src/index.ts",
    "!src/index.web.ts",
    "!src/service.web.ts",
    "!src/global.d.ts",
    // Browser OAuth is covered by behavior tests, but not included in the
    // package coverage gate because provider redirect branches are environment-owned.
    "!src/Auth.web.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
