const { defineConfig } = require("eslint/config");
const expoMagicConfig = require("eslint-config-expo-magic");

module.exports = defineConfig([
  { ignores: ["expo-env.d.ts"] },
  ...expoMagicConfig,
  {
    plugins: {
      "compiler-bailout": {
        rules: {
          "no-try-without-catch": {
            meta: {
              type: "problem",
              schema: [],
              messages: {
                bailout:
                  'Never write try/finally without catch inside a React component or hook. The compiler cannot lower it ("Handle TryStatement without a catch clause") and skips the whole function. Use promise.finally() for async cleanup, or a real catch that handles or reports the error. try/catch/finally is not this bailout.',
              },
            },
            create(context) {
              function functionContainsJsx(fn) {
                const stack = [fn.body];
                const seen = new Set();
                while (stack.length > 0) {
                  const current = stack.pop();
                  if (
                    !current ||
                    typeof current !== "object" ||
                    seen.has(current)
                  ) {
                    continue;
                  }
                  seen.add(current);
                  if (
                    current.type === "JSXElement" ||
                    current.type === "JSXFragment"
                  ) {
                    return true;
                  }
                  for (const key of Object.keys(current)) {
                    if (key === "parent" || key === "loc" || key === "range") {
                      continue;
                    }
                    const value = current[key];
                    if (Array.isArray(value)) {
                      for (const item of value) {
                        stack.push(item);
                      }
                    } else if (value && typeof value === "object") {
                      stack.push(value);
                    }
                  }
                }
                return false;
              }

              function isCompiledFunction(fn) {
                const name =
                  (fn.id && fn.id.name) ||
                  (fn.parent &&
                    fn.parent.type === "VariableDeclarator" &&
                    fn.parent.id.type === "Identifier" &&
                    fn.parent.id.name);
                if (typeof name === "string" && /^use[A-Z0-9]/.test(name)) {
                  return true;
                }
                return functionContainsJsx(fn);
              }

              return {
                "TryStatement[handler=null]"(node) {
                  if (!node.finalizer) {
                    return;
                  }

                  let current = node.parent;
                  let insideCompiledFunction = false;
                  while (current) {
                    if (
                      current.type === "FunctionDeclaration" ||
                      current.type === "FunctionExpression" ||
                      current.type === "ArrowFunctionExpression"
                    ) {
                      if (isCompiledFunction(current)) {
                        insideCompiledFunction = true;
                        break;
                      }
                    }
                    current = current.parent;
                  }

                  if (insideCompiledFunction) {
                    context.report({ node, messageId: "bailout" });
                  }
                },
              };
            },
          },
        },
      },
    },
    rules: {
      "compiler-bailout/no-try-without-catch": "error",
    },
  },
]);
