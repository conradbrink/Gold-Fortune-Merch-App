import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Permission to show notifications, which Android 13 and later withhold
/// until the person allows it.
///
/// It matters for one notification: "Workday in progress", the location
/// foreground service's own. Without the permission the trail still records,
/// but the rep is never shown that it does, and Google Play expects a location
/// service to be visible. Asked as the rep starts a workday, because that tap
/// is what the notification is about (MainActivity.kt answers it).
class NotificationPermission {
  static const _channel = MethodChannel('za.co.tickd/notifications');

  /// Asks, if Android still needs asking, and says whether notifications may
  /// show. Android shows the dialog at most twice, so asking at every start
  /// costs nothing once the rep has answered.
  ///
  /// Never throws and never blocks the day: an iPhone, an older Android or a
  /// failed call all carry on as if nothing was asked.
  static Future<bool> request() async {
    if (defaultTargetPlatform != TargetPlatform.android) return true;
    try {
      return await _channel.invokeMethod<bool>('request') ?? false;
    } catch (_) {
      return false;
    }
  }
}
