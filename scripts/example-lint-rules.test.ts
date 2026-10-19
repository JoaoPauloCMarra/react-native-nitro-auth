import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";

const exampleRoot = path.resolve(__dirname, "../apps/example");

async function lintFixture(source: string): Promise<string[]> {
  const eslint = new ESLint({
    cwd: exampleRoot,
    overrideConfigFile: path.join(exampleRoot, "eslint.config.js"),
  });
  const [result] = await eslint.lintText(source, {
    filePath: path.join(exampleRoot, "components/e2e-gate.tsx"),
  });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "compiler-bailout/no-try-finally")
    .map((message) => message.message);
}

test("a component with try/catch/finally is rejected", async () => {
  const messages = await lintFixture(`
import { useRef } from "react";
import { Text } from "react-native";

export function Fixture() {
  const ref = useRef(false);
  const run = async () => {
    try {
      await Promise.resolve();
    } catch {
      return;
    } finally {
      ref.current = false;
    }
  };
  return <Text onPress={run}>fixture</Text>;
}
`);
  assert.equal(messages.length, 1);
});

test("a hook with try/finally and no catch is rejected", async () => {
  const messages = await lintFixture(`
export function useFixture() {
  try {
    return 1;
  } finally {
    console.log("done");
  }
}
`);
  assert.equal(messages.length, 1);
});

test("try/catch without finally is accepted", async () => {
  const messages = await lintFixture(`
import { Text } from "react-native";

export function Fixture() {
  try {
    JSON.parse("{}");
  } catch {
    return null;
  }
  return <Text>fixture</Text>;
}
`);
  assert.equal(messages.length, 0);
});
