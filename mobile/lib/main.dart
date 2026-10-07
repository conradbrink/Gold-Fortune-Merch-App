import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/company_config.dart';
import 'core/monitoring.dart';
import 'core/supabase_client.dart';

Future<void> main() async {
  // MUST come first. Monitoring reads the package version over a platform
  // channel, and platform channels do not exist until the binding is up —
  // doing this inside the runner below crashed the app before it drew a frame.
  WidgetsFlutterBinding.ensureInitialized();

  // Monitoring wraps everything, so a crash during Supabase startup is
  // reported rather than being a silent white screen. When no DSN is compiled
  // in, or if Sentry itself fails to start, this runs the app unchanged.
  await Monitoring.init(() async {
    await initSupabase();
    final container = ProviderContainer();
    // The last company's words and colours, from the local cache, before the
    // first frame. Without this a signed-in rep sees the product's neutral
    // colours until their profile has come back over the network — a flash of
    // somebody else's app on every launch. Bounded and best-effort: a slow or
    // broken database only costs that flash.
    try {
      await container
          .read(lastCompanyProvider.future)
          .timeout(const Duration(seconds: 2));
    } catch (_) {}
    runApp(UncontrolledProviderScope(
      container: container,
      child: const GfMerchApp(),
    ));
  });
}
