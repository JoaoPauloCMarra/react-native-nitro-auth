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