module.exports = {
  preset: "react-native",
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
    "!src/Auth.web.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
