#pragma once
    namespace facebook { namespace jsi { class Runtime; } }
    namespace margelo { namespace nitro {
      struct PropNameIDCache {
        static inline const char* get(facebook::jsi::Runtime&, const char* name) { return name; }
      };
    }}