package com.monsoonfire.portal.reference

import kotlinx.serialization.Serializable

// Domain-only models (non-API contract)

@Serializable
data class TimelineEvent(
    val id: String,
    val type: String? = null,
    val at: String? = null,
    val actorName: String? = null,
    val kilnName: String? = null,
    val notes: String? = null
)
