package com.monsoonfire.portal.reference

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// Canonical Kotlin mirror of web/src/api/portalContracts.ts

typealias PortalFnName = String
typealias PortalApiErrorCode = String

@Serializable
data class PortalApiErrorEnvelope(
    val ok: Boolean? = null,
    val error: String? = null,
    val message: String? = null,
    val code: PortalApiErrorCode? = null,
    val details: JsonElement? = null
)

@Serializable
data class PortalApiOkEnvelope(
    val ok: Boolean
)

@Serializable
data class PortalApiMeta(
    val atIso: String,
    val requestId: String,
    val fn: String,
    val url: String,
    val payload: JsonElement,
    val curlExample: String? = null,
    val status: Int? = null,
    val ok: Boolean? = null,
    val response: JsonElement? = null,
    val error: String? = null,
    val message: String? = null,
    val code: PortalApiErrorCode? = null
)

@Serializable
data class CreateBatchRequest(
    val ownerUid: String,
    val ownerDisplayName: String,
    val title: String,
    val kilnName: String? = null,
    val intakeMode: String,
    val estimatedCostCents: Int,
    val estimateNotes: String? = null,
    val notes: String? = null,
    val clientRequestId: String? = null
)

@Serializable
data class ReservationPreferredWindow(
    val earliestDate: String? = null,
    val latestDate: String? = null
)

@Serializable
data class CreateReservationRequest(
    val firingType: String,
    val shelfEquivalent: Double,
    val preferredWindow: ReservationPreferredWindow? = null,
    val linkedBatchId: String? = null
)

@Serializable
data class PickedUpAndCloseRequest(
    val uid: String,
    val batchId: String
)

@Serializable
data class ContinueJourneyRequest(
    val uid: String,
    val fromBatchId: String
)

@Serializable
data class UpdateReservationRequest(
    val reservationId: String,
    val status: String,
    val staffNotes: String? = null
)

@Serializable
data class AssignReservationStationRequest(
    val reservationId: String,
    val assignedStationId: String,
    val queueClass: String? = null,
    val requiredResources: AssignedStationRequiredResources? = null
)

@Serializable
data class AssignedStationRequiredResources(
    val kilnProfile: String? = null,
    val rackCount: Int? = null,
    val specialHandling: List<String>? = null
)

@Serializable
data class MaterialsCartItemRequest(
    val productId: String,
    val quantity: Int
)

@Serializable
data class ListMaterialsProductsRequest(
    val includeInactive: Boolean? = null
)

@Serializable
data class CreateMaterialsCheckoutSessionRequest(
    val items: List<MaterialsCartItemRequest>,
    val pickupNotes: String? = null
)

@Serializable
data class SeedMaterialsCatalogRequest(
    val force: Boolean? = null
)

@Serializable
data class ListEventsRequest(
    val includeDrafts: Boolean? = null,
    val includeCancelled: Boolean? = null
)

@Serializable
data class GetEventRequest(
    val eventId: String
)

@Serializable
data class ListEventSignupsRequest(
    val eventId: String,
    val includeCancelled: Boolean? = null,
    val includeExpired: Boolean? = null,
    val limit: Int? = null
)

@Serializable
data class ListBillingSummaryRequest(
    val limit: Int? = null,
    val from: String? = null,
    val to: String? = null
)

@Serializable
data class ImportLibraryIsbnsRequest(
    val isbns: List<String>,
    val source: String? = null
)

@Serializable
data class RegisterDeviceTokenRequest(
    val token: String,
    val platform: String? = null,
    val environment: String? = null,
    val appVersion: String? = null,
    val appBuild: String? = null,
    val deviceModel: String? = null
)

@Serializable
data class UnregisterDeviceTokenRequest(
    val token: String? = null,
    val tokenHash: String? = null
)

@Serializable
data class RunNotificationFailureDrillRequest(
    val uid: String,
    val mode: String,
    val channels: NotificationFailureDrillChannels? = null,
    val forceRunNow: Boolean? = null
)

