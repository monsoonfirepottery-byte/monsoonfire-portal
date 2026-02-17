import Foundation

private func toJSONValue<T: Encodable>(_ value: T) -> JSONValue {
    do {
        let enc = JSONEncoder()
        let data = try enc.encode(value)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
        return decoded
    } catch {
        return .object(["_encodeError": .string(error.localizedDescription)])
    }
}

private func decodeAnyJsonValue(_ data: Data) -> JSONValue? {
    if data.isEmpty { return nil }
    if let j = try? JSONDecoder().decode(JSONValue.self, from: data) { return j }
    if let s = String(data: data, encoding: .utf8) { return .string(s) }
    return nil
}

private func getErrorMessage(from body: JSONValue?) -> String {
    guard let body else { return "Request failed" }
    switch body {
    case .string(let s):
        return s
    case .object(let o):
        if case .string(let msg)? = o["message"] { return msg }
        if case .string(let err)? = o["error"] { return err }
        if case .string(let details)? = o["details"] { return details }
        return "Request failed"
    default:
        return "Request failed"
    }
}

private func getErrorCode(from body: JSONValue?) -> String? {
    guard let body else { return nil }
    guard case .object(let o) = body else { return nil }
    guard case .string(let code)? = o["code"] else { return nil }
    return code
}

private func nowIso() -> String {
    ISO8601DateFormatter().string(from: Date())
}

private func requestId() -> String {
    UUID().uuidString.lowercased()
}

private func escapeSingleQuotes(_ s: String) -> String {
    // mimic bash-safe escaping used in many curl examples
    s.replacingOccurrences(of: "'", with: "'\\''")
}

private func buildCurl(url: String, hasAdmin: Bool, payloadJson: String) -> String {
    var headers = [
        "-H 'Content-Type: application/json'",
        "-H 'Authorization: Bearer <ID_TOKEN>'"
    ]
    if hasAdmin {
        headers.append("-H 'x-admin-token: <ADMIN_TOKEN>'")
    }
    return "curl -X POST \(headers.joined(separator: " ")) -d '\(escapeSingleQuotes(payloadJson))' '\(url)'"
}

// MARK: - Client errors

enum PortalApiClientError: Error, CustomStringConvertible {
    case invalidURL(String, meta: PortalApiMeta?)
    case encodingFailed(String, meta: PortalApiMeta?)
    case networkFailed(String, meta: PortalApiMeta?)
    case serverError(status: Int, message: String, envelope: PortalApiErrorEnvelope?, meta: PortalApiMeta)
    case decodingFailed(String, meta: PortalApiMeta?)

    var description: String {
        switch self {
        case .invalidURL(let s, _): return "Invalid URL: \(s)"
        case .encodingFailed(let s, _): return "Encoding failed: \(s)"
        case .networkFailed(let s, _): return "Network failed: \(s)"
        case .serverError(let status, let message, _, _): return "HTTP \(status): \(message)"
        case .decodingFailed(let s, _): return "Decoding failed: \(s)"
        }
    }
}

// MARK: - Portal API client

final class PortalApiClient {
    struct Config {
        let baseUrl: String
        init(baseUrl: String) {
            self.baseUrl = baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
    }

    struct CallResult<T: Decodable> {
        let data: T
        let meta: PortalApiMeta
    }

    private let config: Config
    private let session: URLSession

