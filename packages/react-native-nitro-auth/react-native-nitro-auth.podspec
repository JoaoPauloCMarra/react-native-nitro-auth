require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-nitro-auth"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/JoaoPauloCMarra/react-native-nitro-auth.git", :tag => "#{s.version}" }
  
  s.swift_version = "5.0"

  s.source_files = [
    "ios/**/*.{h,m,mm,swift}",
    "cpp/**/*.{h,hpp,c,cpp}"
  ]

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "CLANG_CXX_LIBRARY" => "libc++",
    "OTHER_LDFLAGS" => "-ObjC",
    "DEFINES_MODULE" => "YES",
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/cpp\"",
      "\"$(PODS_TARGET_SRCROOT)/nitrogen/generated/shared/c++\"",
      "\"$(PODS_TARGET_SRCROOT)/nitrogen/generated/ios\""
    ].join(" ")
  }

  s.dependency "React-Core"
  s.dependency "GoogleSignIn", "~> 8.0"
  
  load 'nitrogen/generated/ios/NitroAuth+autolinking.rb'
  add_nitrogen_files(s)
end
