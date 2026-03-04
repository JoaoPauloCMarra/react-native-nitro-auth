#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroAuthOnLoad.hpp"

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* reserved) {
  (void)reserved;
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::NitroAuth::registerAllNatives();
  });
}
