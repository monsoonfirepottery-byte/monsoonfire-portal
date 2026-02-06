import Foundation

enum PortalEnvironment: String, CaseIterable, Identifiable, Codable {
    case production
    case emulator
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .production: return "Production"
        case .emulator: return "Emulator"
        case .custom: return "Custom"
        }
    }
}

struct PortalAppConfig: Codable {
    var environment: PortalEnvironment
    var customBaseUrl: String?
    var idToken: String
    var adminToken: String?

    static let productionBaseUrl = "https://us-central1-monsoonfire-portal.cloudfunctions.net"
    static let emulatorBaseUrl = "http://127.0.0.1:5001/monsoonfire-portal/us-central1"

    static let defaults = PortalAppConfig(
        environment: .production,
        customBaseUrl: nil,
        idToken: "",
        adminToken: nil
    )

    var resolvedBaseUrl: String {
        switch environment {
        case .production:
            return Self.productionBaseUrl
        case .emulator:
            return Self.emulatorBaseUrl
        case .custom:
            let value = customBaseUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return value.isEmpty ? Self.productionBaseUrl : value
        }
    }
}
