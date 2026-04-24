/* eslint-disable no-console */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const coverageEnabled = process.argv.includes("--coverage");
const coverageThreshold = 90;
const includeDir = path.join(__dirname, "../cpp");
const nitrogenDir = path.join(__dirname, "../nitrogen/generated/shared/c++");
const mockIncludeDir = path.join(__dirname, "../cpp/__tests__/mock_includes");
const coverageDir = path.join(__dirname, "../cpp/__tests__/.coverage");
const tests = [
  {
    name: "serializer",
    sources: [path.join(__dirname, "../cpp/__tests__/JSONSerializerTests.cpp")],
    output: path.join(__dirname, "../cpp/__tests__/serializer_tests"),
    coverageSources: [path.join(__dirname, "../cpp/JSONSerializer.hpp")],
  },
  {
    name: "hybrid-auth",
    sources: [
      path.join(__dirname, "../cpp/HybridAuth.cpp"),
      path.join(__dirname, "../cpp/__tests__/HybridAuthTests.cpp"),
    ],
    output: path.join(__dirname, "../cpp/__tests__/hybrid_auth_tests"),
    coverageSources: [path.join(__dirname, "../cpp/HybridAuth.cpp")],
  },
];

function resolveTool(name) {
  const pathResult = spawnSync("bash", ["-lc", `command -v ${name}`], {
    encoding: "utf8",
  });
  const resolvedPath = pathResult.stdout.trim();
  if (pathResult.status === 0 && resolvedPath) {
    return resolvedPath;
  }

  const homebrewPath = `/opt/homebrew/opt/llvm/bin/${name}`;
  if (fs.existsSync(homebrewPath)) {
    return homebrewPath;
  }

  throw new Error(`${name} is required for C++ coverage`);
}