@Serializable
data class NotificationFailureDrillChannels(
    val inApp: Boolean? = null,
    val email: Boolean? = null,
    val push: Boolean? = null
)

@Serializable
data class RunNotificationMetricsAggregationNowRequest(
)

@Serializable
data class EventAddOnInput(
    val id: String,
    val title: String,
    val priceCents: Int,
    val isActive: Boolean
)

@Serializable
data class CreateEventRequest(
    val templateId: String? = null,
    val title: String,
    val summary: String,
    val description: String,
    val location: String,
    val timezone: String,
    val startAt: String,
    val endAt: String,
    val capacity: Int,
    val priceCents: Int,
    val currency: String,
    val includesFiring: Boolean,
    val firingDetails: String? = null,
    val policyCopy: String? = null,
    val addOns: List<EventAddOnInput>? = null,
    val waitlistEnabled: Boolean? = null,
    val offerClaimWindowHours: Int? = null,
    val cancelCutoffHours: Int? = null
)

@Serializable
data class PublishEventRequest(
    val eventId: String
)

@Serializable
data class SignupForEventRequest(
    val eventId: String
)

@Serializable
data class CancelEventSignupRequest(
    val signupId: String
)

@Serializable
data class ClaimEventOfferRequest(
    val signupId: String
)

@Serializable
data class CheckInEventRequest(
    val signupId: String,
    val method: String
)

@Serializable
data class CreateEventCheckoutSessionRequest(
    val eventId: String,
    val signupId: String,
    val addOnIds: List<String>? = null
)

@Serializable
data class CreateBatchResponse(
    val ok: Boolean,
    val batchId: String? = null,
    val newBatchId: String? = null,
    val existingBatchId: String? = null
)

@Serializable
data class PickedUpAndCloseResponse(
    val ok: Boolean
)

@Serializable
data class ContinueJourneyResponse(
    val ok: Boolean,
    val batchId: String? = null,
    val newBatchId: String? = null,
    val existingBatchId: String? = null,
    val rootId: String? = null,
    val fromBatchId: String? = null,
    val message: String? = null
)

@Serializable
data class CreateReservationResponse(
    val ok: Boolean,
    val reservationId: String? = null,
    val status: String? = null
)

@Serializable
data class UpdateReservationResponse(
    val ok: Boolean,
    val reservationId: String? = null,
    val status: String? = null
)

@Serializable
data class AssignReservationStationResponse(
    val ok: Boolean,
    val reservationId: String? = null,
    val assignedStationId: String? = null,
    val previousAssignedStationId: String? = null,
    val stationCapacity: Int? = null,
    val stationUsedAfter: Int? = null,
    val idempotentReplay: Boolean? = null
)

typealias EventStatus = String
typealias EventSignupStatus = String
typealias EventPaymentStatus = String

@Serializable
data class MaterialProduct(
    val id: String,
    val name: String,
    val description: String? = null,
    val category: String? = null,
    val sku: String? = null,
    val priceCents: Int,
    val currency: String,
    val stripePriceId: String? = null,
    val imageUrl: String? = null,
    val trackInventory: Boolean,
    val inventoryOnHand: Int? = null,
    val inventoryReserved: Int? = null,
    val inventoryAvailable: Int? = null,
    val active: Boolean
)

@Serializable
data class ListMaterialsProductsResponse(
    val ok: Boolean,
    val products: List<MaterialProduct>
)

@Serializable
data class CreateMaterialsCheckoutSessionResponse(
    val ok: Boolean,
    val orderId: String,
    val checkoutUrl: String? = null
)

@Serializable
data class SeedMaterialsCatalogResponse(
    val ok: Boolean,
    val created: Int,
    val updated: Int,
    val total: Int
)

@Serializable
data class EventAddOn(
    val id: String,
    val title: String,
    val priceCents: Int,
    val isActive: Boolean
)

