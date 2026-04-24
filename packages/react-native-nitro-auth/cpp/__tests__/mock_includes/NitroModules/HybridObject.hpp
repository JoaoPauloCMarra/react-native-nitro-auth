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