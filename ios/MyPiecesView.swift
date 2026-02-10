import SwiftUI
import Foundation

#if canImport(FirebaseFirestore)
import FirebaseFirestore
#endif

struct BatchListItem: Identifiable {
    let id: String
    let title: String
    let isClosed: Bool
}

struct PieceListItem: Identifiable {
    let id: String
    let batchId: String
    let pieceCode: String
    let shortDesc: String
    let ownerName: String
    let stage: String
}

@available(iOS 15.0, *)
@MainActor
final class MyPiecesViewModel: ObservableObject {
    @Published var ownerUid = ""
    @Published var loadingBatches = false
    @Published var loadingPieces = false
    @Published var statusMessage = ""
    @Published var activeBatches: [BatchListItem] = []
    @Published var historyBatches: [BatchListItem] = []
    @Published var selectedBatchId: String?
    @Published var pieces: [PieceListItem] = []
    @Published var selectedPieceId: String?

    var selectedPiece: PieceListItem? {
        guard let selectedPieceId else { return nil }
        return pieces.first(where: { $0.id == selectedPieceId })
    }

    func loadBatches() async {
        let uid = ownerUid.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !uid.isEmpty else {
            statusMessage = "Enter owner UID to load pieces."
            return
        }
        loadingBatches = true
        statusMessage = ""
        defer { loadingBatches = false }

        do {
            let result = try await MyPiecesDataSource.fetchBatches(ownerUid: uid)
            activeBatches = result.active
            historyBatches = result.history
            if selectedBatchId == nil {
                selectedBatchId = result.active.first?.id ?? result.history.first?.id
            }
            if let batchId = selectedBatchId {
                await loadPieces(batchId: batchId)
            } else {
                pieces = []
                selectedPieceId = nil
                statusMessage = "No batches found for this user."
            }
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-myPieces-loadBatches")
            statusMessage = "Failed to load batches: \(error)"
        }
    }

    func loadPieces(batchId: String) async {
        loadingPieces = true
        statusMessage = ""
        defer { loadingPieces = false }
        selectedBatchId = batchId
        selectedPieceId = nil

        do {
            let fetched = try await MyPiecesDataSource.fetchPieces(batchId: batchId)
            pieces = fetched
            selectedPieceId = fetched.first?.id
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-myPieces-loadPieces")
            statusMessage = "Failed to load pieces: \(error)"
        }
    }
}

@available(iOS 15.0, *)
struct MyPiecesView: View {
    @StateObject private var vm = MyPiecesViewModel()

    var body: some View {
        Form {
            Section("My Pieces") {
                TextField("Owner UID", text: $vm.ownerUid)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button(vm.loadingBatches ? "Loading..." : "Load active + history batches") {
                    Task { await vm.loadBatches() }
                }
                .disabled(vm.loadingBatches)
            }

            Section("Batches") {
                if vm.activeBatches.isEmpty && vm.historyBatches.isEmpty {
                    Text("No batches loaded.")
                        .font(.footnote)
                } else {
                    ForEach(vm.activeBatches) { batch in
                        Button("Active · \(batch.title)") {
                            Task { await vm.loadPieces(batchId: batch.id) }
                        }
                    }
                    ForEach(vm.historyBatches) { batch in
                        Button("History · \(batch.title)") {
                            Task { await vm.loadPieces(batchId: batch.id) }
                        }
                    }
                }
            }

            Section("Pieces") {
                if vm.loadingPieces {
                    Text("Loading pieces...")
                        .font(.footnote)
                } else if vm.pieces.isEmpty {
                    Text("No pieces in selected batch.")
                        .font(.footnote)
                } else {
                    ForEach(vm.pieces) { piece in
                        Button("\(piece.pieceCode.isEmpty ? piece.id : piece.pieceCode) · \(piece.stage)") {
                            vm.selectedPieceId = piece.id
                        }
                    }
                }
            }

            Section("Detail") {
                if let piece = vm.selectedPiece {
                    Text("Piece: \(piece.pieceCode.isEmpty ? piece.id : piece.pieceCode)")
                    Text("Owner: \(piece.ownerName.isEmpty ? "Unknown" : piece.ownerName)")
                        .font(.footnote)
                    Text("Stage: \(piece.stage)")
                        .font(.footnote)
                    Text("Description: \(piece.shortDesc.isEmpty ? "None" : piece.shortDesc)")
                        .font(.footnote)
                    Text("Batch: \(piece.batchId)")
                        .font(.footnote)
                } else {
                    Text("Select a piece to view detail.")
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
        .navigationTitle("My Pieces")
    }
}

private enum MyPiecesDataSource {
    struct BatchBuckets {
        let active: [BatchListItem]
        let history: [BatchListItem]
    }

    static func fetchBatches(ownerUid: String) async throws -> BatchBuckets {
        #if canImport(FirebaseFirestore)
        let db = Firestore.firestore()
        let active = try await queryBatches(
            db: db,
            ownerUid: ownerUid,
            isClosed: false
        )
        let history = try await queryBatches(
            db: db,
            ownerUid: ownerUid,
            isClosed: true
        )
        return BatchBuckets(active: active, history: history)
        #else
        throw NSError(domain: "MyPiecesDataSource", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "FirebaseFirestore SDK not available in this build."
        ])
        #endif
    }

    static func fetchPieces(batchId: String) async throws -> [PieceListItem] {
        #if canImport(FirebaseFirestore)
        let db = Firestore.firestore()
        let query = db
            .collection("batches")
            .document(batchId)
            .collection("pieces")
            .order(by: "updatedAt", descending: true)
            .limit(to: 200)

        return try await withCheckedThrowingContinuation { continuation in
            query.getDocuments { snapshot, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let docs = snapshot?.documents ?? []
                let pieces = docs.map { doc -> PieceListItem in
                    let data = doc.data()
                    return PieceListItem(
                        id: doc.documentID,
                        batchId: batchId,
                        pieceCode: data["pieceCode"] as? String ?? "",
                        shortDesc: data["shortDesc"] as? String ?? "",
                        ownerName: data["ownerName"] as? String ?? "",
                        stage: data["stage"] as? String ?? "UNKNOWN"
                    )
                }
                continuation.resume(returning: pieces)
            }
        }
        #else
        throw NSError(domain: "MyPiecesDataSource", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "FirebaseFirestore SDK not available in this build."
        ])
        #endif
    }

    #if canImport(FirebaseFirestore)
    private static func queryBatches(
        db: Firestore,
        ownerUid: String,
        isClosed: Bool
    ) async throws -> [BatchListItem] {
        let query = db
            .collection("batches")
            .whereField("ownerUid", isEqualTo: ownerUid)
            .whereField("isClosed", isEqualTo: isClosed)
            .order(by: isClosed ? "closedAt" : "updatedAt", descending: true)
            .limit(to: 50)

        return try await withCheckedThrowingContinuation { continuation in
            query.getDocuments { snapshot, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let docs = snapshot?.documents ?? []
                let mapped = docs.map { doc -> BatchListItem in
                    let data = doc.data()
                    let title = (data["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                    return BatchListItem(
                        id: doc.documentID,
                        title: (title?.isEmpty == false) ? title! : "Check-in",
                        isClosed: isClosed
                    )
                }
                continuation.resume(returning: mapped)
            }
        }
    }
    #endif
}
