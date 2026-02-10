// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "MonsoonFireGate",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "MonsoonFireGate", targets: ["MonsoonFireGate"])
  ],
  targets: [
    .executableTarget(
      name: "MonsoonFireGate",
      path: "Sources/MonsoonFireGate"
    )
  ]
)