function cleanupCoverageDir() {
  if (fs.existsSync(coverageDir)) {
    fs.rmSync(coverageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(coverageDir, { recursive: true });
}

function parseTotalLine(output) {
  const totalLine = output
    .split("\n")
    .find((line) => line.trim().startsWith("TOTAL"));
  if (!totalLine) {
    throw new Error("Unable to find TOTAL line in C++ coverage output");
  }

  const percentages = [...totalLine.matchAll(/(\d+(?:\.\d+)?)%/g)].map(
    (match) => Number(match[1]),
  );
  if (percentages.length < 3) {
    throw new Error(`Unable to parse coverage percentages: ${totalLine}`);
  }

  return {
    region: percentages[0],
    function: percentages[1],
    line: percentages[2],
    branch: percentages[3],
  };
}

function assertCoverage(reportOutput) {
  const total = parseTotalLine(reportOutput);
  const enforced = {
    function: total.function,
    line: total.line,
  };
  const failures = Object.entries(enforced).filter(
    ([, value]) => typeof value === "number" && value < coverageThreshold,
  );

  if (failures.length > 0) {
    console.error(reportOutput);
    for (const [kind, value] of failures) {
      console.error(
        `C++ ${kind} coverage ${value}% is below ${coverageThreshold}%`,
      );
    }
    process.exit(1);
  }

  console.log(
    `C++ coverage passed: regions ${total.region}%, functions ${total.function}%, lines ${total.line}%, branches ${total.branch}%`,
  );
}

const nitroModulesDir = path.join(mockIncludeDir, "NitroModules");
if (!fs.existsSync(nitroModulesDir)) {
  fs.mkdirSync(nitroModulesDir, { recursive: true });
}

const mocks = {
  "JSIConverter.hpp": `
    #pragma once
    #include <string>
    #include <vector>
    #include <optional>
    #include <cstdint>
    #include <stdexcept>
    
    namespace facebook { 
      namespace jsi { 
        class Runtime {}; 
        class Value;
        class Object {
        public:
          Object() {}
          Object(Runtime&) {}
          Value getProperty(Runtime&, const char*);
          void setProperty(Runtime&, const char*, Value);
        };
        class Value {
        public:
          Value() {}
          Value(const Object&) {}
          Value(const char*) {}
          bool isString() const { return true; }
          bool isObject() const { return true; }
          Object asObject(Runtime&) const { return Object(); }
          Object getObject(Runtime&) const { return Object(); }
        };
        inline Value Object::getProperty(Runtime&, const char*) { return Value(); }
        inline void Object::setProperty(Runtime&, const char*, Value) {}
      }
    }

    namespace margelo { 
      namespace nitro { 
        namespace jsi = facebook::jsi;

        template<typename T> struct JSIConverter {
          static T fromJSI(jsi::Runtime&, const jsi::Value&) { return T(); }
          static jsi::Value toJSI(jsi::Runtime&, const T&) { return jsi::Value(); }
          static bool canConvert(jsi::Runtime&, const jsi::Value&) { return true; }
        };
        
        inline bool isPlainObject(jsi::Runtime&, const jsi::Object&) { return true; }
      }
    }
  `,
  "HybridObject.hpp": `
    #pragma once
    #include <memory>
    #include <string>

    namespace margelo { namespace nitro {
      class HybridObject : public std::enable_shared_from_this<HybridObject> {
      public:
        explicit HybridObject(const char* name) : _name(name) {}
        virtual ~HybridObject() = default;
        HybridObject(const HybridObject&) = delete;
        HybridObject& operator=(const HybridObject&) = delete;

      protected:
        virtual void loadHybridMethods() {}

      private:
        const char* _name;
      };
    }}
  `,
  "NitroDefines.hpp": `
    #pragma once
    #define SWIFT_PRIVATE
    #define SWIFT_NAME(x)
    #define CLOSED_ENUM
  `,
  "NitroHash.hpp": `
    #pragma once
    #include <cstdint>
    #include <cstddef>
    namespace margelo { namespace nitro {
      constexpr uint64_t hashString(const char* str, size_t len) {
        uint64_t hash = 14695981039346656037ULL;
        for (size_t i = 0; i < len; ++i) {
          hash ^= static_cast<uint64_t>(str[i]);
          hash *= 1099511628211ULL;
        }
        return hash;
      }
      constexpr uint64_t hashString(const char* str) {
        uint64_t hash = 14695981039346656037ULL;
        while (*str) {
          hash ^= static_cast<uint64_t>(*str++);
          hash *= 1099511628211ULL;
        }
        return hash;
      }
    }}
  `,
  "JSIHelpers.hpp": `
    #pragma once
  `,
  "PropNameIDCache.hpp": `
    #pragma once
    namespace facebook { namespace jsi { class Runtime; } }
    namespace margelo { namespace nitro {
      struct PropNameIDCache {
        static inline const char* get(facebook::jsi::Runtime&, const char* name) { return name; }
      };
    }}
  `,
  "Promise.hpp": `
    #pragma once
    #include <memory>
    #include <functional>
    #include <exception>
    #include <stdexcept>
    #include <variant>
    #include <vector>
    namespace margelo { namespace nitro {
      template<typename T>
      class Promise {
      public:
        using OnResolvedFunc = std::function<void(const T&)>;
        using OnRejectedFunc = std::function<void(const std::exception_ptr&)>;

        static std::shared_ptr<Promise<T>> create() { return std::make_shared<Promise<T>>(); }
        void resolve(const T& value) {
          if (!isPending()) throw std::runtime_error("promise already settled");
          _state = value;
          for (const auto& listener : _onResolvedListeners) listener(std::get<T>(_state));
          didFinish();
        }
        void reject(const std::exception_ptr& ex) {
          if (!isPending()) throw std::runtime_error("promise already settled");
          _state = ex;
          for (const auto& listener : _onRejectedListeners) listener(ex);
          didFinish();
        }
        void addOnResolvedListener(OnResolvedFunc onResolved) {
          if (isResolved()) {
            onResolved(std::get<T>(_state));
            return;
          }
          if (isPending()) _onResolvedListeners.push_back(std::move(onResolved));
        }
        void addOnRejectedListener(OnRejectedFunc onRejected) {
          if (isRejected()) {
            onRejected(std::get<std::exception_ptr>(_state));
            return;
          }
          if (isPending()) _onRejectedListeners.push_back(std::move(onRejected));
        }
        bool isPending() const { return std::holds_alternative<std::monostate>(_state); }
        bool isResolved() const { return std::holds_alternative<T>(_state); }
        bool isRejected() const { return std::holds_alternative<std::exception_ptr>(_state); }
        const T& getResult() const { return std::get<T>(_state); }
        const std::exception_ptr& getError() const { return std::get<std::exception_ptr>(_state); }

      private:
        void didFinish() {
          _onResolvedListeners.clear();
          _onRejectedListeners.clear();
        }

      private:
        std::variant<std::monostate, T, std::exception_ptr> _state;
        std::vector<OnResolvedFunc> _onResolvedListeners;
        std::vector<OnRejectedFunc> _onRejectedListeners;
      };
      template<>
      class Promise<void> {
      public:
        using OnResolvedFunc = std::function<void()>;
        using OnRejectedFunc = std::function<void(const std::exception_ptr&)>;

        static std::shared_ptr<Promise<void>> create() { return std::make_shared<Promise<void>>(); }
        void resolve() {
          if (!isPending()) throw std::runtime_error("promise already settled");
          _isResolved = true;
          for (const auto& listener : _onResolvedListeners) listener();
          didFinish();
        }
        void reject(const std::exception_ptr& ex) {
          if (!isPending()) throw std::runtime_error("promise already settled");
          _error = ex;
          for (const auto& listener : _onRejectedListeners) listener(ex);
          didFinish();
        }
        void addOnResolvedListener(OnResolvedFunc onResolved) {
          if (isResolved()) {
            onResolved();
            return;
          }
          if (isPending()) _onResolvedListeners.push_back(std::move(onResolved));
        }
        void addOnRejectedListener(OnRejectedFunc onRejected) {
          if (isRejected()) {
            onRejected(_error);
            return;
          }
          if (isPending()) _onRejectedListeners.push_back(std::move(onRejected));
        }
        bool isPending() const { return !_isResolved && _error == nullptr; }
        bool isResolved() const { return _isResolved; }
        bool isRejected() const { return _error != nullptr; }
        const std::exception_ptr& getError() const { return _error; }

      private:
        void didFinish() {
          _onResolvedListeners.clear();
          _onRejectedListeners.clear();
        }

      private:
        bool _isResolved = false;
        std::exception_ptr _error;
        std::vector<OnResolvedFunc> _onResolvedListeners;
        std::vector<OnRejectedFunc> _onRejectedListeners;
      };
    }}
  `,
};

for (const [file, content] of Object.entries(mocks)) {
  fs.writeFileSync(path.join(nitroModulesDir, file), content.trim());
}

if (coverageEnabled) {
  cleanupCoverageDir();
}

const coverageProfiles = [];
const coverageObjects = [];
const coverageSources = new Set();

for (const test of tests) {
  console.log(`Compiling ${test.name} C++ tests...`);
  const coverageFlags = coverageEnabled
    ? ["-fprofile-instr-generate", "-fcoverage-mapping"]
    : [];
  const compile = spawnSync(
    "clang++",
    [
      "-std=c++20",
      ...coverageFlags,
      "-I" + includeDir,
      "-I" + nitrogenDir,
      "-I" + mockIncludeDir,
      ...test.sources,
      "-o",
      test.output,
    ],
    { stdio: "inherit" },
  );

  if (compile.status !== 0) {
    console.error(`${test.name} compilation failed`);
    process.exit(1);
  }

  console.log(`Running ${test.name} C++ tests...`);
  const profilePath = path.join(coverageDir, `${test.name}.profraw`);
  const run = spawnSync(test.output, [], {
    stdio: "inherit",
    env: coverageEnabled
      ? { ...process.env, LLVM_PROFILE_FILE: profilePath }
      : process.env,
  });

  if (run.status !== 0) {
    console.error(`${test.name} tests failed`);
    process.exit(1);
  }

  if (coverageEnabled) {
    coverageProfiles.push(profilePath);
    coverageObjects.push(test.output);
    for (const source of test.coverageSources) {
      coverageSources.add(source);
    }
  }

  if (fs.existsSync(test.output)) {
    if (!coverageEnabled) {
      fs.unlinkSync(test.output);
    }
  }
}

if (coverageEnabled) {
  const profdata = resolveTool("llvm-profdata");
  const cov = resolveTool("llvm-cov");
  const mergedProfile = path.join(coverageDir, "coverage.profdata");

  const merge = spawnSync(
    profdata,
    ["merge", "-sparse", ...coverageProfiles, "-o", mergedProfile],
    { stdio: "inherit" },
  );
  if (merge.status !== 0) {
    console.error("C++ coverage profile merge failed");
    process.exit(1);
  }

  const [firstObject, ...additionalObjects] = coverageObjects;
  const reportArgs = [
    "report",
    firstObject,
    ...additionalObjects.flatMap((object) => ["-object", object]),
    "-instr-profile",
    mergedProfile,
    ...coverageSources,
  ];
  const report = spawnSync(cov, reportArgs, {
    encoding: "utf8",
  });
  if (report.status !== 0) {
    process.stdout.write(report.stdout);
    process.stderr.write(report.stderr);
    console.error("C++ coverage report failed");
    process.exit(1);
  }

  process.stdout.write(report.stdout);
  assertCoverage(report.stdout);

  for (const object of coverageObjects) {
    if (fs.existsSync(object)) {
      fs.unlinkSync(object);
    }
  }
}

console.log("C++ tests completed successfully");
