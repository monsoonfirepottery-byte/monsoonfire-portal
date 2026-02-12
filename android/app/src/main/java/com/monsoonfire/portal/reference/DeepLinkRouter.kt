package com.monsoonfire.portal.reference

import android.net.Uri

enum class DeepLinkTarget {
    EVENTS,
    MATERIALS,
    KILN,
    PIECES,
    UNKNOWN
}

enum class DeepLinkStatus {
    SUCCESS,
    CANCEL,
    UNKNOWN
}

data class DeepLinkRoute(
    val target: DeepLinkTarget,
    val status: DeepLinkStatus,
    val rawUrl: String
)

object DeepLinkRouter {
    fun parse(uri: Uri): DeepLinkRoute {
        val statusValue = uri.getQueryParameter("status")?.lowercase().orEmpty()
        val status = when (statusValue) {
            "success" -> DeepLinkStatus.SUCCESS
            "cancel", "canceled" -> DeepLinkStatus.CANCEL
            else -> DeepLinkStatus.UNKNOWN
        }

        val path = uri.path?.lowercase().orEmpty()
        val target = when {
            path.contains("/events") -> DeepLinkTarget.EVENTS
            path.contains("/materials") || path.contains("/store") -> DeepLinkTarget.MATERIALS
            path.contains("/kiln") -> DeepLinkTarget.KILN
            path.contains("/pieces") -> DeepLinkTarget.PIECES
            else -> DeepLinkTarget.UNKNOWN
        }

        return DeepLinkRoute(
            target = target,
            status = status,
            rawUrl = uri.toString()
        )
    }
}
