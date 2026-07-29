import 'package:supabase_flutter/supabase_flutter.dart';
import 'env.dart';

Future<void> initSupabase() async {
  await Supabase.initialize(
    url: Env.supabaseUrl,
    publishableKey: Env.supabasePublishableKey,
  );
}

SupabaseClient get supabase => Supabase.instance.client;
