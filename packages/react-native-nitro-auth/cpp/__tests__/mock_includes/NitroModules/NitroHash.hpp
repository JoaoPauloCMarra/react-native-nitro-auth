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