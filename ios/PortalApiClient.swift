import Foundation

// MARK: - Error Codes / Envelope (matches web/src/api/portalContracts.ts)

typealias PortalApiErrorCode = String

struct PortalApiErrorEnvelope: Decodable {
    var ok: Bool?
    var error: String?
    var message: String?
    var code: PortalApiErrorCode?
    var details: JSONValue?
}

// MARK: - Troubleshooting meta (matches PortalApiMeta in TS)

struct PortalApiMeta: Codable {
    var atIso: String
    var requestId: String
    var fn: String
    var url: String

    var payload: JSONValue
    var curlExample: String?

    var status: Int?
    var ok: Bool?

    var response: JSONValue?

    var error: String?
    var message: String?
    var code: PortalApiErrorCode?
}

// MARK: - JSONValue (for storing unknown JSON in meta)

enum JSONValue: Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw PortalApiClientError.decodingFailed("Unknown JSONValue")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

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
    case invalidURL(String)
    case encodingFailed(String)
    case networkFailed(String)
    case serverError(status: Int, message: String, envelope: PortalApiErrorEnvelope?, meta: PortalApiMeta)
    case decodingFailed(String)

    var description: String {
        switch self {
        case .invalidURL(let s): return "Invalid URL: \(s)"
        case .encodingFailed(let s): return "Encoding failed: \(s)"
        case .networkFailed(let s): return "Network failed: \(s)"
        case .serverError(let status, let message, _, _): return "HTTP \(status): \(message)"
        case .decodingFailed(let s): return "Decoding failed: \(s)"
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
            throw PortalApiClientError.invalidURL(fullUrl)
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
            throw PortalApiClientError.encodingFailed(error.localizedDescription)
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
                throw PortalApiClientError.networkFailed("Non-HTTP response")
            }
            http = h
        } catch {
            // Match web behavior: "Failed to fetch" style
            meta.ok = false
            meta.error = "Failed to fetch"
            meta.message = "Failed to fetch"
            throw PortalApiClientError.networkFailed(error.localizedDescription)
        }

        meta.status = http.statusCode
        meta.ok = (200...299).contains(http.statusCode)
        meta.response = decodeAnyJsonValue(data)

        // Handle non-2xx as error envelope if possible
        if !(200...299).contains(http.statusCode) {
            let env = try? JSONDecoder().decode(PortalApiErrorEnvelope.self, from: data)
            let msg = env?.message ?? env?.error ?? "Request failed"
            meta.error = msg
            meta.message = msg
            meta.code = env?.code
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
            throw PortalApiClientError.decodingFailed(error.localizedDescription)
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
}
