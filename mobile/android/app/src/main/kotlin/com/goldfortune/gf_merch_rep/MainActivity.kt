package com.goldfortune.gf_merch_rep

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Answers one question from Dart: may the app show notifications?
 *
 * Android 13 and later hide an app's notifications until the person allows
 * them, and that includes the "Workday in progress" notification of the
 * location foreground service. No plugin in the app asks for it, so this does,
 * through `za.co.tickd/notifications` (lib/core/notification_permission.dart).
 */
class MainActivity : FlutterActivity() {
    /** The Dart call waiting for the person's answer, if a dialog is up. */
    private var pending: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                if (call.method != "request") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
                ) {
                    result.success(true)
                    return@setMethodCallHandler
                }
                // One dialog at a time: a second tap while it is up is answered
                // "not yet" rather than left hanging.
                if (pending != null) {
                    result.success(false)
                    return@setMethodCallHandler
                }
                pending = result
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE)
            }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        // Plugins (geolocator) get their own answers through the super call.
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_CODE) return
        val granted = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        pending?.success(granted)
        pending = null
    }

    override fun onDestroy() {
        // A dialog the activity did not live to hear the answer to: let the
        // waiting Dart call carry on rather than hold the workday start.
        pending?.success(false)
        pending = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "za.co.tickd/notifications"
        private const val REQUEST_CODE = 4711
    }
}