    init(config: Config, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    // Generic post (mirrors portalApi.ts)
    func post<TReq: Encodable, TResp: Decodable>(
        fn: String,
        idToken: String,
        adminToken: String?,
        payload: TReq,
        respType: TResp.Type = TResp.self
    ) async throws -> CallResult<TResp> {

        let fullUrl = "\(config.baseUrl)/\(fn)"
        guard let url = URL(string: fullUrl) else {
            throw PortalApiClientError.invalidURL(fullUrl, meta: nil)
        }

        // Encode payload (pretty + stable keys helps debugging)
        let jsonData: Data
        let payloadJson: String
        do {
            let enc = JSONEncoder()
            enc.outputFormatting = [.prettyPrinted, .sortedKeys]
            jsonData = try enc.encode(payload)
            payloadJson = String(data: jsonData, encoding: .utf8) ?? "{}"
        } catch {
            throw PortalApiClientError.encodingFailed(error.localizedDescription, meta: nil)
        }

        var meta = PortalApiMeta(
            atIso: nowIso(),
            requestId: requestId(),
            fn: fn,
            url: fullUrl,
            payload: toJSONValue(payload),
            curlExample: buildCurl(url: fullUrl, hasAdmin: (adminToken?.isEmpty == false), payloadJson: payloadJson),
            status: nil,
            ok: nil,
            response: nil,
            error: nil,
            message: nil,
            code: nil
        )

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        if let adminToken, !adminToken.isEmpty {
            req.setValue(adminToken, forHTTPHeaderField: "x-admin-token")
        }
        req.httpBody = jsonData

        let data: Data
        let http: HTTPURLResponse
        do {
            let (d, r) = try await session.data(for: req)
            data = d
            guard let h = r as? HTTPURLResponse else {
                meta.ok = false
                meta.error = "Non-HTTP response"
                meta.message = "Non-HTTP response"
                throw PortalApiClientError.networkFailed("Non-HTTP response", meta: meta)
            }
            http = h
        } catch {
            let msg = error.localizedDescription
            meta.ok = false
            meta.error = msg
            meta.message = msg
            throw PortalApiClientError.networkFailed(msg, meta: meta)
        }

        meta.status = http.statusCode
        meta.ok = (200...299).contains(http.statusCode)
        meta.response = decodeAnyJsonValue(data)

        // Handle non-2xx as error envelope if possible
        if !(200...299).contains(http.statusCode) {
            let code = getErrorCode(from: meta.response)
            let msg = getErrorMessage(from: meta.response)
            let env = try? JSONDecoder().decode(PortalApiErrorEnvelope.self, from: data)
            meta.error = msg
            meta.message = msg
            meta.code = code ?? env?.code
            throw PortalApiClientError.serverError(status: http.statusCode, message: msg, envelope: env, meta: meta)
        }

        // Decode success
        do {
            let decoded = try JSONDecoder().decode(TResp.self, from: data)
            return CallResult(data: decoded, meta: meta)
        } catch {
            meta.ok = false
            meta.error = "Decoding failed"
            meta.message = error.localizedDescription
            throw PortalApiClientError.decodingFailed(error.localizedDescription, meta: meta)
        }
    }

    // MARK: - Typed helpers (optional convenience)

    func createBatch(idToken: String, adminToken: String?, payload: CreateBatchRequest) async throws -> CallResult<CreateBatchResponse> {
        try await post(fn: "createBatch", idToken: idToken, adminToken: adminToken, payload: payload, respType: CreateBatchResponse.self)
    }

    func pickedUpAndClose(idToken: String, adminToken: String?, payload: PickedUpAndCloseRequest) async throws -> CallResult<PickedUpAndCloseResponse> {
        try await post(fn: "pickedUpAndClose", idToken: idToken, adminToken: adminToken, payload: payload, respType: PickedUpAndCloseResponse.self)
    }

    func continueJourney(idToken: String, adminToken: String?, payload: ContinueJourneyRequest) async throws -> CallResult<ContinueJourneyResponse> {
        try await post(fn: "continueJourney", idToken: idToken, adminToken: adminToken, payload: payload, respType: ContinueJourneyResponse.self)
    }

    func listMaterialsProducts(idToken: String, adminToken: String?, payload: ListMaterialsProductsRequest) async throws -> CallResult<ListMaterialsProductsResponse> {
        try await post(fn: "listMaterialsProducts", idToken: idToken, adminToken: adminToken, payload: payload, respType: ListMaterialsProductsResponse.self)
    }

    func createMaterialsCheckoutSession(idToken: String, adminToken: String?, payload: CreateMaterialsCheckoutSessionRequest) async throws -> CallResult<CreateMaterialsCheckoutSessionResponse> {
        try await post(fn: "createMaterialsCheckoutSession", idToken: idToken, adminToken: adminToken, payload: payload, respType: CreateMaterialsCheckoutSessionResponse.self)
    }

    func seedMaterialsCatalog(idToken: String, adminToken: String?, payload: SeedMaterialsCatalogRequest) async throws -> CallResult<SeedMaterialsCatalogResponse> {
        try await post(fn: "seedMaterialsCatalog", idToken: idToken, adminToken: adminToken, payload: payload, respType: SeedMaterialsCatalogResponse.self)
    }

    func createReservation(idToken: String, adminToken: String?, payload: CreateReservationRequest) async throws -> CallResult<CreateReservationResponse> {
        try await post(fn: "createReservation", idToken: idToken, adminToken: adminToken, payload: payload, respType: CreateReservationResponse.self)
    }

    func listEvents(idToken: String, adminToken: String?, payload: ListEventsRequest) async throws -> CallResult<ListEventsResponse> {
        try await post(fn: "listEvents", idToken: idToken, adminToken: adminToken, payload: payload, respType: ListEventsResponse.self)
    }

    func listEventSignups(idToken: String, adminToken: String?, payload: ListEventSignupsRequest) async throws -> CallResult<ListEventSignupsResponse> {
        try await post(fn: "listEventSignups", idToken: idToken, adminToken: adminToken, payload: payload, respType: ListEventSignupsResponse.self)
    }

    func listBillingSummary(idToken: String, adminToken: String?, payload: ListBillingSummaryRequest) async throws -> CallResult<BillingSummaryResponse> {
        try await post(fn: "listBillingSummary", idToken: idToken, adminToken: adminToken, payload: payload, respType: BillingSummaryResponse.self)
    }

    func getEvent(idToken: String, adminToken: String?, payload: GetEventRequest) async throws -> CallResult<GetEventResponse> {
        try await post(fn: "getEvent", idToken: idToken, adminToken: adminToken, payload: payload, respType: GetEventResponse.self)
    }

    func createEvent(idToken: String, adminToken: String?, payload: CreateEventRequest) async throws -> CallResult<CreateEventResponse> {
        try await post(fn: "createEvent", idToken: idToken, adminToken: adminToken, payload: payload, respType: CreateEventResponse.self)
    }

    func publishEvent(idToken: String, adminToken: String?, payload: PublishEventRequest) async throws -> CallResult<PublishEventResponse> {
        try await post(fn: "publishEvent", idToken: idToken, adminToken: adminToken, payload: payload, respType: PublishEventResponse.self)
    }

    func signupForEvent(idToken: String, adminToken: String?, payload: SignupForEventRequest) async throws -> CallResult<SignupForEventResponse> {
        try await post(fn: "signupForEvent", idToken: idToken, adminToken: adminToken, payload: payload, respType: SignupForEventResponse.self)
    }

    func cancelEventSignup(idToken: String, adminToken: String?, payload: CancelEventSignupRequest) async throws -> CallResult<CancelEventSignupResponse> {
        try await post(fn: "cancelEventSignup", idToken: idToken, adminToken: adminToken, payload: payload, respType: CancelEventSignupResponse.self)
    }

    func claimEventOffer(idToken: String, adminToken: String?, payload: ClaimEventOfferRequest) async throws -> CallResult<ClaimEventOfferResponse> {
        try await post(fn: "claimEventOffer", idToken: idToken, adminToken: adminToken, payload: payload, respType: ClaimEventOfferResponse.self)
    }

    func checkInEvent(idToken: String, adminToken: String?, payload: CheckInEventRequest) async throws -> CallResult<CheckInEventResponse> {
        try await post(fn: "checkInEvent", idToken: idToken, adminToken: adminToken, payload: payload, respType: CheckInEventResponse.self)
    }

    func createEventCheckoutSession(idToken: String, adminToken: String?, payload: CreateEventCheckoutSessionRequest) async throws -> CallResult<CreateEventCheckoutSessionResponse> {
        try await post(fn: "createEventCheckoutSession", idToken: idToken, adminToken: adminToken, payload: payload, respType: CreateEventCheckoutSessionResponse.self)
    }

    func importLibraryIsbns(idToken: String, adminToken: String?, payload: ImportLibraryIsbnsRequest) async throws -> CallResult<ImportLibraryIsbnsResponse> {
        try await post(fn: "importLibraryIsbns", idToken: idToken, adminToken: adminToken, payload: payload, respType: ImportLibraryIsbnsResponse.self)
    }

    func registerDeviceToken(idToken: String, adminToken: String?, payload: RegisterDeviceTokenRequest) async throws -> CallResult<RegisterDeviceTokenResponse> {
        try await post(fn: "registerDeviceToken", idToken: idToken, adminToken: adminToken, payload: payload, respType: RegisterDeviceTokenResponse.self)
    }

    func unregisterDeviceToken(idToken: String, adminToken: String?, payload: UnregisterDeviceTokenRequest) async throws -> CallResult<UnregisterDeviceTokenResponse> {
        try await post(fn: "unregisterDeviceToken", idToken: idToken, adminToken: adminToken, payload: payload, respType: UnregisterDeviceTokenResponse.self)
    }

    func runNotificationFailureDrill(idToken: String, adminToken: String?, payload: RunNotificationFailureDrillRequest) async throws -> CallResult<RunNotificationFailureDrillResponse> {
        try await post(fn: "runNotificationFailureDrill", idToken: idToken, adminToken: adminToken, payload: payload, respType: RunNotificationFailureDrillResponse.self)
    }

    func runNotificationMetricsAggregationNow(idToken: String, adminToken: String?, payload: RunNotificationMetricsAggregationNowRequest = .init()) async throws -> CallResult<RunNotificationMetricsAggregationNowResponse> {
        try await post(fn: "runNotificationMetricsAggregationNow", idToken: idToken, adminToken: adminToken, payload: payload, respType: RunNotificationMetricsAggregationNowResponse.self)
    }
}
