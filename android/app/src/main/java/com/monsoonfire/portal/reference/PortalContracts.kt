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
    val notes: String? = null
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
