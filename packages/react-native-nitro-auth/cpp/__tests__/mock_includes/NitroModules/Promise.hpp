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