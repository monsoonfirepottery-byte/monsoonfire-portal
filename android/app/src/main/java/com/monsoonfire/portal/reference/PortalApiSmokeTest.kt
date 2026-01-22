package com.monsoonfire.portal.reference

// Manual smoke test helper (reference only)

fun portalApiSmokeTest(idToken: String, adminToken: String) {
    val api = PortalApiClient(PortalApiClient.Config(baseUrl = "http://127.0.0.1:5001/monsoonfire-portal/us-central1"))

    val payload = CreateBatchRequest(
        ownerUid = "USER_UID",
        ownerDisplayName = "Display Name",
        title = "Test batch",
        kilnName = null,
        intakeMode = "STAFF_HANDOFF",
        estimatedCostCents = 2500,
        estimateNotes = null,
        notes = null
    )

    try {
        api.createBatch(
            idToken = idToken,
            adminToken = adminToken,
            payload = payload
        )
    } catch (err: PortalApiException) {
        println("portalApiSmokeTest failed: ${err.message}")
        println(err.meta)
    }
}
