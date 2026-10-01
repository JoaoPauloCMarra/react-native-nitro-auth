#pragma once
    #include <memory>
    #include <string>
    #include "HybridObject.hpp"

    namespace margelo { namespace nitro {
      class HybridObjectRegistry {
      public:
        HybridObjectRegistry() = delete;
        static std::shared_ptr<HybridObject> createHybridObject(const std::string& hybridObjectName);
      };
    }}
