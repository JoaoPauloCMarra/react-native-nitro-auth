#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
};

const projectRoot = path.resolve(__dirname, "..");

function log(message, color = "green") {
  console.log(colors[color](message));
}

function execCommand(command, options = {}) {
  try {
    execSync(command, {
      stdio: "inherit",
      cwd: projectRoot,
      shell: true,
      ...options,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function commandExists(command) {
  try {
    const checkCommand =
      process.platform === "win32"
        ? `where ${command}`
        : `command -v ${command}`;
    execSync(checkCommand, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function main() {
  console.log("");
  log("🚀 Setting up react-native-nitro-auth...");
  console.log("");

  if (!commandExists("bun")) {
    log("Bun not found. Please install bun first:", "yellow");
    log("  • macOS/Linux: curl -fsSL https://bun.sh/install | bash", "cyan");
    log('  • Windows: powershell -c "irm bun.sh/install.ps1 | iex"', "cyan");
    log("  • Or visit: https://bun.sh/docs/installation", "cyan");
    process.exit(1);
  }

  log("📦 Installing dependencies...");
  if (!execCommand("bun install")) {
    log("Failed to install dependencies", "red");
    process.exit(1);
  }

  log("⚡ Generating Nitro bindings...");
  const packageDir = path.join(projectRoot, "packages/react-native-nitro-auth");
  execCommand("bun run codegen", { cwd: packageDir });

  log("🔨 Building library...");
  execCommand("bun run build", { cwd: packageDir });

  console.log("");
  log("✅ Setup complete!");
  console.log("");
  console.log("Next steps:");
  console.log("  1. cd apps/example");
  console.log("  2. bun run prebuild");
  console.log("  3. bun run ios  # or bun run android");
  console.log("");
}

main().catch((error) => {
  log(`Setup failed: ${error.message}`, "red");
  process.exit(1);
});
