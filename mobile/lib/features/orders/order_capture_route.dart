import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../data/local/order_draft.dart';
import '../../data/models/route_visit.dart';
import '../../data/models/store_summary.dart';
import 'order_capture_screen.dart';

/// Resolves a screen under a checked-in visit (`/visit/:key/order`, and
/// `/visit/:key/damage` through [builder]) into the screen the rep actually
/// types into. Whatever this class requires of the visit (checked in, with a
/// client id) applies to every screen it hosts.
///
/// [OrderCaptureScreen] needs the store and the visit's client id, and this
/// finds them in the day the app already has cached rather than accepting them
/// as route `extra`. `extra` is not restored when the router rebuilds, which
/// is the whole failure this route exists to fix — a screen that only works on
/// the way in is the one that vanished.
class OrderCaptureRoute extends ConsumerStatefulWidget {
  const OrderCaptureRoute({super.key, required this.visitKey, this.builder});

  final String visitKey;

  /// The screen for the resolved visit; the order screen when not given. The
  /// damaged-stock screen rides on the same resolution, for the same reasons.
  final Widget Function(RouteVisit visit, String visitKey)? builder;

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
          : _LeaveTo('/visit/${widget.visitKey}'),
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
        if (visit == null) return _LeaveTo('/visit/${widget.visitKey}');
        return _screenFor(visit);
      },
    );
  }

  Widget _screenFor(RouteVisit visit) => widget.builder?.call(visit, widget.visitKey) ?? OrderCaptureScreen(
        visitClientId: visit.visitClientGeneratedId!,
        storeId: visit.storeId,
        storeName: visit.storeName,
        visitKey: widget.visitKey,
        storeAddress: deliveryAddressOf(visit.storeAddress, visit.storeCity),
      );
}

/// `/unscheduled/order/:storeId`: a new order the customer sent, for the
/// customer the rep picked. No visit and no check-in, and no open workday
/// either: a shop that messages at eight at night gets its order in then
/// (owner, 29 Oct 2026).
///
/// The customer is found in the phone's own list by id rather than handed
/// over as route `extra`, for the reason [OrderCaptureRoute] gives, and kept
/// once found: a refetch that comes back thin must not take the screen away
/// from a rep who is typing into it.
class NewOrderRoute extends ConsumerStatefulWidget {
  const NewOrderRoute({super.key, required this.storeId});

  final String storeId;

  @override
  ConsumerState<NewOrderRoute> createState() => _NewOrderRouteState();
}

class _NewOrderRouteState extends ConsumerState<NewOrderRoute> {
  StoreSummary? _store;

  @override
  Widget build(BuildContext context) {
    final stores = ref.watch(storesProvider);
    // The draft is the signed-in person's. Nobody signed in means the router
    // is already on its way to the sign-in screen.
    final repId = ref.watch(currentUserProvider)?.id;
    _store ??= stores.value?.where((s) => s.id == widget.storeId).firstOrNull;

    final store = _store;
    if (store != null && repId != null) {
      final draftId = OrderDraft.newOrderId(repId, store.id);
      return OrderCaptureScreen.newOrder(
        // A different person signing in on the same phone is a different
        // draft, and must not inherit the last one's half-typed lines.
        key: ValueKey(draftId),
        draftId: draftId,
        storeId: store.id,
        storeName: store.name,
        storeAddress: deliveryAddressOf(store.address, store.city),
      );
    }
    if (stores.isLoading || repId == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    // Not on this phone's list (removed in the office, or a stale link): back
    // to choosing one.
    return const _LeaveTo('/unscheduled/order');
  }
}

/// "12 Main Road, Mahikeng": the street and the town, without repeating a
/// town the address already names. Null when neither is on record.
String? deliveryAddressOf(String? address, String? city) {
  final street = address?.trim() ?? '';
  final town = city?.trim() ?? '';
  if (street.isEmpty) return town.isEmpty ? null : town;
  if (town.isEmpty || street.toLowerCase().contains(town.toLowerCase())) return street;
  return '$street, $town';
}

/// Goes to [path] during the frame rather than in `build`, which cannot
/// navigate.
class _LeaveTo extends StatefulWidget {
  const _LeaveTo(this.path);

  final String path;

  @override
  State<_LeaveTo> createState() => _LeaveToState();
}

class _LeaveToState extends State<_LeaveTo> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.go(widget.path);
    });
  }

  @override
  Widget build(BuildContext context) => const Scaffold(body: SizedBox.shrink());
}
