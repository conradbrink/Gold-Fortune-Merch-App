import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/monitoring.dart';
import 'core/supabase_client.dart';

Future<void> main() async {
  // Monitoring wraps everything, so a crash during Supabase startup is
  // reported rather than being the silent white screen it is today. When no
  // DSN is compiled in, this runs the app unchanged.
  await Monitoring.init(() async {
    WidgetsFlutterBinding.ensureInitialized();
    await initSupabase();
    runApp(const ProviderScope(child: GfMerchApp()));
  });
}
