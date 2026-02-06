import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@available(iOS 15.0, *)
@MainActor
final class PortalAppShellViewModel: ObservableObject {
    @Published var config: PortalAppConfig = .defaults
    @Published var statusMessage = ""
    @Published var loading = false
    @Published var logEntries: [HandlerLogEntry] = []
    @Published var coldStartMs: Int = AppPerformanceTracker.coldStartElapsedMs()
    @Published var lastSmokeDurationMs: Int?
    @Published var lastSmokeAttemptedRetry = false

    init() {
        refreshLogs()
    }

    func refreshLogs() {
        logEntries = HandlerErrorLogStore.readEntries().reversed()
    }

    func clearLogs() {
        HandlerErrorLogStore.clear()
        refreshLogs()
    }

    func runCreateBatchSmokeTest(idTokenOverride: String? = nil) async {
        if loading { return }
        let token = (idTokenOverride ?? config.idToken).trimmingCharacters(in: .whitespacesAndNewlines)
        if token.isEmpty {
            statusMessage = "Add an ID token before running API smoke test."
            return
        }

        loading = true
        statusMessage = ""
        defer { loading = false }

        let client = PortalApiClient(
            config: .init(baseUrl: config.resolvedBaseUrl)
        )

        let payload = CreateBatchRequest(
            ownerUid: "ios-smoke-user",
            ownerDisplayName: "iOS Smoke",
            title: "iOS Shell Smoke Batch",
            kilnName: nil,
            intakeMode: "STAFF_HANDOFF",
            estimatedCostCents: 2500,
            estimateNotes: "Smoke test from iOS shell",
            notes: nil
        )

        do {
            let startedAt = Date()
            lastSmokeAttemptedRetry = false
            let result = try await RetryExecutor.run(
                maxAttempts: 2,
                shouldRetry: { error in
                    let retry = String(describing: error).lowercased().contains("network")
                    if retry { self.lastSmokeAttemptedRetry = true }
                    return retry
                },
                operation: {
                    try await client.createBatch(
                        idToken: token,
                        adminToken: config.adminToken,
                        payload: payload
                    )
                }
            )
            let batchId = getResultBatchId(result.data) ?? "unknown"
            lastSmokeDurationMs = Int(Date().timeIntervalSince(startedAt) * 1000)
            coldStartMs = AppPerformanceTracker.coldStartElapsedMs()
            statusMessage = "Success: \(batchId)"
            refreshLogs()
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-createBatch")
            refreshLogs()
            statusMessage = "Request failed: \(error)"
        }
    }
}

@available(iOS 15.0, *)
struct PortalAppShellView: View {
    @StateObject private var vm = PortalAppShellViewModel()
    @StateObject private var networkMonitor = NetworkMonitor()
    @StateObject private var authSession = AuthSessionManager()
    @StateObject private var pushManager = PushNotificationManager()
    @State private var authEmail = ""
    @State private var authPassword = ""
    @State private var authEmailLink = ""
    @State private var deviceTokenInput = ""
    @State private var deepLinkStatusMessage = ""
    @State private var deepLinkRawUrl = ""
    @State private var routeToEvents = false
    @State private var routeToMaterials = false
    @State private var tokenCopyStatus = ""

    private var effectiveIdToken: String {
        let sessionToken = authSession.idToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if !sessionToken.isEmpty { return sessionToken }
        return vm.config.idToken.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSignedInResolved: Bool {
        !effectiveIdToken.isEmpty
    }

    private var isStaffResolved: Bool {
        let adminToken = vm.config.adminToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return isSignedInResolved && !adminToken.isEmpty
    }

    var body: some View {
        Group {
            if #available(iOS 16.0, *) {
                NavigationStack {
                    appShellForm
                }
            } else {
                NavigationView {
                    appShellForm
                }
            }
        }
    }

