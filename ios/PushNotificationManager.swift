import Foundation

#if canImport(UserNotifications)
import UserNotifications
#endif

@MainActor
final class PushNotificationManager: ObservableObject {
    private static let tokenStorageKey = "mf_push_device_token"
    private static let pendingTokenStorageKey = "mf_push_pending_device_token"
    private static let lastRegisteredHashStorageKey = "mf_push_last_registered_hash"

    @Published var supported = false
    @Published var authorizationStatus: String = "Unknown"
    @Published var notificationsEnabled = false
    @Published var statusMessage = ""
    @Published var registeredDeviceToken = UserDefaults.standard.string(forKey: tokenStorageKey) ?? ""
    @Published var pendingDeviceToken = UserDefaults.standard.string(forKey: pendingTokenStorageKey) ?? ""
    @Published var lastRegisteredTokenHash = UserDefaults.standard.string(forKey: lastRegisteredHashStorageKey) ?? ""

    init() {
        refreshAuthorizationStatus()
    }

    func refreshAuthorizationStatus() {
        #if canImport(UserNotifications)
        supported = true
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            Task { @MainActor in
                guard let self else { return }
                switch settings.authorizationStatus {
                case .authorized:
                    self.authorizationStatus = "Authorized"
                    self.notificationsEnabled = true
                case .denied:
                    self.authorizationStatus = "Denied"
                    self.notificationsEnabled = false
                case .notDetermined:
                    self.authorizationStatus = "Not determined"
                    self.notificationsEnabled = false
                case .provisional:
                    self.authorizationStatus = "Provisional"
                    self.notificationsEnabled = true
                case .ephemeral:
                    self.authorizationStatus = "Ephemeral"
                    self.notificationsEnabled = true
                @unknown default:
                    self.authorizationStatus = "Unknown"
                    self.notificationsEnabled = false
                }
            }
        }
        #else
        supported = false
        authorizationStatus = "Unsupported"
        notificationsEnabled = false
        #endif
    }

    func requestAuthorization() async {
        #if canImport(UserNotifications)
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound]
            )
            statusMessage = granted
                ? "Notification permission granted."
                : "Notification permission not granted."
        } catch {
            statusMessage = "Notification permission request failed: \(error.localizedDescription)"
            HandlerErrorLogStore.log(error, label: "ios-push-permission")
        }
        refreshAuthorizationStatus()
        #else
        statusMessage = "Notifications unsupported in this build."
        #endif
    }

    func registerDeviceToken(_ token: String) {
        let normalized = token
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
        guard !normalized.isEmpty else {
            statusMessage = "Device token is required."
            return
        }
        registeredDeviceToken = normalized
        pendingDeviceToken = normalized
        UserDefaults.standard.set(normalized, forKey: Self.tokenStorageKey)
        UserDefaults.standard.set(normalized, forKey: Self.pendingTokenStorageKey)
        statusMessage = "Device token captured and queued for backend registration."
    }

    func submitPendingToken(config: PortalAppConfig, idToken: String, adminToken: String?, isOnline: Bool) async {
        let pending = pendingDeviceToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !pending.isEmpty else {
            statusMessage = "No pending device token to submit."
            return
        }

        let authToken = idToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !authToken.isEmpty else {
            statusMessage = "Sign in before submitting device token."
            return
        }

        guard isOnline else {
            statusMessage = "Offline: token kept in local queue."
            return
        }

        let payload = RegisterDeviceTokenRequest(
            token: pending,
            platform: "ios",
            environment: config.environment == .production ? "production" : "sandbox",
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            appBuild: Bundle.main.infoDictionary?["CFBundleVersion"] as? String,
            deviceModel: nil
        )
        let client = PortalApiClient(config: .init(baseUrl: config.resolvedBaseUrl))

        do {
            let result = try await RetryExecutor.run(
                maxAttempts: 3,
                shouldRetry: { error in
                    let text = String(describing: error).lowercased()
                    return text.contains("network") || text.contains("timed out") || text.contains("offline")
                },
                operation: {
                    try await client.registerDeviceToken(
                        idToken: authToken,
                        adminToken: adminToken,
                        payload: payload
                    )
                }
            )
            pendingDeviceToken = ""
            lastRegisteredTokenHash = result.data.tokenHash
            UserDefaults.standard.removeObject(forKey: Self.pendingTokenStorageKey)
            UserDefaults.standard.set(result.data.tokenHash, forKey: Self.lastRegisteredHashStorageKey)
            statusMessage = "Device token registered."
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-registerDeviceToken")
            statusMessage = "Device token submit failed: \(error.localizedDescription)"
        }
    }

    func unregisterCurrentToken(config: PortalAppConfig, idToken: String, adminToken: String?, isOnline: Bool) async {
        let token = registeredDeviceToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            statusMessage = "No captured token to unregister."
            return
        }
        let authToken = idToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !authToken.isEmpty else {
            statusMessage = "Sign in before unregistering device token."
            return
        }
        guard isOnline else {
            statusMessage = "Offline: unable to unregister token."
            return
        }

        let client = PortalApiClient(config: .init(baseUrl: config.resolvedBaseUrl))
        do {
            _ = try await client.unregisterDeviceToken(
                idToken: authToken,
                adminToken: adminToken,
                payload: UnregisterDeviceTokenRequest(token: token, tokenHash: nil)
            )
            registeredDeviceToken = ""
            pendingDeviceToken = ""
            lastRegisteredTokenHash = ""
            UserDefaults.standard.removeObject(forKey: Self.tokenStorageKey)
            UserDefaults.standard.removeObject(forKey: Self.pendingTokenStorageKey)
            UserDefaults.standard.removeObject(forKey: Self.lastRegisteredHashStorageKey)
            statusMessage = "Device token unregistered."
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-unregisterDeviceToken")
            statusMessage = "Device token unregister failed: \(error.localizedDescription)"
        }
    }
}
