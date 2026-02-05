const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const testFile = path.join(
  __dirname,
  "../cpp/__tests__/JSONSerializerTests.cpp"
);
const includeDir = path.join(__dirname, "../cpp");
const nitrogenDir = path.join(__dirname, "../nitrogen/generated/shared/c++");
const outputFile = path.join(__dirname, "../cpp/__tests__/serializer_tests");
const mockIncludeDir = path.join(__dirname, "../cpp/__tests__/mock_includes");

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
    namespace margelo { namespace nitro {
      template<typename T>
      class Promise {
      public:
        static std::shared_ptr<Promise<T>> create() { return std::make_shared<Promise<T>>(); }
        void resolve(T value) {}
        void reject(std::exception_ptr ex) {}
      };
      template<>
      class Promise<void> {
      public:
        static std::shared_ptr<Promise<void>> create() { return std::make_shared<Promise<void>>(); }
        void resolve() {}
        void reject(std::exception_ptr ex) {}
      };
    }}
  `,
};

for (const [file, content] of Object.entries(mocks)) {
  fs.writeFileSync(path.join(nitroModulesDir, file), content.trim());
}

console.log("Compiling C++ tests...");
const compile = spawnSync(
  "clang++",
  [
    "-std=c++20",
    "-I" + includeDir,
    "-I" + nitrogenDir,
    "-I" + mockIncludeDir,
    testFile,
    "-o",
    outputFile,
  ],
  { stdio: "inherit" }
);

if (compile.status !== 0) {
  console.error("Compilation failed");
  process.exit(1);
}

console.log("Running C++ tests...");
const run = spawnSync(outputFile, [], { stdio: "inherit" });

if (run.status !== 0) {
  console.error("Tests failed");
  process.exit(1);
}

if (fs.existsSync(outputFile)) {
  fs.unlinkSync(outputFile);
}

console.log("C++ tests completed successfully");
