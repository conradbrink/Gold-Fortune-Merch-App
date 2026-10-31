import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens the first of [links] that the phone can open, outside the app.
///
/// More than one when there is a better and a fallback way in: a store app's
/// own link first, its web page after. When none opens (no browser, no store
/// app), the last link is shown so the person can type it.
Future<void> openFirstLink(BuildContext context, List<Uri> links) async {
  for (final uri in links) {
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } catch (_) {
      // No app handles this scheme; the next link is the web one.
    }
  }
  if (context.mounted && links.isNotEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Could not open the browser. Go to ${links.last}')),
    );
  }
}
