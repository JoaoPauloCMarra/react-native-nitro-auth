// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "NitroAuthCoreTests",
  platforms: [.macOS(.v12)],
  targets: [
    .target(name: "NitroAuthCryptoC", path: "Sources/NitroAuthCryptoC"),
    .target(name: "NitroAuthCore", path: "Sources/NitroAuthCore"),
    .testTarget(
      name: "NitroAuthCoreTests",
      dependencies: ["NitroAuthCore", "NitroAuthCryptoC"],
      path: "Tests/NitroAuthCoreTests"
    ),
  ],
  cxxLanguageStandard: .cxx20
)
