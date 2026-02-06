import Foundation

#if canImport(FirebaseAuth)
import FirebaseAuth
#endif

@MainActor
final class AuthSessionManager: ObservableObject {
    @Published var sdkAvailable = false
    @Published var isSignedIn = false
    @Published var userId: String?
    @Published var email: String?
    @Published var idToken: String = ""
    @Published var statusMessage = ""
    @Published var pendingEmailForLink: String = UserDefaults.standard.string(forKey: "mf_auth_pending_email") ?? ""

    #if canImport(FirebaseAuth)
    private var authStateHandle: AuthStateDidChangeListenerHandle?
    #endif

    init() {
        start()
    }

    deinit {
        #if canImport(FirebaseAuth)
        if let authStateHandle {
            Auth.auth().removeStateDidChangeListener(authStateHandle)
        }
        #endif
    }

    func start() {
        #if canImport(FirebaseAuth)
        sdkAvailable = true
        authStateHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                guard let self else { return }
                self.isSignedIn = user != nil
                self.userId = user?.uid
                self.email = user?.email
                if user == nil {
                    self.idToken = ""
                } else {
                    await self.refreshIdToken()
                }
            }
        }
        #else
        sdkAvailable = false
        statusMessage = "FirebaseAuth SDK not available in this build."
        #endif
    }

    func signInAnonymously() async {
        #if canImport(FirebaseAuth)
        do {
            _ = try await Auth.auth().signInAnonymously()
            statusMessage = "Signed in anonymously."
        } catch {
            statusMessage = "Anonymous sign-in failed: \(error.localizedDescription)"
            HandlerErrorLogStore.log(error, label: "ios-auth-signin-anon")
        }
        #else
        statusMessage = "FirebaseAuth SDK not available in this build."
        #endif
    }

    func refreshIdToken() async {
        #if canImport(FirebaseAuth)
        guard let user = Auth.auth().currentUser else {
            idToken = ""
            return
        }
        do {
            let token = try await user.getIDTokenResult(forcingRefresh: false).token
            idToken = token
            statusMessage = "Auth token refreshed."
        } catch {
            statusMessage = "Token refresh failed: \(error.localizedDescription)"
            HandlerErrorLogStore.log(error, label: "ios-auth-token-refresh")
        }
        #else
        statusMessage = "FirebaseAuth SDK not available in this build."
        #endif
    }

    func signOut() {
        #if canImport(FirebaseAuth)
        do {
            try Auth.auth().signOut()
            isSignedIn = false
            userId = nil
            email = nil
            idToken = ""
            statusMessage = "Signed out."
        } catch {
            statusMessage = "Sign-out failed: \(error.localizedDescription)"
            HandlerErrorLogStore.log(error, label: "ios-auth-signout")
        }
        #else
        statusMessage = "FirebaseAuth SDK not available in this build."
        #endif
    }

    func signInWithEmailPassword(email: String, password: String) async {
        #if canImport(FirebaseAuth)
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty else {
            statusMessage = "Email and password are required."
            return
        }
        do {
            _ = try await Auth.auth().signIn(withEmail: normalizedEmail, password: password)
            statusMessage = "Signed in with email/password."
        } catch {
            statusMessage = "Email/password sign-in failed: \(error.localizedDescription)"
            HandlerErrorLogStore.log(error, label: "ios-auth-signin-email-password")
        }
        #else
        statusMessage = "FirebaseAuth SDK not available in this build."
        #endif
    }

    func sendEmailSignInLink(email: String, continueUrl: URL) async {
        #if canImport(FirebaseAuth)
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty else {
            statusMessage = "Email is required for magic link."
            return
        }

        let settings = ActionCodeSettings()
        settings.handleCodeInApp = true
        settings.url = continueUrl
        if let bundleId = Bundle.main.bundleIdentifier {
            settings.setIOSBundleID(bundleId)
        }

        do {
            try await Auth.auth().sendSignInLink(toEmail: normalizedEmail, actionCodeSettings: settings)
            pendingEmailForLink = normalizedEmail
            UserDefaults.standard.set(normalizedEmail, forKey: "mf_auth_pending_email")
            statusMessage = "Magic link sent. Check your email."
        } catch {
            statusMessage = "Send magic link failed: \(error.localizedDescription)"
            HandlerErrorLogStore.log(error, label: "ios-auth-send-magic-link")
        }
        #else
        statusMessage = "FirebaseAuth SDK not available in this build."
        #endif
    }

    func completeEmailLinkSignIn(email: String?, link: String) async {
        #if canImport(FirebaseAuth)
        let trimmedLink = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedLink.isEmpty else {
            statusMessage = "Magic link is required."
            return
        }
        guard Auth.auth().isSignIn(withEmailLink: trimmedLink) else {
            statusMessage = "Provided URL is not a valid email sign-in link."
            return
        }

        let suppliedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let effectiveEmail = suppliedEmail.isEmpty
            ? pendingEmailForLink.trimmingCharacters(in: .whitespacesAndNewlines)
            : suppliedEmail

        guard !effectiveEmail.isEmpty else {
            statusMessage = "Email is required to complete magic-link sign-in."
            return
        }

        do {
            _ = try await Auth.auth().signIn(withEmail: effectiveEmail, link: trimmedLink)
            pendingEmailForLink = ""
            UserDefaults.standard.removeObject(forKey: "mf_auth_pending_email")
            statusMessage = "Signed in with magic link."
        } catch {
            statusMessage = "Magic-link sign-in failed: \(error.localizedDescription)"
            HandlerErrorLogStore.log(error, label: "ios-auth-complete-magic-link")
        }
        #else
        statusMessage = "FirebaseAuth SDK not available in this build."
        #endif
    }
}
