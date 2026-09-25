// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "NextBarCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "NextBarCore",
            targets: ["NextBarCore"]
        ),
    ],
    targets: [
        .target(
            name: "NextBarCore"
        ),
        .testTarget(
            name: "NextBarCoreTests",
            dependencies: ["NextBarCore"]
        ),
    ]
)
