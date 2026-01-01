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