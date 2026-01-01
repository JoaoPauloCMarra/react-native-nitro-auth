cmake_minimum_required(VERSION 3.18.0)

project(NitroAuth)

set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# 1. Define source files (Manual implementation)
file(GLOB SOURCES
  "../cpp/*.cpp"
  "./src/main/cpp/*.cpp"
)

# 2. Create the library target
add_library(
  NitroAuth
  SHARED
  ${SOURCES}
)

# 3. Include directories for manual sources
target_include_directories(
  NitroAuth
  PRIVATE
  "../cpp"
  "./src/main/cpp"
)

# 4. Include Nitrogen Autolinking (adds generated sources, finding packages, linking libs)
include("../nitrogen/generated/android/NitroAuth+autolinking.cmake")

# 5. Link standard Android libraries
target_link_libraries(
  NitroAuth
  android
  log
)
