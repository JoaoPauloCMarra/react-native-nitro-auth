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
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    // The web OAuth adapter (Auth.web.ts) is covered by behavior fixtures and
    // the shared session-scenario suite. Its branch bar is lower because
    // browser-environment branches (TextDecoder fallback, window guards,
    // cross-origin popup timing) are not reachable in jsdom; statement, line,
    // and function coverage still meet the global bar.
    "src/Auth.web.ts": {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
