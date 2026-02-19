import Foundation

// MARK: - Portal API Contracts
// Canonical Swift mirror of web/src/api/portalContracts.ts

typealias PortalFnName = String
typealias PortalApiErrorCode = String

struct PortalApiErrorEnvelope: Decodable {
    var ok: Bool?
    var error: String?
    var message: String?
    var code: PortalApiErrorCode?
    var details: JSONValue?
}

struct PortalApiOkEnvelope: Decodable {
    var ok: Bool
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
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unknown JSONValue")
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

// MARK: - Requests

struct CreateBatchRequest: Codable {
    let ownerUid: String
    let ownerDisplayName: String
    let title: String
    let kilnName: String?
    let intakeMode: String
    let estimatedCostCents: Int
    let estimateNotes: String?
    let notes: String?
    let clientRequestId: String?
}

struct ReservationPreferredWindow: Codable {
    let earliestDate: String?
    let latestDate: String?
}

struct CreateReservationRequest: Codable {
    let firingType: String
    let shelfEquivalent: Double
    let footprintHalfShelves: Double?
    let heightInches: Double?
    let tiers: Int?
    let estimatedHalfShelves: Double?
    let useVolumePricing: Bool?
    let volumeIn3: Double?
    let estimatedCost: Double?
    let preferredWindow: ReservationPreferredWindow?
    let linkedBatchId: String?
    let clientRequestId: String?
    let ownerUid: String?
    let wareType: String?
    let kilnId: String?
    let kilnLabel: String?
    let quantityTier: String?
    let quantityLabel: String?
    let photoUrl: String?
    let photoPath: String?
    let dropOffProfile: ReservationDropOffProfile?
    let dropOffQuantity: ReservationDropOffQuantity?
    let notes: ReservationNotes?
    let addOns: ReservationAddOns?
}

struct ReservationDropOffProfile: Codable {
    let id: String?
    let label: String?
    let pieceCount: String?
    let hasTall: Bool?
    let stackable: Bool?
    let bisqueOnly: Bool?
    let specialHandling: Bool?
}

struct ReservationDropOffQuantity: Codable {
    let id: String?
    let label: String?
    let pieceRange: String?
}

struct ReservationNotes: Codable {
    let general: String?
    let clayBody: String?
    let glazeNotes: String?
}

struct ReservationAddOns: Codable {
    let rushRequested: Bool?
    let wholeKilnRequested: Bool?
    let pickupDeliveryRequested: Bool?
    let returnDeliveryRequested: Bool?
    let useStudioGlazes: Bool?
    let glazeAccessCost: Double?
}

struct PickedUpAndCloseRequest: Codable {
    let uid: String
    let batchId: String
}

struct ContinueJourneyRequest: Codable {
    let uid: String
    let fromBatchId: String
}

struct UpdateReservationRequest: Codable {
    let reservationId: String
    let status: String
    let staffNotes: String?
}

struct AssignReservationStationRequest: Codable {
    let reservationId: String
    let assignedStationId: String
    let queueClass: String?
    let requiredResources: ReservationStationResources?
}

struct ReservationStationResources: Codable {
    let kilnProfile: String?
    let rackCount: Int?
    let specialHandling: [String]?
}

struct MaterialsCartItemRequest: Codable {
    let productId: String
    let quantity: Int
}

struct ListMaterialsProductsRequest: Codable {
    let includeInactive: Bool?
}

struct CreateMaterialsCheckoutSessionRequest: Codable {
    let items: [MaterialsCartItemRequest]
    let pickupNotes: String?
}

struct SeedMaterialsCatalogRequest: Codable {
    let force: Bool?
}

struct ListEventsRequest: Codable {
    let includeDrafts: Bool?
    let includeCancelled: Bool?
}

struct GetEventRequest: Codable {
    let eventId: String
}

struct ListEventSignupsRequest: Codable {
    let eventId: String
    let includeCancelled: Bool?
    let includeExpired: Bool?
    let limit: Int?
}

struct ListBillingSummaryRequest: Codable {
    let limit: Int?
    let from: String?
    let to: String?
}

struct EventAddOnInput: Codable {
    let id: String
    let title: String
    let priceCents: Int
    let isActive: Bool
}

struct CreateEventRequest: Codable {
    let templateId: String?
    let title: String
    let summary: String
    let description: String
    let location: String
    let timezone: String
    let startAt: String
    let endAt: String
    let capacity: Int
    let priceCents: Int
    let currency: String
    let includesFiring: Bool
    let firingDetails: String?
    let policyCopy: String?
    let addOns: [EventAddOnInput]?
    let waitlistEnabled: Bool?
    let offerClaimWindowHours: Int?
    let cancelCutoffHours: Int?
}

struct PublishEventRequest: Codable {
    let eventId: String
}

struct SignupForEventRequest: Codable {
    let eventId: String
}

struct CancelEventSignupRequest: Codable {
    let signupId: String
}

struct ClaimEventOfferRequest: Codable {
    let signupId: String
}

struct CheckInEventRequest: Codable {
    let signupId: String
    let method: String
}

struct CreateEventCheckoutSessionRequest: Codable {
    let eventId: String
    let signupId: String
    let addOnIds: [String]?
}

struct ImportLibraryIsbnsRequest: Codable {
    let isbns: [String]
    let source: String?
}

struct RegisterDeviceTokenRequest: Codable {
    let token: String
    let platform: String?
    let environment: String?
    let appVersion: String?
    let appBuild: String?
    let deviceModel: String?
}

struct UnregisterDeviceTokenRequest: Codable {
    let token: String?
    let tokenHash: String?
}

struct RunNotificationFailureDrillRequest: Codable {
    let uid: String
    let mode: String
    let channels: DrillChannels?
    let forceRunNow: Bool?
}

struct DrillChannels: Codable {
    let inApp: Bool?
    let email: Bool?
    let push: Bool?
}

struct RunNotificationMetricsAggregationNowRequest: Codable {}

// MARK: - Responses

struct CreateBatchResponse: Codable {
    let ok: Bool
    let batchId: String?
    let newBatchId: String?
    let existingBatchId: String?
}

struct PickedUpAndCloseResponse: Codable {
    let ok: Bool
}

struct ContinueJourneyResponse: Codable {
    let ok: Bool
    let batchId: String?
    let newBatchId: String?
    let existingBatchId: String?
    let rootId: String?
    let fromBatchId: String?
    let message: String?
}

struct CreateReservationResponse: Codable {
    let ok: Bool
    let reservationId: String?
    let status: String?
}

struct UpdateReservationResponse: Codable {
    let ok: Bool
    let reservationId: String?
    let status: String?
}

struct AssignReservationStationResponse: Codable {
    let ok: Bool
    let reservationId: String?
    let assignedStationId: String?
    let previousAssignedStationId: String?
    let stationCapacity: Int?
    let stationUsedAfter: Int?
    let idempotentReplay: Bool?
}

struct MaterialProduct: Codable {
    let id: String
    let name: String
    let description: String?
    let category: String?
    let sku: String?
    let priceCents: Int
    let currency: String
    let stripePriceId: String?
    let imageUrl: String?
    let trackInventory: Bool
    let inventoryOnHand: Int?
    let inventoryReserved: Int?
    let inventoryAvailable: Int?
    let active: Bool
}

struct ListMaterialsProductsResponse: Codable {
    let ok: Bool
    let products: [MaterialProduct]
}

struct CreateMaterialsCheckoutSessionResponse: Codable {
    let ok: Bool
    let orderId: String
    let checkoutUrl: String?
}

struct SeedMaterialsCatalogResponse: Codable {
    let ok: Bool
    let created: Int
    let updated: Int
    let total: Int
}

struct EventAddOn: Codable {
    let id: String
    let title: String
    let priceCents: Int
    let isActive: Bool
}

typealias EventStatus = String
typealias EventSignupStatus = String
typealias EventPaymentStatus = String

struct EventSummary: Codable {
    let id: String
    let title: String
    let summary: String
    let startAt: String?
    let endAt: String?
    let timezone: String?
    let location: String?
    let priceCents: Int
    let currency: String
    let includesFiring: Bool
    let firingDetails: String?
    let capacity: Int
    let waitlistEnabled: Bool
    let status: String
    let remainingCapacity: Int?
}

struct EventDetail: Codable {
    let id: String
    let title: String
    let summary: String
    let description: String
    let startAt: String?
    let endAt: String?
    let timezone: String?
    let location: String?
    let priceCents: Int
    let currency: String
    let includesFiring: Bool
    let firingDetails: String?
    let policyCopy: String?
    let addOns: [EventAddOn]?
    let capacity: Int
    let waitlistEnabled: Bool
    let offerClaimWindowHours: Int?
    let cancelCutoffHours: Int?
    let status: String
}

struct EventSignupSummary: Codable {
    let id: String
    let status: String
    let paymentStatus: String?
}

struct EventSignupRosterEntry: Codable {
    let id: String
    let uid: String?
    let displayName: String?
    let email: String?
    let status: String
    let paymentStatus: String?
    let createdAt: String?
    let offerExpiresAt: String?
    let checkedInAt: String?
    let checkInMethod: String?
}

struct ListEventsResponse: Codable {
    let ok: Bool
    let events: [EventSummary]
}

struct ListEventSignupsResponse: Codable {
    let ok: Bool
    let signups: [EventSignupRosterEntry]
}

struct GetEventResponse: Codable {
    let ok: Bool
    let event: EventDetail
    let signup: EventSignupSummary?
}

struct CreateEventResponse: Codable {
    let ok: Bool
    let eventId: String
}

struct PublishEventResponse: Codable {
    let ok: Bool
    let status: String
}

struct SignupForEventResponse: Codable {
    let ok: Bool
    let signupId: String
    let status: String
}

struct CancelEventSignupResponse: Codable {
    let ok: Bool
    let status: String
}

struct ClaimEventOfferResponse: Codable {
    let ok: Bool
    let status: String
}

struct CheckInEventResponse: Codable {
    let ok: Bool
    let status: String
    let paymentStatus: String?
}

struct CreateEventCheckoutSessionResponse: Codable {
    let ok: Bool
    let checkoutUrl: String?
}

struct ImportLibraryIsbnError: Codable {
    let isbn: String
    let message: String
}

struct ImportLibraryIsbnsResponse: Codable {
    let ok: Bool
    let requested: Int
    let created: Int
    let updated: Int
    let errors: [ImportLibraryIsbnError]?
}

struct RegisterDeviceTokenResponse: Codable {
    let ok: Bool
    let uid: String
    let tokenHash: String
}

struct UnregisterDeviceTokenResponse: Codable {
    let ok: Bool
    let uid: String
    let tokenHash: String
}

struct RunNotificationFailureDrillResponse: Codable {
    let ok: Bool
    let jobId: String
    let uid: String
    let mode: String
}

struct RunNotificationMetricsAggregationNowResponse: Codable {
    let ok: Bool
    let windowHours: Int
    let totalAttempts: Int
    let statusCounts: [String: Int]
    let reasonCounts: [String: Int]
    let providerCounts: [String: Int]
}

struct MaterialOrderItemSummary: Codable {
    let productId: String
    let name: String
    let quantity: Int
    let unitPrice: Int
    let currency: String
}

struct MaterialOrderSummary: Codable {
    let id: String
    let status: String
    let totalCents: Int
    let currency: String
    let pickupNotes: String?
    let checkoutUrl: String?
    let createdAt: String?
    let updatedAt: String?
    let items: [MaterialOrderItemSummary]
}

enum BillingReceiptType: String, Codable {
    case event
    case materials
}

struct BillingReceipt: Codable {
    let id: String
    let type: BillingReceiptType
    let sourceId: String?
    let title: String
    let amountCents: Int
    let currency: String
    let paidAt: String?
    let createdAt: String?
    let metadata: [String: JSONValue]?
}

struct BillingSummaryTotals: Codable {
    let unpaidCheckInsCount: Int
    let unpaidCheckInsAmountCents: Int
    let materialsPendingCount: Int
    let materialsPendingAmountCents: Int
    let receiptsCount: Int
    let receiptsAmountCents: Int
}

struct BillingSummaryResponse: Codable {
    let ok: Bool
    let unpaidCheckIns: [EventSignupRosterEntry]
    let materialsOrders: [MaterialOrderSummary]
    let receipts: [BillingReceipt]
    let summary: BillingSummaryTotals
}

func getResultBatchId(
    _ resp: CreateBatchResponse?
) -> String? {
    guard let resp else { return nil }
    return resp.newBatchId ?? resp.batchId ?? resp.existingBatchId
}

// MARK: - Timeline events (shared)

enum TimelineEventType: String, Codable {
    case createBatch = "CREATE_BATCH"
    case submitDraft = "SUBMIT_DRAFT"
    case shelved = "SHELVED"
    case kilnLoad = "KILN_LOAD"
    case kilnUnload = "KILN_UNLOAD"
    case assignedFiring = "ASSIGNED_FIRING"
    case readyForPickup = "READY_FOR_PICKUP"
    case pickedUpAndClose = "PICKED_UP_AND_CLOSE"
    case continueJourney = "CONTINUE_JOURNEY"
}

let TIMELINE_EVENT_LABELS: [TimelineEventType: String] = [
    .createBatch: "Batch created",
    .submitDraft: "Draft submitted",
    .shelved: "Shelved",
    .kilnLoad: "Loaded into kiln",
    .kilnUnload: "Unloaded from kiln",
    .assignedFiring: "Firing assigned",
    .readyForPickup: "Ready for pickup",
    .pickedUpAndClose: "Picked up & closed",
    .continueJourney: "Journey continued",
]
