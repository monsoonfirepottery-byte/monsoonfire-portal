package com.monsoonfire.portal.reference

import java.io.IOException
import java.util.UUID
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

class PortalApiException(message: String, val meta: PortalApiMeta) : Exception(message)

class PortalApiClient(
    private val config: Config,
    private val client: OkHttpClient = OkHttpClient(),
    private val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }
) {
    data class Config(val baseUrl: String)

    data class CallResult<T>(val data: T, val meta: PortalApiMeta)

    var lastMeta: PortalApiMeta? = null
        private set

    private fun nowIso(): String = java.time.Instant.now().toString()

    private fun requestId(): String = UUID.randomUUID().toString().lowercase()

    private fun escapeSingleQuotes(value: String): String = value.replace("'", "'\\''")

    private fun buildCurl(url: String, hasAdmin: Boolean, payloadJson: String): String {
        val headers = mutableListOf(
            "-H 'Content-Type: application/json'",
            "-H 'Authorization: Bearer <ID_TOKEN>'"
        )
        if (hasAdmin) headers.add("-H 'x-admin-token: <ADMIN_TOKEN>'")
        return "curl -X POST ${headers.joinToString(" ")} -d '${escapeSingleQuotes(payloadJson)}' '$url'"
    }

    private fun parseJsonElement(body: String): JsonElement? {
        if (body.isBlank()) return null
        return try {
            json.parseToJsonElement(body)
        } catch (_: Exception) {
            JsonPrimitive(body)
        }
    }

    @Throws(PortalApiException::class)
    fun <TReq, TResp> post(
        fn: String,
        idToken: String,
        adminToken: String?,
        payload: TReq,
        reqSerializer: KSerializer<TReq>,
        respSerializer: KSerializer<TResp>
    ): CallResult<TResp> {
        val base = config.baseUrl.trim().trimEnd('/')
        val url = "$base/$fn"

        val payloadJson = try {
            json.encodeToString(reqSerializer, payload)
        } catch (e: Exception) {
            val meta = PortalApiMeta(
                atIso = nowIso(),
                requestId = requestId(),
                fn = fn,
                url = url,
                payload = JsonPrimitive("<encode failed>"),
                curlExample = null,
                status = null,
                ok = false,
                response = null,
                error = "Encoding failed",
                message = e.message ?: "Encoding failed",
                code = null
            )
            lastMeta = meta
            throw PortalApiException(meta.message ?: "Encoding failed", meta)
        }

        val metaStart = PortalApiMeta(
            atIso = nowIso(),
            requestId = requestId(),
            fn = fn,
            url = url,
            payload = parseJsonElement(payloadJson) ?: JsonPrimitive(payloadJson),
            curlExample = buildCurl(url, !adminToken.isNullOrBlank(), payloadJson),
            status = null,
            ok = null,
            response = null,
            error = null,
            message = null,
            code = null
        )

        val requestBody = payloadJson.toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(url)
            .post(requestBody)
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $idToken")
            .apply {
                if (!adminToken.isNullOrBlank()) {
                    header("x-admin-token", adminToken)
                }
            }
            .build()

        try {
            client.newCall(request).execute().use { response ->
                return handleResponse(response, metaStart, respSerializer)
            }
        } catch (e: IOException) {
            val meta = metaStart.copy(
                ok = false,
                error = "Failed to fetch",
                message = e.message ?: "Failed to fetch"
            )
            lastMeta = meta
            throw PortalApiException(meta.message ?: "Failed to fetch", meta)
        }
    }

    private fun <TResp> handleResponse(
        response: Response,
        metaStart: PortalApiMeta,
        respSerializer: KSerializer<TResp>
    ): CallResult<TResp> {
        val bodyString = response.body?.string().orEmpty()
        val bodyJson = parseJsonElement(bodyString)

        val metaDone = metaStart.copy(
            status = response.code,
            ok = response.isSuccessful,
            response = bodyJson
        )

        if (!response.isSuccessful) {
            val env = try {
                json.decodeFromString(PortalApiErrorEnvelope.serializer(), bodyString)
            } catch (_: Exception) {
                null
            }
            val msg = env?.message ?: env?.error ?: "Request failed"
            val metaFail = metaDone.copy(
                error = msg,
                message = msg,
                code = env?.code
            )
            lastMeta = metaFail
            throw PortalApiException(msg, metaFail)
        }

        val decoded = try {
            json.decodeFromString(respSerializer, bodyString)
        } catch (e: Exception) {
            val metaFail = metaDone.copy(
                ok = false,
                error = "Decoding failed",
                message = e.message ?: "Decoding failed"
            )
            lastMeta = metaFail
            throw PortalApiException(metaFail.message ?: "Decoding failed", metaFail)
        }

        lastMeta = metaDone
        return CallResult(decoded, metaDone)
    }

    fun createBatch(
        idToken: String,
        adminToken: String?,
        payload: CreateBatchRequest
    ): CallResult<CreateBatchResponse> {
        return post(
            fn = "createBatch",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = CreateBatchRequest.serializer(),
            respSerializer = CreateBatchResponse.serializer()
        )
    }

    fun pickedUpAndClose(
        idToken: String,
        adminToken: String?,
        payload: PickedUpAndCloseRequest
    ): CallResult<PickedUpAndCloseResponse> {
        return post(
            fn = "pickedUpAndClose",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = PickedUpAndCloseRequest.serializer(),
            respSerializer = PickedUpAndCloseResponse.serializer()
        )
    }

    fun continueJourney(
        idToken: String,
        adminToken: String?,
        payload: ContinueJourneyRequest
    ): CallResult<ContinueJourneyResponse> {
        return post(
            fn = "continueJourney",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = ContinueJourneyRequest.serializer(),
            respSerializer = ContinueJourneyResponse.serializer()
        )
    }

    fun listMaterialsProducts(
        idToken: String,
        adminToken: String?,
        payload: ListMaterialsProductsRequest
    ): CallResult<ListMaterialsProductsResponse> {
        return post(
            fn = "listMaterialsProducts",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = ListMaterialsProductsRequest.serializer(),
            respSerializer = ListMaterialsProductsResponse.serializer()
        )
    }

    fun createMaterialsCheckoutSession(
        idToken: String,
        adminToken: String?,
        payload: CreateMaterialsCheckoutSessionRequest
    ): CallResult<CreateMaterialsCheckoutSessionResponse> {
        return post(
            fn = "createMaterialsCheckoutSession",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = CreateMaterialsCheckoutSessionRequest.serializer(),
            respSerializer = CreateMaterialsCheckoutSessionResponse.serializer()
        )
    }

    fun seedMaterialsCatalog(
        idToken: String,
        adminToken: String?,
        payload: SeedMaterialsCatalogRequest
    ): CallResult<SeedMaterialsCatalogResponse> {
        return post(
            fn = "seedMaterialsCatalog",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = SeedMaterialsCatalogRequest.serializer(),
            respSerializer = SeedMaterialsCatalogResponse.serializer()
        )
    }

    fun createReservation(
        idToken: String,
        adminToken: String?,
        payload: CreateReservationRequest
    ): CallResult<CreateReservationResponse> {
        return post(
            fn = "createReservation",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = CreateReservationRequest.serializer(),
            respSerializer = CreateReservationResponse.serializer()
        )
    }

    fun listEvents(
        idToken: String,
        adminToken: String?,
        payload: ListEventsRequest
    ): CallResult<ListEventsResponse> {
        return post(
            fn = "listEvents",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = ListEventsRequest.serializer(),
            respSerializer = ListEventsResponse.serializer()
        )
    }

    fun listEventSignups(
        idToken: String,
        adminToken: String?,
        payload: ListEventSignupsRequest
    ): CallResult<ListEventSignupsResponse> {
        return post(
            fn = "listEventSignups",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = ListEventSignupsRequest.serializer(),
            respSerializer = ListEventSignupsResponse.serializer()
        )
    }

    fun listBillingSummary(
        idToken: String,
        adminToken: String?,
        payload: ListBillingSummaryRequest
    ): CallResult<BillingSummaryResponse> {
        return post(
            fn = "listBillingSummary",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = ListBillingSummaryRequest.serializer(),
            respSerializer = BillingSummaryResponse.serializer()
        )
    }

    fun getEvent(
        idToken: String,
        adminToken: String?,
        payload: GetEventRequest
    ): CallResult<GetEventResponse> {
        return post(
            fn = "getEvent",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = GetEventRequest.serializer(),
            respSerializer = GetEventResponse.serializer()
        )
    }

    fun createEvent(
        idToken: String,
        adminToken: String?,
        payload: CreateEventRequest
    ): CallResult<CreateEventResponse> {
        return post(
            fn = "createEvent",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = CreateEventRequest.serializer(),
            respSerializer = CreateEventResponse.serializer()
        )
    }

    fun publishEvent(
        idToken: String,
        adminToken: String?,
        payload: PublishEventRequest
    ): CallResult<PublishEventResponse> {
        return post(
            fn = "publishEvent",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = PublishEventRequest.serializer(),
            respSerializer = PublishEventResponse.serializer()
        )
    }

    fun signupForEvent(
        idToken: String,
        adminToken: String?,
        payload: SignupForEventRequest
    ): CallResult<SignupForEventResponse> {
        return post(
            fn = "signupForEvent",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = SignupForEventRequest.serializer(),
            respSerializer = SignupForEventResponse.serializer()
        )
    }

    fun cancelEventSignup(
        idToken: String,
        adminToken: String?,
        payload: CancelEventSignupRequest
    ): CallResult<CancelEventSignupResponse> {
        return post(
            fn = "cancelEventSignup",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = CancelEventSignupRequest.serializer(),
            respSerializer = CancelEventSignupResponse.serializer()
        )
    }

    fun claimEventOffer(
        idToken: String,
        adminToken: String?,
        payload: ClaimEventOfferRequest
    ): CallResult<ClaimEventOfferResponse> {
        return post(
            fn = "claimEventOffer",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = ClaimEventOfferRequest.serializer(),
            respSerializer = ClaimEventOfferResponse.serializer()
        )
    }

    fun checkInEvent(
        idToken: String,
        adminToken: String?,
        payload: CheckInEventRequest
    ): CallResult<CheckInEventResponse> {
        return post(
            fn = "checkInEvent",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = CheckInEventRequest.serializer(),
            respSerializer = CheckInEventResponse.serializer()
        )
    }

    fun createEventCheckoutSession(
        idToken: String,
        adminToken: String?,
        payload: CreateEventCheckoutSessionRequest
    ): CallResult<CreateEventCheckoutSessionResponse> {
        return post(
            fn = "createEventCheckoutSession",
            idToken = idToken,
            adminToken = adminToken,
            payload = payload,
            reqSerializer = CreateEventCheckoutSessionRequest.serializer(),
            respSerializer = CreateEventCheckoutSessionResponse.serializer()
        )
    }
}
