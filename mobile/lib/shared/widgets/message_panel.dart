import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A centred icon, title and line of text: an empty list, or why there is
/// nothing to show.
///
/// [scrollable] puts it in a list with room above, for a screen under a
/// pull-to-refresh: the pull needs something to scroll, and the message is
/// what is there when the data is not.
class MessagePanel extends StatelessWidget {
  const MessagePanel({
    super.key,
    required this.icon,
    required this.title,
    required this.body,
    this.scrollable = false,
  });

  final IconData icon;
  final String title;
  final String body;
  final bool scrollable;

  @override
  Widget build(BuildContext context) {
    final panel = Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
            ),
            const SizedBox(height: 6),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
    if (!scrollable) return panel;
    return ListView(children: [const SizedBox(height: 80), panel]);
  }
}

/// A bold heading over a group of cards.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          color: AppColors.textPrimary,
        ),
      ),
    );
  }
}
