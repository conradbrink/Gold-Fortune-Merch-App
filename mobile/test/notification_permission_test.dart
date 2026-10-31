import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/notification_permission.dart';

/// The "Workday in progress" notification needs this permission on Android 13
/// and later. Asking must never stop a workday from starting.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('za.co.tickd/notifications');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
    debugDefaultTargetPlatformOverride = null;
  });

  test('passes on the answer from Android', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final calls = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      return true;
    });

    expect(await NotificationPermission.request(), isTrue);
    expect(calls, ['request']);
  });

  test('a refusal comes back as false', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    messenger.setMockMethodCallHandler(channel, (_) async => false);

    expect(await NotificationPermission.request(), isFalse);
  });

  test('a build without the channel carries on instead of throwing', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;

    expect(await NotificationPermission.request(), isFalse);
  });

  test('an iPhone is not asked', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    var asked = false;
    messenger.setMockMethodCallHandler(channel, (_) async {
      asked = true;
      return false;
    });

    expect(await NotificationPermission.request(), isTrue);
    expect(asked, isFalse);
  });
}
