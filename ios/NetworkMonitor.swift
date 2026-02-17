import Foundation

#if canImport(Network)
import Network
#endif

@MainActor
final class NetworkMonitor: ObservableObject {
    @Published var isOnline: Bool = true
    @Published var statusLabel: String = "Online"

    #if canImport(Network)
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ios.network.monitor")
    #endif

    init() {
        #if canImport(Network)
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                let online = path.status == .satisfied
                self?.isOnline = online
                self?.statusLabel = online ? "Online" : "Offline"
            }
        }
        monitor.start(queue: queue)
        #else
        isOnline = true
        statusLabel = "Unknown"
        #endif
    }

    deinit {
        #if canImport(Network)
        monitor.cancel()
        #endif
    }
}
