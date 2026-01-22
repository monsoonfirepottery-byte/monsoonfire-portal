import Foundation

// MARK: - Domain models (non-API contract)

struct TimelineEvent: Codable, Identifiable {
    let id: String
    let type: TimelineEventType?
    let at: Date?
    let actorName: String?
    let kilnName: String?
    let notes: String?
}
