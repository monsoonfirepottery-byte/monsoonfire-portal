import Foundation

enum RetryExecutor {
    static func run<T>(
        maxAttempts: Int = 2,
        initialDelayMs: Int = 250,
        shouldRetry: @escaping (Error) -> Bool = defaultShouldRetry,
        operation: @escaping () async throws -> T
    ) async throws -> T {
        precondition(maxAttempts >= 1, "maxAttempts must be >= 1")

        var attempt = 0
        var delayMs = initialDelayMs

        while true {
            attempt += 1
            do {
                return try await operation()
            } catch {
                let hasNextAttempt = attempt < maxAttempts
                if !hasNextAttempt || !shouldRetry(error) {
                    throw error
                }
                try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
                delayMs *= 2
            }
        }
    }

    private static func defaultShouldRetry(_ error: Error) -> Bool {
        if error is URLError { return true }
        let text = String(describing: error).lowercased()
        if text.contains("timed out") { return true }
        if text.contains("network") { return true }
        if text.contains("offline") { return true }
        return false
    }
}