@Serializable
data class EventSummary(
    val id: String,
    val title: String,
    val summary: String,
    val startAt: String? = null,
    val endAt: String? = null,
    val timezone: String? = null,
    val location: String? = null,
    val priceCents: Int,
    val currency: String,
    val includesFiring: Boolean,
    val firingDetails: String? = null,
    val capacity: Int,
    val waitlistEnabled: Boolean,
    val status: String,
    val remainingCapacity: Int? = null
)

@Serializable
data class EventDetail(
    val id: String,
    val title: String,
    val summary: String,
    val description: String,
    val startAt: String? = null,
    val endAt: String? = null,
    val timezone: String? = null,
    val location: String? = null,
    val priceCents: Int,
    val currency: String,
    val includesFiring: Boolean,
    val firingDetails: String? = null,
    val policyCopy: String? = null,
    val addOns: List<EventAddOn>? = null,
    val capacity: Int,
    val waitlistEnabled: Boolean,
    val offerClaimWindowHours: Int? = null,
    val cancelCutoffHours: Int? = null,
    val status: String
)

@Serializable
data class EventSignupSummary(
    val id: String,
    val status: String,
    val paymentStatus: String? = null
)

@Serializable
data class EventSignupRosterEntry(
    val id: String,
    val uid: String? = null,
    val displayName: String? = null,
    val email: String? = null,
    val status: String,
    val paymentStatus: String? = null,
    val createdAt: String? = null,
    val offerExpiresAt: String? = null,
    val checkedInAt: String? = null,
    val checkInMethod: String? = null
)

@Serializable
data class ListEventsResponse(
    val ok: Boolean,
    val events: List<EventSummary>
)

@Serializable
data class ListEventSignupsResponse(
    val ok: Boolean,
    val signups: List<EventSignupRosterEntry>
)

@Serializable
data class GetEventResponse(
    val ok: Boolean,
    val event: EventDetail,
    val signup: EventSignupSummary? = null
)

@Serializable
data class CreateEventResponse(
    val ok: Boolean,
    val eventId: String
)

@Serializable
data class PublishEventResponse(
    val ok: Boolean,
    val status: String
)

@Serializable
data class SignupForEventResponse(
    val ok: Boolean,
    val signupId: String,
    val status: String
)

@Serializable
data class CancelEventSignupResponse(
    val ok: Boolean,
    val status: String
)

@Serializable
data class ClaimEventOfferResponse(
    val ok: Boolean,
    val status: String
)

@Serializable
data class CheckInEventResponse(
    val ok: Boolean,
    val status: String,
    val paymentStatus: String? = null
)

@Serializable
data class CreateEventCheckoutSessionResponse(
    val ok: Boolean,
    val checkoutUrl: String? = null
)

@Serializable
data class ImportLibraryIsbnError(
    val isbn: String,
    val message: String
)

@Serializable
data class ImportLibraryIsbnsResponse(
    val ok: Boolean,
    val requested: Int,
    val created: Int,
    val updated: Int,
    val errors: List<ImportLibraryIsbnError>? = null
)

@Serializable
data class RegisterDeviceTokenResponse(
    val ok: Boolean,
    val uid: String,
    val tokenHash: String
)

@Serializable
data class UnregisterDeviceTokenResponse(
    val ok: Boolean,
    val uid: String,
    val tokenHash: String
)

@Serializable
data class RunNotificationFailureDrillResponse(
    val ok: Boolean,
    val jobId: String,
    val uid: String,
    val mode: String
)

@Serializable
data class RunNotificationMetricsAggregationNowResponse(
    val ok: Boolean,
    val windowHours: Int,
    val totalAttempts: Int,
    val statusCounts: Map<String, Int>,
    val reasonCounts: Map<String, Int>,
    val providerCounts: Map<String, Int>
)

@Serializable
data class MaterialOrderItemSummary(
    val productId: String,
    val name: String,
    val quantity: Int,
    val unitPrice: Int,
    val currency: String
)

@Serializable
data class MaterialOrderSummary(
    val id: String,
    val status: String,
    val totalCents: Int,
    val currency: String,
    val pickupNotes: String? = null,
    val checkoutUrl: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val items: List<MaterialOrderItemSummary> = emptyList()
)

