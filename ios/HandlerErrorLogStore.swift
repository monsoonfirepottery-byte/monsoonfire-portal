import Foundation

struct HandlerLogEntry: Codable, Identifiable {
    let id: String
    let atIso: String
    let label: String
    let message: String
}

enum HandlerErrorLogStore {
    private static let key = "mf_handler_error_log_v1"
    private static let maxEntries = 100

    static func log(_ error: Error, label: String = "ui-handler") {
        let message = String(describing: error)
        let entry = HandlerLogEntry(
            id: UUID().uuidString.lowercased(),
            atIso: ISO8601DateFormatter().string(from: Date()),
            label: label,
            message: message
        )
        var entries = readEntries()
        entries.append(entry)
        writeEntries(entries)
    }

    static func readEntries() -> [HandlerLogEntry] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        do {
            let entries = try JSONDecoder().decode([HandlerLogEntry].self, from: data)
            return entries
        } catch {
            return []
        }
    }

    static func clear() {
        writeEntries([])
    }

    private static func writeEntries(_ entries: [HandlerLogEntry]) {
        let bounded = Array(entries.suffix(maxEntries))
        guard let data = try? JSONEncoder().encode(bounded) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
