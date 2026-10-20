import 'package:supabase_flutter/supabase_flutter.dart';
import 'env.dart';
import 'skew_retry_client.dart';

Future<void> initSupabase() async {
  await Supabase.initialize(
    url: Env.supabaseUrl,
    publishableKey: Env.supabasePublishableKey,
    // Sends a request once more when the API refuses a good token for a
    // moment's clock difference (PGRST303); see SkewRetryClient.
    httpClient: SkewRetryClient(),
  );
}

SupabaseClient get supabase => Supabase.instance.client;