    private var appShellForm: some View {
        Form {
            Section("Environment") {
                if !networkMonitor.isOnline {
                    Text("Offline mode: network-dependent actions are unavailable.")
                        .font(.footnote)
                        .accessibilityLabel("Offline mode active")
                }
                Picker("Target", selection: $vm.config.environment) {
                    ForEach(PortalEnvironment.allCases) { env in
                        Text(env.label).tag(env)
                    }
                }

                if vm.config.environment == .custom {
                    TextField("Custom base URL", text: Binding(
                        get: { vm.config.customBaseUrl ?? "" },
                        set: { vm.config.customBaseUrl = $0 }
                    ))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                LabeledContent("Resolved base URL", value: vm.config.resolvedBaseUrl)
            }

            Section("Auth") {
                if authSession.sdkAvailable {
                    Text(authSession.isSignedIn ? "Session: signed in" : "Session: signed out")
                        .font(.footnote)
                    if let userId = authSession.userId {
                        Text("UID: \(userId)")
                            .font(.footnote)
                    }
                    if let email = authSession.email, !email.isEmpty {
                        Text("Email: \(email)")
                            .font(.footnote)
                    }
                    HStack {
                        Button("Sign in (anon)") {
                            Task { await authSession.signInAnonymously() }
                        }
                        Button("Refresh token") {
                            Task { await authSession.refreshIdToken() }
                        }
                        .disabled(!authSession.isSignedIn)
                        Button("Sign out") {
                            authSession.signOut()
                        }
                        .disabled(!authSession.isSignedIn)
                    }

                    TextField("Email", text: $authEmail)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                    SecureField("Password", text: $authPassword)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Sign in with email/password") {
                        Task {
                            await authSession.signInWithEmailPassword(
                                email: authEmail,
                                password: authPassword
                            )
                        }
                    }
                    .accessibilityLabel("Sign in with email and password")

                    Button("Send magic link") {
                        Task {
                            if let continueUrl = URL(string: PortalAppConfig.productionBaseUrl) {
                                await authSession.sendEmailSignInLink(
                                    email: authEmail,
                                    continueUrl: continueUrl
                                )
                            } else {
                                authSession.statusMessage = "Invalid continue URL configuration."
                            }
                        }
                    }
                    .accessibilityLabel("Send sign in magic link")

                    TextField("Magic link URL", text: $authEmailLink)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Complete magic-link sign-in") {
                        Task {
                            await authSession.completeEmailLinkSignIn(
                                email: authEmail,
                                link: authEmailLink
                            )
                        }
                    }
                    .accessibilityLabel("Complete magic link sign in")
                } else {
                    Text("FirebaseAuth SDK missing. Using manual token mode.")
                        .font(.footnote)
                }

                SecureField("Firebase ID token (manual fallback)", text: $vm.config.idToken)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Admin token (optional)", text: Binding(
                    get: { vm.config.adminToken ?? "" },
                    set: { vm.config.adminToken = $0.isEmpty ? nil : $0 }
                ))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !authSession.statusMessage.isEmpty {
                    Text(authSession.statusMessage)
                        .font(.footnote)
                }
                Text("Access: \(isSignedInResolved ? "Signed-in" : "Signed-out")")
                    .font(.footnote)
                Text("Role: \(isStaffResolved ? "Staff" : "Member")")
                    .font(.footnote)
                HStack {
                    Button("Copy ID token") {
                        copyToClipboard(effectiveIdToken, label: "ID token")
                    }
                    .disabled(effectiveIdToken.isEmpty)
                    Button("Copy UID") {
                        copyToClipboard(authSession.userId ?? "", label: "UID")
                    }
                    .disabled((authSession.userId ?? "").isEmpty)
                }
                if !tokenCopyStatus.isEmpty {
                    Text(tokenCopyStatus)
                        .font(.footnote)
                }
            }

            Section("Actions") {
                NavigationLink(
                    destination: EventsView(config: $vm.config),
                    isActive: $routeToEvents
                ) { EmptyView() }
                .hidden()

                NavigationLink(
                    destination: MaterialsView(config: $vm.config),
                    isActive: $routeToMaterials
                ) { EmptyView() }
                .hidden()

                Button(vm.loading ? "Running..." : "Run createBatch smoke test") {
                    Task { await vm.runCreateBatchSmokeTest(idTokenOverride: authSession.idToken) }
                }
                .disabled(vm.loading || !networkMonitor.isOnline || !isSignedInResolved)
                .accessibilityLabel("Run create batch smoke test")

                NavigationLink("Open reservation check-in form") {
                    ReservationsCheckInView(config: $vm.config)
                }
                .disabled(!isSignedInResolved)

                NavigationLink("Open My Pieces (read-only)") {
                    MyPiecesView()
                }

                NavigationLink("Open Kiln Schedule") {
                    KilnScheduleView(
                        isStaff: isStaffResolved,
                        staffUid: authSession.userId
                    )
                }
                .disabled(!isSignedInResolved)

                NavigationLink("Open Events") {
                    EventsView(config: $vm.config)
                }
                .disabled(!isSignedInResolved)

                NavigationLink("Open Materials") {
                    MaterialsView(config: $vm.config)
                }
                .disabled(!isSignedInResolved)

                NavigationLink("Open Billing") {
                    BillingView(config: $vm.config)
                }
                .disabled(!isSignedInResolved)
                if !isSignedInResolved {
                    Text("Sign in to access write-capable screens and actions.")
                        .font(.footnote)
                }
            }

            if !deepLinkStatusMessage.isEmpty {
                Section("Deep Link Callback") {
                    Text(deepLinkStatusMessage)
                        .font(.footnote)
                    if !deepLinkRawUrl.isEmpty {
                        Text(deepLinkRawUrl)
                            .font(.caption)
                    }
                }
            }

            Section("Performance") {
                Text("Cold start elapsed: \(vm.coldStartMs) ms")
                    .font(.footnote)
                Text("Network: \(networkMonitor.statusLabel)")
                    .font(.footnote)
                if let lastSmokeDurationMs = vm.lastSmokeDurationMs {
                    Text("Last smoke duration: \(lastSmokeDurationMs) ms")
                        .font(.footnote)
                }
                Text("Retry used: \(vm.lastSmokeAttemptedRetry ? "Yes" : "No")")
                    .font(.footnote)
            }

            Section("Notifications") {
                Text("Support: \(pushManager.supported ? "Available" : "Unavailable")")
                    .font(.footnote)
                Text("Authorization: \(pushManager.authorizationStatus)")
                    .font(.footnote)
                Text("Enabled: \(pushManager.notificationsEnabled ? "Yes" : "No")")
                    .font(.footnote)

                Button("Request notification permission") {
                    Task { await pushManager.requestAuthorization() }
                }
                .disabled(!pushManager.supported)

                Button("Refresh notification status") {
                    pushManager.refreshAuthorizationStatus()
                }
                .disabled(!pushManager.supported)

                TextField("APNs device token (hex)", text: $deviceTokenInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Capture device token") {
                    pushManager.registerDeviceToken(deviceTokenInput)
                }
                Button("Submit device token to backend") {
                    Task {
                        await pushManager.submitPendingToken(
                            config: vm.config,
                            idToken: effectiveIdToken,
                            adminToken: vm.config.adminToken,
                            isOnline: networkMonitor.isOnline
                        )
                    }
                }
                .disabled(pushManager.pendingDeviceToken.isEmpty || !isSignedInResolved)
                Button("Unregister device token") {
                    Task {
                        await pushManager.unregisterCurrentToken(
                            config: vm.config,
                            idToken: effectiveIdToken,
                            adminToken: vm.config.adminToken,
                            isOnline: networkMonitor.isOnline
                        )
                    }
                }
                .disabled(pushManager.registeredDeviceToken.isEmpty || !isSignedInResolved)
                if !pushManager.registeredDeviceToken.isEmpty {
                    Text("Captured token: \(pushManager.registeredDeviceToken)")
                        .font(.footnote)
                }
                if !pushManager.pendingDeviceToken.isEmpty {
                    Text("Pending submit token: \(pushManager.pendingDeviceToken)")
                        .font(.footnote)
                }
                if !pushManager.lastRegisteredTokenHash.isEmpty {
                    Text("Last token hash: \(pushManager.lastRegisteredTokenHash)")
                        .font(.footnote)
                }

                if !pushManager.statusMessage.isEmpty {
                    Text(pushManager.statusMessage)
                        .font(.footnote)
                }
            }

            if !vm.statusMessage.isEmpty {
                Section("Status") {
                    Text(vm.statusMessage)
                        .font(.footnote)
                }
            }

            Section("Handler Error Log") {
                if vm.logEntries.isEmpty {
                    Text("No logged handler errors.")
                        .font(.footnote)
                } else {
                    ForEach(vm.logEntries) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(entry.label) · \(entry.atIso)")
                                .font(.caption)
                            Text(entry.message)
                                .font(.footnote)
                        }
                    }
                }

                Button("Refresh log") {
                    vm.refreshLogs()
                }
                .disabled(vm.loading)

                Button("Clear log") {
                    vm.clearLogs()
                }
                .disabled(vm.loading || vm.logEntries.isEmpty)
            }
        }
        .navigationTitle("Monsoon Fire iOS")
        .onChange(of: authSession.idToken) { token in
            let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                vm.config.idToken = trimmed
                if !pushManager.pendingDeviceToken.isEmpty {
                    Task {
                        await pushManager.submitPendingToken(
                            config: vm.config,
                            idToken: trimmed,
                            adminToken: vm.config.adminToken,
                            isOnline: networkMonitor.isOnline
                        )
                    }
                }
            }
        }
        .onChange(of: networkMonitor.isOnline) { isOnline in
            if isOnline && !pushManager.pendingDeviceToken.isEmpty && isSignedInResolved {
                Task {
                    await pushManager.submitPendingToken(
                        config: vm.config,
                        idToken: effectiveIdToken,
                        adminToken: vm.config.adminToken,
                        isOnline: isOnline
                    )
                }
            }
        }
        .onOpenURL { url in
            let route = DeepLinkRouter.parse(url)
            deepLinkRawUrl = route.rawUrl
            switch route.status {
            case .success:
                deepLinkStatusMessage = "Callback success received."
            case .cancel:
                deepLinkStatusMessage = "Callback cancelled by user."
            case .unknown:
                deepLinkStatusMessage = "Callback received with unknown status."
            }

            switch route.target {
            case .events:
                routeToEvents = true
                routeToMaterials = false
            case .materials:
                routeToMaterials = true
                routeToEvents = false
            case .unknown:
                deepLinkStatusMessage += " No matching in-app route."
            }
        }
    }

    private func copyToClipboard(_ value: String, label: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            tokenCopyStatus = "\(label) is empty."
            return
        }
        #if canImport(UIKit)
        UIPasteboard.general.string = trimmed
        tokenCopyStatus = "\(label) copied."
        #else
        tokenCopyStatus = "Clipboard unavailable in this build."
        #endif
    }
}
