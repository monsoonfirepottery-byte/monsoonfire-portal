import Foundation

// This target exists only as a compile gate. It is not shipped.
//
// Keep shapes minimal and Codable so contract drift breaks CI quickly.

enum PortalApiErrorCode: String, Codable {
  case unauthenticated = "UNAUTHENTICATED"
  case permissionDenied = "PERMISSION_DENIED"
  case invalidArgument = "INVALID_ARGUMENT"
  case notFound = "NOT_FOUND"
  case conflict = "CONFLICT"
  case failedPrecondition = "FAILED_PRECONDITION"
  case `internal` = "INTERNAL"
  case unknown = "UNKNOWN"
}

struct PortalApiErrorEnvelope: Codable {
  var ok: Bool?
  var error: String?
  var message: String?
  var code: PortalApiErrorCode?
  var details: JSONValue?
}

struct ContinueJourneyRequest: Codable {
  let uid: String
  let fromBatchId: String
}

struct ContinueJourneyResponse: Codable {
  let ok: Bool
  let newBatchId: String?
  let existingBatchId: String?
  let batchId: String?
  let message: String?
}

// Resilient JSON type so we can decode unknown `details` without failing.
enum JSONValue: Codable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null; return }
    if let v = try? container.decode(Bool.self) { self = .bool(v); return }
    if let v = try? container.decode(Double.self) { self = .number(v); return }
    if let v = try? container.decode(String.self) { self = .string(v); return }
    if let v = try? container.decode([String: JSONValue].self) { self = .object(v); return }
    if let v = try? container.decode([JSONValue].self) { self = .array(v); return }
    throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let v): try container.encode(v)
    case .number(let v): try container.encode(v)
    case .bool(let v): try container.encode(v)
    case .object(let v): try container.encode(v)
    case .array(let v): try container.encode(v)
    case .null: try container.encodeNil()
    }
  }
}

// Minimal "compile-time" sanity: ensure Codable conformance works with stable keys.
// This is never executed in CI (no `swift test`/run); it just ensures the types stay coherent.
_ = ContinueJourneyRequest(uid: "uid_123", fromBatchId: "batch_456")
_ = ContinueJourneyResponse(ok: true, newBatchId: "b1", existingBatchId: nil, batchId: nil, message: nil)

