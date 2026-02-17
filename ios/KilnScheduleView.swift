import SwiftUI
import Foundation

#if canImport(FirebaseFirestore)
import FirebaseFirestore
#endif

struct KilnListItem: Identifiable {
    let id: String
    let name: String
    let type: String
    let status: String
}

struct KilnFiringListItem: Identifiable {
    let id: String
    let kilnId: String
    let title: String
    let status: String
    let startAt: String
    let endAt: String
    let unloadedAt: String?
}

@available(iOS 15.0, *)
@MainActor
final class KilnScheduleViewModel: ObservableObject {
    @Published var staffUid = ""
    @Published var isStaff = false
    @Published var loading = false
    @Published var statusMessage = ""
    @Published var kilns: [KilnListItem] = []
    @Published var firings: [KilnFiringListItem] = []
    @Published var selectedFiringId: String?
    @Published var unloadBusy = false
    @Published var unloadError = ""

    var selectedFiring: KilnFiringListItem? {
        guard let selectedFiringId else { return nil }
        return firings.first(where: { $0.id == selectedFiringId })
    }

    func load() async {
        loading = true
        statusMessage = ""
        unloadError = ""
        defer { loading = false }
        do {
            let result = try await KilnScheduleDataSource.fetch()
            kilns = result.kilns
            firings = result.firings
            if selectedFiringId == nil {
                selectedFiringId = result.firings.first?.id
            }
            if result.kilns.isEmpty && result.firings.isEmpty {
                statusMessage = "No kiln schedule data found."
            }
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-kiln-load")
            statusMessage = "Failed to load kiln schedule: \(error)"
        }
    }

    func unloadSelectedFiring() async {
        guard isStaff else {
            unloadError = "Unload action is staff-only."
            return
        }
        guard let firing = selectedFiring else {
            unloadError = "Select a firing first."
            return
        }
        if firing.unloadedAt != nil {
            unloadError = "This firing is already marked unloaded."
            return
        }
        let uid = staffUid.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !uid.isEmpty else {
            unloadError = "Staff UID is required to mark unloaded."
            return
        }

        unloadBusy = true
        unloadError = ""
        statusMessage = ""
        defer { unloadBusy = false }

        do {
            try await KilnScheduleDataSource.markUnloaded(firingId: firing.id, staffUid: uid)
            statusMessage = "Marked unloaded."
            await load()
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-kiln-unload")
            unloadError = "Failed to mark unloaded: \(error)"
        }
    }
}

@available(iOS 15.0, *)
struct KilnScheduleView: View {
    @StateObject private var vm = KilnScheduleViewModel()
    let isStaff: Bool
    let staffUid: String?

    var body: some View {
        Form {
            Section("Kiln Schedule") {
                Text("Staff mode: \(isStaff ? "Enabled" : "Disabled")")
                    .font(.footnote)
                TextField("Staff UID (required for unload)", text: $vm.staffUid)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button(vm.loading ? "Loading..." : "Load kiln schedule") {
                    Task { await vm.load() }
                }
                .disabled(vm.loading)
            }

            Section("Kilns") {
                if vm.kilns.isEmpty {
                    Text("No kilns loaded.")
                        .font(.footnote)
                } else {
                    ForEach(vm.kilns) { kiln in
                        Text("\(kiln.name) · \(kiln.type) · \(kiln.status)")
                            .font(.footnote)
                    }
                }
            }

            Section("Firings") {
                if vm.firings.isEmpty {
                    Text("No firings loaded.")
                        .font(.footnote)
                } else {
                    ForEach(vm.firings) { firing in
                        Button("\(firing.title) · \(firing.status)") {
                            vm.selectedFiringId = firing.id
                        }
                    }
                }
            }

            Section("Selected Firing") {
                if let firing = vm.selectedFiring {
                    Text("Title: \(firing.title)")
                    Text("Status: \(firing.status)")
                        .font(.footnote)
                    Text("Start: \(firing.startAt)")
                        .font(.footnote)
                    Text("End: \(firing.endAt)")
                        .font(.footnote)
                    Text("Unloaded: \(firing.unloadedAt ?? "No")")
                        .font(.footnote)
                    Button(vm.unloadBusy ? "Marking..." : "Mark unloaded (staff)") {
                        Task { await vm.unloadSelectedFiring() }
                    }
                    .disabled(vm.unloadBusy || !vm.isStaff || firing.unloadedAt != nil)
                } else {
                    Text("Select a firing to view details.")
                        .font(.footnote)
                }
            }

            if !vm.unloadError.isEmpty {
                Section("Unload Error") {
                    Text(vm.unloadError)
                        .font(.footnote)
                }
            }

            if !vm.statusMessage.isEmpty {
                Section("Status") {
                    Text(vm.statusMessage)
                        .font(.footnote)
                }
            }
        }
        .navigationTitle("Kiln Schedule")
        .onAppear {
            vm.isStaff = isStaff
            if let staffUid, !staffUid.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                vm.staffUid = staffUid
            }
        }
    }
}

