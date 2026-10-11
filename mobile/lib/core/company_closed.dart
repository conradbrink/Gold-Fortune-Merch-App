import 'dart:async';

import '../data/local/app_database.dart';
import 'supabase_client.dart';

/// Whether the signed-in person's company has been closed from the Control
/// Centre (20261011090000_close_company). While it is, the database no longer
/// recognises them, so every screen would be empty; the router sends them to
/// the closed-company screen instead.
///
/// Like the role, this never makes navigation wait on the network: the
/// cached answer is used and refreshed in the background, and only a person
/// never seen before is asked live. Any failure counts as open, because the
/// database refuses a closed company's data whatever the app shows.

String _closedKey(String userId) => 'company_closed:$userId';

/// The answer for [userId]: cached if there is one (refreshed in the
/// background), otherwise asked now.
Future<bool> companyClosed(AppDatabase db, String userId) async {
  final cached = await db.getValue(_closedKey(userId));
  if (cached != null) {
    unawaited(refreshCompanyClosed(db, userId));
    return cached == 'true';
  }
  return refreshCompanyClosed(db, userId);
}

/// Asks the database and caches the answer. Offline or failing: whatever was
/// cached stays, and the answer is that cached value (open if none).
Future<bool> refreshCompanyClosed(AppDatabase db, String userId) async {
  try {
    final closed = await supabase.rpc('my_company_closed') != null;
    await db.setValue(_closedKey(userId), closed ? 'true' : 'false');
    return closed;
  } catch (_) {
    return (await db.getValue(_closedKey(userId))) == 'true';
  }
}
