import Foundation

enum AppPerformanceTracker {
    private static let launchUptime = ProcessInfo.processInfo.systemUptime

    static func coldStartElapsedMs() -> Int {
        let now = ProcessInfo.processInfo.systemUptime
        return Int((now - launchUptime) * 1000)
    }
}
