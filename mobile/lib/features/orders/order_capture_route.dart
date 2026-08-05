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
class OrderCaptureRoute extends ConsumerStatefulWidget {
  const OrderCaptureRoute({super.key, required this.visitKey});

  final String visitKey;

  @override
  ConsumerState<OrderCaptureRoute> createState() => _OrderCaptureRouteState();
}

class _OrderCaptureRouteState extends ConsumerState<OrderCaptureRoute> {
  /// The visit this screen opened on, kept for as long as the screen is up.
  ///
  /// `todayRoutesProvider` is network-first and does not restore a cached stop
  /// the server left out of a response. Resolving from it on every build means
  /// a refetch that comes back thin — no signal, or a stale `not_started` from
  /// before the outbox drained — resolves to nothing and bounces the rep to the
  /// shop, losing the screen they were typing into. Which is the exact bug this
  /// route was added to fix, reintroduced through the back door.
  ///
  /// So the first good answer is the answer. It is the same reasoning as
  /// `_applied`/`furtherAlong` on the store screen: what the rep is doing now
  /// beats a day that has not caught up. The store and the visit's client id
  /// cannot change under a rep standing in a shop, so there is nothing to
  /// refresh here — only something to lose.
  RouteVisit? _visit;

  @override
  Widget build(BuildContext context) {
    final routes = ref.watch(todayRoutesProvider);

    return routes.when(
      loading: () => _visit != null
          ? _screenFor(_visit!)
          : const Scaffold(body: Center(child: CircularProgressIndicator())),
      // Offline with nothing cached. Sending the rep back to the shop is the
      // honest answer: the draft is safe on the phone and the store screen can
      // say so, which is more use than an error on a screen with no content.
      error: (_, _) => _visit != null
          ? _screenFor(_visit!)
          : _BackToVisit(visitKey: widget.visitKey),
      data: (visits) {
        RouteVisit? found;
        for (final candidate in visits) {
          if (candidate.cacheKey == widget.visitKey) {
            found = candidate;
            break;
          }
        }

        // Taking an order is offered while the rep is on site, so a visit that
        // is gone, finished, or not yet started has no order screen to open.
        // Only on the way in, though — see `_visit`.
        final usable = found != null &&
            found.isCheckedIn &&
            found.visitClientGeneratedId != null;
        if (usable) _visit = found;

        final visit = _visit;
        if (visit == null) return _BackToVisit(visitKey: widget.visitKey);
        return _screenFor(visit);
      },
    );
  }

  Widget _screenFor(RouteVisit visit) => OrderCaptureScreen(
        visitClientId: visit.visitClientGeneratedId!,
        storeId: visit.storeId,
        storeName: visit.storeName,
        visitKey: widget.visitKey,
      );
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
