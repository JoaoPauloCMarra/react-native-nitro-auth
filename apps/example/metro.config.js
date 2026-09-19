/**
 * Metro config for the example app (monorepo development only).
 *
 * NOTE: Users installing react-native-nitro-auth from npm do NOT need
 * any special metro configuration. The package handles web support automatically
 * via the "browser" field in package.json.
 *
 * This config is only needed because:
 * 1. We're in a monorepo and need to watch local packages
 * 2. react-native-nitro-modules doesn't support web, so we exclude it
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders || []), monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

const generatedNitroModulesCxx = new RegExp(
  `${path
    .resolve(
      monorepoRoot,
      "node_modules/react-native-nitro-modules/android/.cxx",
    )
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[/\\\\].*`,
);
const bunOldNodeModules = new RegExp(
  `${path
    .resolve(monorepoRoot, "node_modules/.old-")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^/\\\\]+(?:[/\\\\].*)?$`,
);
config.resolver.blockList = Array.isArray(config.resolver.blockList)
  ? [...config.resolver.blockList, generatedNitroModulesCxx, bunOldNodeModules]
  : [
      config.resolver.blockList,
      generatedNitroModulesCxx,
      bunOldNodeModules,
    ].filter(Boolean);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web") {
    if (moduleName === "react-native-nitro-modules") {
      return { type: "empty" };
    }
    if (moduleName === "react-native-nitro-auth") {
      return context.resolveRequest(
        context,
        path.resolve(
          monorepoRoot,
          "packages/react-native-nitro-auth/src/index.web.ts",
        ),
        platform,
      );
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
