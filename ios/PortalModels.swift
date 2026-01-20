
import Foundation

struct CreateBatchRequest: Codable {
    let ownerUid: String
    let ownerDisplayName: String
    let title: String
    let intakeMode: String
    let estimatedCostCents: Int
    let estimateNotes: String?
}

struct CreateBatchResponse: Codable {
    let ok: Bool
    let batchId: String?
    let message: String?
}

struct PickedUpAndCloseRequest: Codable {
    let batchId: String
    let uid: String
}

struct GenericOkResponse: Codable {
    let ok: Bool
    let message: String?
}

struct ContinueJourneyRequest: Codable {
    let uid: String
    let fromBatchId: String
}

struct ContinueJourneyResponse: Codable {
    let ok: Bool
    let batchId: String?
    let newBatchId: String?
    let existingBatchId: String?
    let message: String?
}

enum TimelineEventType: String, Codable {
    case createBatch = "CREATE_BATCH"
    case submitDraft = "SUBMIT_DRAFT"
    case pickedUpAndClose = "PICKED_UP_AND_CLOSE"
    case continueJourney = "CONTINUE_JOURNEY"
    case kilnLoad = "KILN_LOAD"
    case kilnUnload = "KILN_UNLOAD"
    case readyForPickup = "READY_FOR_PICKUP"
}

struct TimelineEvent: Codable, Identifiable {
    let id: String
    let type: TimelineEventType
    let at: Date
    let actorName: String?
    let kilnName: String?
    let notes: String?
}
