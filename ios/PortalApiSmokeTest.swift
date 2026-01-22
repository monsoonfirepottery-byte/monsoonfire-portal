import Foundation

// MARK: - Smoke test helper (manual use only)
// Not invoked by default; keep as a reference snippet.

@available(iOS 15.0, *)
func portalApiSmokeTest() async {
    let api = PortalApiClient(
        config: .init(baseUrl: "http://127.0.0.1:5001/monsoonfire-portal/us-central1")
    )

    let payload = CreateBatchRequest(
        ownerUid: "USER_UID",
        ownerDisplayName: "Display Name",
        title: "Test batch",
        kilnName: nil,
        intakeMode: "STAFF_HANDOFF",
        estimatedCostCents: 2500,
        estimateNotes: nil,
        notes: nil
    )

    do {
        _ = try await api.createBatch(
            idToken: "ID_TOKEN",
            adminToken: "ADMIN_TOKEN",
            payload: payload
        )
    } catch {
        print("portalApiSmokeTest failed: \(error)")
    }
}
