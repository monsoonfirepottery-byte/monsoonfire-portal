import Foundation

enum DeepLinkTarget: String {
    case events
    case materials
    case unknown
}

enum DeepLinkStatus: String {
    case success
    case cancel
    case unknown
}

struct DeepLinkRoute {
    let target: DeepLinkTarget
    let status: DeepLinkStatus
    let rawUrl: String
}

enum DeepLinkRouter {
    static func parse(_ url: URL) -> DeepLinkRoute {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let queryItems = components?.queryItems ?? []

        let statusValue = value(for: "status", in: queryItems)?.lowercased()
        let status: DeepLinkStatus
        switch statusValue {
        case "success":
            status = .success
        case "cancel", "canceled":
            status = .cancel
        default:
            status = .unknown
        }

        let path = url.path.lowercased()
        let flow = value(for: "flow", in: queryItems)?.lowercased() ?? ""
        let target: DeepLinkTarget
        if path.contains("event") || flow.contains("event") {
            target = .events
        } else if path.contains("material") || flow.contains("material") || path.contains("checkout") {
            target = .materials
        } else {
            target = .unknown
        }

        return DeepLinkRoute(
            target: target,
            status: status,
            rawUrl: url.absoluteString
        )
    }

    private static func value(for name: String, in queryItems: [URLQueryItem]) -> String? {
        queryItems.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame })?.value
    }
}
