const { withGradleProperties } = require("expo/config-plugins");

const SPEED_PROPERTIES = {
  "org.gradle.caching": "true",
  "org.gradle.parallel": "true",
  "org.gradle.jvmargs":
    "-Xmx6144m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError",
  "kotlin.daemon.jvmargs": "-Xmx3072m",
};

module.exports = function withGradleBuildSpeed(config) {
  return withGradleProperties(config, (config) => {
    const managedKeys = new Set(Object.keys(SPEED_PROPERTIES));
    config.modResults = config.modResults.filter(
      (item) => !(item.type === "property" && managedKeys.has(item.key)),
    );
    for (const [key, value] of Object.entries(SPEED_PROPERTIES)) {
      config.modResults.push({ type: "property", key, value });
    }
    return config;
  });
};
