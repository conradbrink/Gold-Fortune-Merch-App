import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../data/models/route_visit.dart';
import 'order_capture_screen.dart';

/// Resolves `/visit/:key/order` into the screen the rep actually types into.
///
/// [OrderCaptureScreen] needs the store and the visit's client id, and this
/// finds them in the day the app already has cached rather than accepting them
/// as route `extra`. `extra` is not restored when the router rebuilds, which
/// is the whole failure this route exists to fix — a screen that only works on
/// the way in is the one that vanished.
class OrderCaptureRoute extends ConsumerWidget {
  const OrderCaptureRoute({super.key, required this.visitKey});

  final String visitKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routes = ref.watch(todayRoutesProvider);

    return routes.when(
      loading: () => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      ),
      // Offline with nothing cached. Sending the rep back to the shop is the
      // honest answer: the draft is safe on the phone and the store screen can
      // say so, which is more use than an error on a screen with no content.
      error: (_, _) => _BackToVisit(visitKey: visitKey),
      data: (visits) {
        RouteVisit? visit;
        for (final candidate in visits) {
          if (candidate.cacheKey == visitKey) {
            visit = candidate;
            break;
          }
        }

        // Taking an order is offered while the rep is on site, so a visit that
        // is gone, finished, or not yet started has no order screen to show.
        if (visit == null ||
            !visit.isCheckedIn ||
            visit.visitClientGeneratedId == null) {
          return _BackToVisit(visitKey: visitKey);
        }

        return OrderCaptureScreen(
          visitClientId: visit.visitClientGeneratedId!,
          storeId: visit.storeId,
          storeName: visit.storeName,
          visitKey: visitKey,
        );
      },
    );
  }
}

/// Leaves during the frame rather than in `build`, which cannot navigate.
class _BackToVisit extends StatefulWidget {
  const _BackToVisit({required this.visitKey});

  final String visitKey;

  @override
  State<_BackToVisit> createState() => _BackToVisitState();
}

class _BackToVisitState extends State<_BackToVisit> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.go('/visit/${widget.visitKey}');
    });
  }

  @override
  Widget build(BuildContext context) => const Scaffold(body: SizedBox.shrink());
}
