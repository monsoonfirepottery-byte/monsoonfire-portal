package com.monsoonfire.portal.reference

import android.app.Activity
import android.os.Bundle
import android.util.Log

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleDeepLink()
    }

    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink()
    }

    private fun handleDeepLink() {
        val data = intent?.data ?: return
        val route = DeepLinkRouter.parse(data)
        Log.i("DeepLinkRouter", "target=${route.target} status=${route.status} url=${route.rawUrl}")
    }
}