@Serializable
data class BillingReceipt(
    val id: String,
    val type: String,
    val sourceId: String? = null,
    val title: String,
    val amountCents: Int,
    val currency: String,
    val paidAt: String? = null,
    val createdAt: String? = null,
    val metadata: JsonElement? = null
)

@Serializable
data class BillingSummaryTotals(
    val unpaidCheckInsCount: Int,
    val unpaidCheckInsAmountCents: Int,
    val materialsPendingCount: Int,
    val materialsPendingAmountCents: Int,
    val receiptsCount: Int,
    val receiptsAmountCents: Int
)

@Serializable
data class BillingSummaryResponse(
    val ok: Boolean,
    val unpaidCheckIns: List<EventSignupRosterEntry> = emptyList(),
    val materialsOrders: List<MaterialOrderSummary> = emptyList(),
    val receipts: List<BillingReceipt> = emptyList(),
    val summary: BillingSummaryTotals
)

fun getResultBatchId(resp: CreateBatchResponse?): String? {
    if (resp == null) return null
    return resp.newBatchId ?: resp.batchId ?: resp.existingBatchId
}

@Serializable
enum class TimelineEventType {
    @SerialName("CREATE_BATCH")
    CREATE_BATCH,
    @SerialName("SUBMIT_DRAFT")
    SUBMIT_DRAFT,
    @SerialName("SHELVED")
    SHELVED,
    @SerialName("KILN_LOAD")
    KILN_LOAD,
    @SerialName("KILN_UNLOAD")
    KILN_UNLOAD,
    @SerialName("ASSIGNED_FIRING")
    ASSIGNED_FIRING,
    @SerialName("READY_FOR_PICKUP")
    READY_FOR_PICKUP,
    @SerialName("PICKED_UP_AND_CLOSE")
    PICKED_UP_AND_CLOSE,
    @SerialName("CONTINUE_JOURNEY")
    CONTINUE_JOURNEY,
}

val TIMELINE_EVENT_LABELS: Map<TimelineEventType, String> = mapOf(
    TimelineEventType.CREATE_BATCH to "Batch created",
    TimelineEventType.SUBMIT_DRAFT to "Draft submitted",
    TimelineEventType.SHELVED to "Shelved",
    TimelineEventType.KILN_LOAD to "Loaded into kiln",
    TimelineEventType.KILN_UNLOAD to "Unloaded from kiln",
    TimelineEventType.ASSIGNED_FIRING to "Firing assigned",
    TimelineEventType.READY_FOR_PICKUP to "Ready for pickup",
    TimelineEventType.PICKED_UP_AND_CLOSE to "Picked up & closed",
    TimelineEventType.CONTINUE_JOURNEY to "Journey continued",
)

fun normalizeTimelineEventType(raw: String?): TimelineEventType? {
    if (raw == null) return null
    return when (raw) {
        "CREATE_BATCH" -> TimelineEventType.CREATE_BATCH
        "SUBMIT_DRAFT" -> TimelineEventType.SUBMIT_DRAFT
        "SHELVED" -> TimelineEventType.SHELVED
        "KILN_LOAD" -> TimelineEventType.KILN_LOAD
        "KILN_UNLOAD" -> TimelineEventType.KILN_UNLOAD
        "ASSIGNED_FIRING" -> TimelineEventType.ASSIGNED_FIRING
        "READY_FOR_PICKUP" -> TimelineEventType.READY_FOR_PICKUP
        "PICKED_UP_AND_CLOSE" -> TimelineEventType.PICKED_UP_AND_CLOSE
        "CONTINUE_JOURNEY" -> TimelineEventType.CONTINUE_JOURNEY
        "BATCH_CREATED" -> TimelineEventType.CREATE_BATCH
        "SUBMITTED" -> TimelineEventType.SUBMIT_DRAFT
        "PICKED_UP_AND_CLOSED" -> TimelineEventType.PICKED_UP_AND_CLOSE
        else -> null
    }
}