private enum KilnScheduleDataSource {
    struct FetchResult {
        let kilns: [KilnListItem]
        let firings: [KilnFiringListItem]
    }

    static func fetch() async throws -> FetchResult {
        #if canImport(FirebaseFirestore)
        let db = Firestore.firestore()
        let kilnQuery = db.collection("kilns").order(by: "name", descending: false).limit(to: 25)
        let firingQuery = db.collection("kilnFirings").order(by: "startAt", descending: false).limit(to: 200)

        async let kilnDocs = getDocuments(query: kilnQuery)
        async let firingDocs = getDocuments(query: firingQuery)
        let (kdocs, fdocs) = try await (kilnDocs, firingDocs)

        let kilns = kdocs.map { doc -> KilnListItem in
            let data = doc.data()
            return KilnListItem(
                id: doc.documentID,
                name: data["name"] as? String ?? "Kiln",
                type: data["type"] as? String ?? "unknown",
                status: data["status"] as? String ?? "unknown"
            )
        }

        let firings = fdocs.map { doc -> KilnFiringListItem in
            let data = doc.data()
            return KilnFiringListItem(
                id: doc.documentID,
                kilnId: data["kilnId"] as? String ?? "",
                title: data["title"] as? String ?? "Firing",
                status: data["status"] as? String ?? "unknown",
                startAt: stringFromDateValue(data["startAt"]),
                endAt: stringFromDateValue(data["endAt"]),
                unloadedAt: optionalStringFromDateValue(data["unloadedAt"])
            )
        }

        return FetchResult(kilns: kilns, firings: firings)
        #else
        throw NSError(domain: "KilnScheduleDataSource", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "FirebaseFirestore SDK not available in this build."
        ])
        #endif
    }

    static func markUnloaded(firingId: String, staffUid: String) async throws {
        #if canImport(FirebaseFirestore)
        let ref = Firestore.firestore().collection("kilnFirings").document(firingId)
        try await withCheckedThrowingContinuation { continuation in
            ref.updateData([
                "unloadedAt": FieldValue.serverTimestamp(),
                "unloadedByUid": staffUid,
            ]) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
        #else
        throw NSError(domain: "KilnScheduleDataSource", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "FirebaseFirestore SDK not available in this build."
        ])
        #endif
    }

    #if canImport(FirebaseFirestore)
    private static func getDocuments(query: Query) async throws -> [QueryDocumentSnapshot] {
        try await withCheckedThrowingContinuation { continuation in
            query.getDocuments { snapshot, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: snapshot?.documents ?? [])
            }
        }
    }

    private static func optionalStringFromDateValue(_ value: Any?) -> String? {
        guard let value else { return nil }
        return stringFromDateValue(value)
    }

    private static func stringFromDateValue(_ value: Any?) -> String {
        guard let value else { return "Unknown" }
        if let timestamp = value as? Timestamp {
            return ISO8601DateFormatter().string(from: timestamp.dateValue())
        }
        if let date = value as? Date {
            return ISO8601DateFormatter().string(from: date)
        }
        if let raw = value as? String {
            return raw
        }
        return "Unknown"
    }
    #endif
}
