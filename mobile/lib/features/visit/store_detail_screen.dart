import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/form_template.dart';
import '../../data/models/promotion.dart';
import '../../data/models/route_visit.dart';
import '../../data/repositories/promotion_repository.dart';
import '../../data/repositories/route_repository.dart';
import '../../shared/widgets/status_badge.dart';
import '../forms/form_fill_screen.dart';
import '../workday/workday_controller.dart';

/// Below this, a check-out is treated as suspiciously quick and the rep is
/// asked to confirm. Real merchandising work at a store takes longer.
const kMinimumVisitDuration = Duration(minutes: 5);

class StoreDetailScreen extends ConsumerStatefulWidget {
  const StoreDetailScreen({super.key, required this.visitKey});

  /// Route id for a scheduled visit, or the visit's client id for an
  /// unscheduled one.
  final String visitKey;

  @override
  ConsumerState<StoreDetailScreen> createState() => _StoreDetailScreenState();
}

/// How far through a visit a status is. A visit only ever moves forward.
int visitProgress(String status) => switch (status) {
      'checked_out' => 2,
      'checked_in' => 1,
      _ => 0,
    };

/// Picks between what this screen just did and what the day reports.
///
/// Never goes backwards. The fetched day is authoritative once it has caught
/// up, but until it does, a check-in the rep has already made must not be
/// replaced by a stale "not started" — that is what puts a live Check in
/// button over an existing visit.
RouteVisit? furtherAlong(RouteVisit? applied, RouteVisit? fetched) {
  if (applied == null) return fetched;
  if (fetched == null) return applied;
  return visitProgress(applied.status) > visitProgress(fetched.status)
      ? applied
      : fetched;
}

class _StoreDetailScreenState extends ConsumerState<StoreDetailScreen> {
  bool _busy = false;
  bool _locating = false;

  /// What this screen just did, held locally.
  ///
  /// Checking in writes the visit to the outbox and the local cache, then asks
  /// the day to refetch. The refetch is not reliable enough to render from: on
  /// a slow or loaded device it can come back before the write is visible, and
  /// the screen then sits on "NOT STARTED" with a live Check in button over a
  /// visit that already exists — observed lasting nineteen minutes, and a
  /// second tap there mints a duplicate visit. The rep's own action is the one
  /// thing this screen can be certain of, so it is remembered here and wins
  /// until the fetched day catches up.
  RouteVisit? _applied;

  RouteVisit? _find(List<RouteVisit> routes) {
    RouteVisit? fetched;
    for (final r in routes) {
      if (r.cacheKey == widget.visitKey) {
        fetched = r;
        break;
      }
    }

    return furtherAlong(_applied, fetched);
  }

  /// A missing profile means we're offline with no cached copy — tell the rep
  /// instead of silently doing nothing when they tap the button.
  void _showProfileMissing() {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(
        content: Text(
          "Your profile hasn't loaded yet. Connect to the internet once and "
          'try again.',
        ),
        backgroundColor: AppColors.warning,
      ));
  }

  Future<void> _checkIn(RouteVisit rv) async {
    if (_busy) return;
    final profile = ref.read(profileProvider).value;
    if (profile == null) {
      _showProfileMissing();
      return;
    }

    // The button is disabled without an open workday; this is the backstop so
    // a visit can never be recorded outside a tracked day.
    final session = ref.read(workdayControllerProvider).value;
    if (session == null) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(
          content: Text('Start your workday before checking in.'),
          backgroundColor: AppColors.warning,
        ));
      return;
    }

    setState(() => _busy = true);
    try {
      final result = await ref.read(visitRepositoryProvider).checkIn(
            orgId: profile.orgId,
            repId: profile.id,
            routeVisit: rv,
            workdaySessionClientId: session.clientGeneratedId,
          );
      // Render from what just happened, immediately — see `_applied`.
      if (mounted) {
        setState(() {
          _applied = rv.copyWith(
            status: 'checked_in',
            visitClientGeneratedId: result.clientGeneratedId,
            checkinAt: DateTime.now(),
          );
        });
      }
      // Still ask the day to catch up, for every other screen and for the
      // fields this screen does not carry.
      ref.invalidate(todayRoutesProvider);

      if (!mounted) return;
      final metres = result.distanceFromStoreM;
      final message = result.outsideGeofence
          ? 'Checked in — but you appear ${metres!.round()}m from the store. '
              'This was recorded for your manager.'
          : metres != null
              ? 'Checked in (${metres.round()}m from store).'
              : 'Checked in.';
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text(message),
          backgroundColor:
              result.outsideGeofence ? AppColors.warning : AppColors.success,
        ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Asks the rep to confirm before a check-out that leaves something behind.
  ///
  /// One dialog for every reason, not one per reason. A rep leaving after two
  /// minutes with promotions unanswered has two things worth saying, and two
  /// modals back to back reads as a bug.
  ///
  /// Unanswered promotions warn rather than block. Forms block, and that is
  /// right for them, but a promotion can be switched off by a manager at any
  /// moment: a rep with a day-old cache and no signal would be held at the door
  /// by a promotion that no longer exists, with answering falsely as the only
  /// way out. Three identical buttons are also the easiest thing in this app to
  /// falsify, and a check cannot be edited afterwards — a gate that turns
  /// "missing" into "possibly false" makes the manager's report worse, because
  /// missing is visible to them and false is not.
  Future<bool> _confirmCheckOut(List<String> concerns) async {
    if (concerns.isEmpty) return true;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(concerns.length == 1 && concerns.first.startsWith("You've")
            ? 'Check out already?'
            : 'Check out without finishing?'),
        content: Text('${concerns.join('\n\n')}\n\n'
            'Are you sure you want to check out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Stay checked in'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.warning),
            child: const Text('Check out anyway'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  /// Promoted lines at this store with no answer recorded during this visit.
  int _unansweredLines(RouteVisit rv) {
    final promos = ref.read(livePromotionsProvider).value ?? const <Promotion>[];
    final mine = PromotionRepository.forStore(promos, rv.storeId);
    if (mine.isEmpty || rv.visitClientGeneratedId == null) return 0;
    final answers = ref
            .read(promotionAnswersProvider(
                '${rv.storeId}|${rv.visitClientGeneratedId}'))
            .value ??
        const <String, PromotionAnswer>{};
    var n = 0;
    for (final p in mine) {
      for (final product in p.products) {
        final a = answers[PromotionAnswer.key(p.id, product.id)];
        if (a == null || !a.thisVisit) n += 1;
      }
    }
    return n;
  }

  Future<void> _checkOut(RouteVisit rv) async {
    if (_busy) return;
    final profile = ref.read(profileProvider).value;
    if (profile == null) {
      _showProfileMissing();
      return;
    }

    // Claim the button before awaiting the confirm dialog. Setting this only
    // afterwards let two quick taps both reach the queue and enqueue the
    // check-out twice.
    setState(() => _busy = true);
    try {
      final concerns = <String>[];
      if (rv.checkinAt != null) {
        final spent = DateTime.now().difference(rv.checkinAt!);
        if (spent < kMinimumVisitDuration) {
          final minutes = spent.inMinutes;
          final label = minutes < 1 ? 'less than a minute' : '$minutes min';
          concerns.add(
            "You've only been at this store for $label. Short visits are "
            'flagged for your manager.',
          );
        }
      }
      final unanswered = _unansweredLines(rv);
      if (unanswered > 0) {
        concerns.add(
          '$unanswered promoted line${unanswered == 1 ? '' : 's'} '
          "${unanswered == 1 ? 'has' : 'have'} not been answered. Your manager "
          'will see this shop as unchecked for '
          '${unanswered == 1 ? 'it' : 'them'}.',
        );
      }
      if (concerns.isNotEmpty) {
        final proceed = await _confirmCheckOut(concerns);
        if (!proceed) return;
      }

      if (!mounted) return;
      final session = ref.read(workdayControllerProvider).value;
      await ref.read(visitRepositoryProvider).checkOut(
            orgId: profile.orgId,
            repId: profile.id,
            routeVisit: rv,
            workdaySessionClientId: session?.clientGeneratedId,
          );
      // Same reason as check-in: show the outcome of the tap straight away
      // rather than waiting on a refetch that may not land.
      if (mounted) {
        setState(() {
          _applied = rv.copyWith(
            status: 'checked_out',
            checkoutAt: DateTime.now(),
          );
        });
      }
      ref.invalidate(todayRoutesProvider);

      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(
          content: Text('Checked out.'),
          backgroundColor: AppColors.success,
        ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Last stop before a coordinate becomes permanent. A rep gets one chance at
  /// this per store — the server will not let it be overwritten afterwards —
  /// so the dialog says what it is about to do and what it will cost if the
  /// rep is not actually in the shop.
  Future<bool> _confirmStoreLocation(
    RouteVisit rv,
    double accuracyM,
    double? movingBy,
  ) async {
    // How far the shop is about to move, when it already had a position. A rep
    // agreeing to shift a shop 40 m is doing something different from one
    // shifting it 3 km, and only the second is worth pausing over — saying the
    // number lets them notice they are standing somewhere unexpected.
    final movement = movingBy == null
        ? ''
        : movingBy >= 1000
            ? 'That moves it about ${(movingBy / 1000).toStringAsFixed(1)}km '
                'from where it currently sits.\n\n'
            : 'That moves it about ${movingBy.round()}m from where it '
                'currently sits.\n\n';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Use this spot?'),
        content: Text(
          'This will put ${rv.storeName} on the map where you are standing '
          'now, accurate to about ${accuracyM.round()}m.\n\n'
          '$movement'
          'Every future visit to this shop is measured from that point, and it '
          "can't be changed from the app afterwards. Only do this if you are "
          'at the shop itself.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Not now'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text("I'm at the shop"),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  Future<void> _setStoreLocation(RouteVisit rv) async {
    if (_locating) return;
    final clientId = rv.visitClientGeneratedId;
    if (clientId == null) return;

    setState(() => _locating = true);
    try {
      final position = await LocationService.getCurrentPosition();

      // Checked before asking rather than after: there is no point walking the
      // rep through a confirmation the server is going to refuse. The same
      // limit is enforced in `set_store_location_from_visit`.
      if (position.accuracy <= 0 ||
          position.accuracy > kMaxLocationAccuracyM) {
        if (!mounted) return;
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(
            content: Text(
              'Your phone is only sure of your position to about '
              '${position.accuracy.round()}m. Step outside the building, wait '
              'a moment, and try again.',
            ),
            backgroundColor: AppColors.warning,
          ));
        return;
      }

      final movingBy = rv.hasGuessedLocation
          ? LocationService.distanceBetween(
              rv.storeLat!, rv.storeLng!, position.latitude, position.longitude)
          : null;

      if (!mounted) return;
      if (!await _confirmStoreLocation(rv, position.accuracy, movingBy)) return;

      // The check-in may still be sitting in the outbox — the server can only
      // judge this against a visit it has. Flushing first turns "not synced
      // yet" from the usual case into a rare one.
      await ref.read(syncEngineProvider).sync();

      await ref.read(routeRepositoryProvider).setStoreLocationFromVisit(
            visitClientGeneratedId: clientId,
            lat: position.latitude,
            lng: position.longitude,
            accuracyM: position.accuracy,
          );

      // Keep the cached copy in step so the prompt disappears immediately,
      // including offline afterwards.
      await ref.read(routeRepositoryProvider).applyLocalVisitChange(
            rv.copyWith(
              storeLat: position.latitude,
              storeLng: position.longitude,
              // Without the source the card would come straight back: the
              // store now has coordinates either way, and it is the provenance
              // that decides whether to keep asking.
              storeGeocodeSource: 'rep',
            ),
          );
      ref.invalidate(todayRoutesProvider);
      ref.invalidate(storesProvider);

      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text('${rv.storeName} is on the map now. Thank you.'),
          backgroundColor: AppColors.success,
        ));
    } on LocationDeniedException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text(e.message),
          backgroundColor: AppColors.warning,
        ));
    } on StoreLocationException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text(e.message),
          backgroundColor: AppColors.warning,
        ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final routesAsync = ref.watch(todayRoutesProvider);
    final workdayAsync = ref.watch(workdayControllerProvider);
    // Only judge once we actually know — otherwise the gate flickers on during
    // the provider's initial load.
    final workdayKnown = !workdayAsync.isLoading;
    final hasWorkday = workdayAsync.value != null;

    return Scaffold(
      appBar: AppBar(title: const Text('Store visit')),
      body: routesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (routes) {
          final rv = _find(routes);
          if (rv == null) {
            return const Center(child: Text('Visit not found.'));
          }

          // Outstanding forms gate the check-out. If templates can't be read
          // at all (no connection, nothing cached) the list is empty and the
          // gate stays open — a rep must never be stranded at a store by a
          // form we can't even show them.
          final templates =
              ref.watch(formTemplatesProvider).value ?? const <FormTemplate>[];
          final submitted = rv.visitClientGeneratedId != null
              ? ref
                      .watch(submittedTemplateIdsProvider(
                          rv.visitClientGeneratedId!))
                      .value ??
                  const <String>{}
              : const <String>{};
          final outstanding =
              templates.where((t) => !submitted.contains(t.id)).toList();

          // Why the primary action is unavailable, or null when it's allowed.
          final String? blockedReason;
          if (!rv.isCheckedIn && workdayKnown && !hasWorkday) {
            blockedReason =
                'Start your workday before checking in to a store.';
          } else if (rv.isCheckedIn && outstanding.isNotEmpty) {
            blockedReason = outstanding.length == 1
                ? 'Submit "${outstanding.first.name}" before checking out.'
                : 'Submit all ${outstanding.length} forms before checking out.';
          } else {
            blockedReason = null;
          }

          final timeFormat = DateFormat.jm();
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                margin: EdgeInsets.zero,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 46,
                            height: 46,
                            decoration: BoxDecoration(
                              color: AppColors.gold.withValues(alpha: 0.18),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(Icons.storefront_outlined,
                                color: AppColors.navy),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  rv.storeName,
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                StatusBadge(status: rv.status),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (rv.storeAddress != null) ...[
                        const Divider(height: 26),
                        _DetailRow(
                          icon: Icons.location_on_outlined,
                          label: 'Address',
                          value: [rv.storeAddress, rv.storeCity, rv.storeState]
                              .where((s) => s != null && s.isNotEmpty)
                              .join(', '),
                        ),
                      ],
                      if (rv.isUnscheduled) ...[
                        const SizedBox(height: 12),
                        const _DetailRow(
                          icon: Icons.event_busy_outlined,
                          label: 'Scheduled',
                          value: 'Unscheduled visit',
                        ),
                      ],
                      if (rv.scheduledStartAt != null) ...[
                        const SizedBox(height: 12),
                        _DetailRow(
                          icon: Icons.schedule,
                          label: 'Scheduled',
                          value:
                              '${timeFormat.format(rv.scheduledStartAt!)}${rv.scheduledEndAt != null ? ' – ${timeFormat.format(rv.scheduledEndAt!)}' : ''}',
                        ),
                      ],
                      if (rv.checkinAt != null) ...[
                        const SizedBox(height: 12),
                        _DetailRow(
                          icon: Icons.login,
                          label: 'Checked in',
                          value: timeFormat.format(rv.checkinAt!),
                        ),
                      ],
                      if (rv.checkoutAt != null) ...[
                        const SizedBox(height: 12),
                        _DetailRow(
                          icon: Icons.logout,
                          label: 'Checked out',
                          value: timeFormat.format(rv.checkoutAt!),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              if (blockedReason != null && !rv.isCheckedOut) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline,
                          size: 18, color: AppColors.warning),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          blockedReason,
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.textPrimary),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],
              // Nobody has stood in this shop and measured it, and the rep is
              // standing in it now.
              //
              // The test is the *provenance* of the position, not whether one
              // exists. Most stores here carry a point Google guessed from the
              // shop's name, and a guess is exactly what someone on site can
              // replace — an earlier version only offered this when the store
              // had no coordinates at all, which hid the button on the 194
              // stores that most needed it.
              //
              // Offered only while checked in: the server anchors the new point
              // to the check-in fix, and a rep who has left is no longer the
              // right instrument.
              if (rv.isCheckedIn &&
                  rv.visitClientGeneratedId != null &&
                  !rv.hasVerifiedLocation) ...[
                _SetLocationCard(
                  busy: _locating,
                  isCorrection: rv.hasGuessedLocation,
                  onPressed: _locating ? null : () => _setStoreLocation(rv),
                ),
                const SizedBox(height: 16),
              ],
              // Above Forms deliberately. Forms block check-out and promotions
              // do not, so putting promotions first means the rep passes them
              // on the way to the thing that actually stops them leaving —
              // compliance pressure without another gate.
              if (rv.visitClientGeneratedId != null &&
                  (rv.isCheckedIn || rv.isCheckedOut)) ...[
                _PromotionsSection(
                  storeId: rv.storeId,
                  visitClientGeneratedId: rv.visitClientGeneratedId!,
                  readOnly: rv.isCheckedOut,
                ),
              ],
              // Forms become available once the rep is on site.
              if (rv.visitClientGeneratedId != null && (rv.isCheckedIn || rv.isCheckedOut)) ...[
                _FormsSection(
                  visitClientGeneratedId: rv.visitClientGeneratedId!,
                  readOnly: rv.isCheckedOut,
                ),
                const SizedBox(height: 16),
              ],
              if (rv.isCheckedOut)
                const _DoneNotice()
              else
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton.icon(
                    onPressed: _busy || blockedReason != null
                        ? null
                        : () => rv.isCheckedIn ? _checkOut(rv) : _checkIn(rv),
                    icon: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor:
                                  AlwaysStoppedAnimation<Color>(Colors.white),
                            ),
                          )
                        : Icon(rv.isCheckedIn ? Icons.logout : Icons.login),
                    label: Text(
                      _busy
                          ? 'Getting your location…'
                          : rv.isCheckedIn
                              ? 'Check out'
                              : 'Check in',
                      style: const TextStyle(fontSize: 16),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor:
                          rv.isCheckedIn ? AppColors.danger : AppColors.navy,
                    ),
                  ),
                ),
              const SizedBox(height: 10),
              const Text(
                'Your GPS location is recorded at check-in and check-out.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textMuted, fontSize: 11.5),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Lists the org's active form templates for this visit, marking off the ones
/// already submitted so a rep can see what's still outstanding.
class _FormsSection extends ConsumerWidget {
  const _FormsSection({required this.visitClientGeneratedId, required this.readOnly});

  final String visitClientGeneratedId;
  final bool readOnly;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final templatesAsync = ref.watch(formTemplatesProvider);
    final submittedAsync = ref.watch(submittedTemplateIdsProvider(visitClientGeneratedId));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Forms',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 15,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 8),
        templatesAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (e, _) => Text('Could not load forms: $e',
              style: const TextStyle(color: AppColors.textMuted)),
          data: (templates) {
            if (templates.isEmpty) {
              return const Text(
                'No forms have been published for your team yet.',
                style: TextStyle(color: AppColors.textMuted, fontSize: 13),
              );
            }
            final submitted = submittedAsync.value ?? const <String>{};
            return Column(
              children: templates.map((t) {
                final done = submitted.contains(t.id);
                return Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: Icon(
                      done ? Icons.check_circle : Icons.assignment_outlined,
                      color: done ? AppColors.success : AppColors.navy,
                    ),
                    title: Text(
                      t.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    subtitle: Text(
                      done
                          ? 'Submitted'
                          : '${t.fields.length} question${t.fields.length == 1 ? '' : 's'}',
                      style: const TextStyle(fontSize: 12),
                    ),
                    trailing: done || readOnly
                        ? null
                        : const Icon(Icons.chevron_right),
                    onTap: done || readOnly
                        ? null
                        : () async {
                            final saved = await Navigator.push<bool>(
                              context,
                              MaterialPageRoute(
                                builder: (_) => FormFillScreen(
                                  template: t,
                                  visitClientGeneratedId: visitClientGeneratedId,
                                ),
                              ),
                            );
                            if (saved == true) {
                              ref.invalidate(
                                  submittedTemplateIdsProvider(visitClientGeneratedId));
                            }
                          },
                  ),
                );
              }).toList(),
            );
          },
        ),
      ],
    );
  }
}

/// Promotions running at this store today, one tap per line.
///
/// Three answers, and the third is not a softer "no": a shop that has never
/// carried the line is a ranging question for a buyer, not a compliance failure
/// for anyone in the shop, and folding it into "not running" would send the
/// wrong person after the wrong problem.
class _PromotionsSection extends ConsumerStatefulWidget {
  const _PromotionsSection({
    required this.storeId,
    required this.visitClientGeneratedId,
    required this.readOnly,
  });

  final String storeId;
  final String visitClientGeneratedId;
  final bool readOnly;

  @override
  ConsumerState<_PromotionsSection> createState() => _PromotionsSectionState();
}

class _PromotionsSectionState extends ConsumerState<_PromotionsSection> {
  String? _busyKey;

  String get _answersKey => '${widget.storeId}|${widget.visitClientGeneratedId}';

  Future<void> _answer(
    Promotion promo,
    PromotedProduct product,
    String status, {
    String? note,
  }) async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) return;
    final key = PromotionAnswer.key(promo.id, product.id);
    setState(() => _busyKey = key);
    try {
      await ref.read(promotionRepositoryProvider).recordAnswer(
            orgId: profile.orgId,
            repId: profile.id,
            storeId: widget.storeId,
            promotionId: promo.id,
            productId: product.id,
            status: status,
            visitClientGeneratedId: widget.visitClientGeneratedId,
            note: note,
          );
      ref.invalidate(promotionAnswersProvider(_answersKey));
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  /// Five identical taps to state one fact punishes an honest rep, so the whole
  /// promotion can be answered at once when the shop carries none of it.
  Future<void> _markAllNotStocked(Promotion promo) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('None of these are stocked?'),
        content: Text(
          'This marks all ${promo.products.length} lines on "${promo.name}" as '
          'not carried by this shop.\n\nThat tells your manager the promotion '
          'was aimed at the wrong outlet — it is not counted against you.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Mark all'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    for (final p in promo.products) {
      // A row each, with its own idempotency key, so the shape of the data is
      // the same as if they had been tapped one at a time. The note is what
      // lets a manager tell a bulk answer from five considered ones.
      await _answer(promo, p, CheckStatus.notStocked,
          note: 'Marked with the whole promotion');
    }
  }

  @override
  Widget build(BuildContext context) {
    final promosAsync = ref.watch(livePromotionsProvider);
    final all = promosAsync.value ?? const <Promotion>[];
    final mine = PromotionRepository.forStore(all, widget.storeId);
    if (mine.isEmpty) return const SizedBox.shrink();

    final answers = ref.watch(promotionAnswersProvider(_answersKey)).value ??
        const <String, PromotionAnswer>{};

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Promotions',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 15,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 8),
        ...mine.map((promo) => _PromotionCard(
              promo: promo,
              answers: answers,
              busyKey: _busyKey,
              readOnly: widget.readOnly,
              onAnswer: (product, status) => _answer(promo, product, status),
              onNoneStocked: () => _markAllNotStocked(promo),
            )),
        const SizedBox(height: 16),
      ],
    );
  }
}

class _PromotionCard extends StatelessWidget {
  const _PromotionCard({
    required this.promo,
    required this.answers,
    required this.busyKey,
    required this.readOnly,
    required this.onAnswer,
    required this.onNoneStocked,
  });

  final Promotion promo;
  final Map<String, PromotionAnswer> answers;
  final String? busyKey;
  final bool readOnly;
  final void Function(PromotedProduct, String) onAnswer;
  final VoidCallback onNoneStocked;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.local_offer_outlined,
                    size: 18, color: AppColors.navy),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    promo.name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14.5,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
              ],
            ),
            if (promo.brief != null && promo.brief!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                promo.brief!,
                style: const TextStyle(
                    fontSize: 12.5, color: AppColors.textMuted),
              ),
            ],
            const Divider(height: 22),
            ...promo.products.map((product) {
              final key = PromotionAnswer.key(promo.id, product.id);
              final answer = answers[key];
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    // An answer from an earlier visit is context, not a job
                    // done — the rep is standing here again today.
                    if (answer != null && !answer.thisVisit)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          'Last time: ${_statusLabel(answer.status).toLowerCase()}',
                          style: const TextStyle(
                              fontSize: 11.5, color: AppColors.textMuted),
                        ),
                      ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        for (final status in const [
                          CheckStatus.running,
                          CheckStatus.notRunning,
                          CheckStatus.notStocked,
                        ])
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(right: 6),
                              child: _AnswerButton(
                                label: _statusLabel(status),
                                selected: answer?.thisVisit == true &&
                                    answer?.status == status,
                                // A re-tap records a new answer rather than
                                // editing the old one, so a mis-tap is never
                                // permanent.
                                onPressed: readOnly || busyKey == key
                                    ? null
                                    : () => onAnswer(product, status),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              );
            }),
            if (!readOnly && promo.products.length > 1)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: onNoneStocked,
                  child: const Text(
                    "This shop doesn't stock any of these",
                    style: TextStyle(fontSize: 12.5),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

String _statusLabel(String status) {
  switch (status) {
    case CheckStatus.running:
      return 'Running';
    case CheckStatus.notRunning:
      return 'Not running';
    default:
      return "Don't stock";
  }
}

class _AnswerButton extends StatelessWidget {
  const _AnswerButton({
    required this.label,
    required this.selected,
    required this.onPressed,
  });

  final String label;
  final bool selected;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 38,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          backgroundColor: selected ? AppColors.navy : null,
          foregroundColor: selected ? Colors.white : AppColors.textPrimary,
          side: BorderSide(
            color: selected ? AppColors.navy : AppColors.border,
          ),
          padding: EdgeInsets.zero,
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 11.5),
        ),
      ),
    );
  }
}

/// Asks the rep to put a store on the map.
///
/// Framed as something the rep is doing for themselves rather than a chore:
/// until this shop has a point, the app cannot show it was visited from the
/// right place, and the rep is the only person who can fix that.
class _SetLocationCard extends StatelessWidget {
  const _SetLocationCard({
    required this.busy,
    required this.isCorrection,
    required this.onPressed,
  });

  final bool busy;

  /// The store already has a position, it just isn't one anybody checked.
  /// Worth saying plainly — "this shop is not on the map" would be wrong, and
  /// a rep who can see a pin nearby would rightly ignore it.
  final bool isCorrection;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.gold.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.wrong_location_outlined,
                  size: 18, color: AppColors.navy),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  isCorrection
                      ? 'This shop’s position is a guess'
                      : 'This shop is not on the map',
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            isCorrection
                ? 'Nobody has ever checked where it really is — the pin came '
                    'from a name search, and those often land on the wrong '
                    'branch. You are standing in the shop, so you can settle '
                    'it. Do this once and it is right for everyone.'
                : 'We have no location for it, so your visits here cannot be '
                    'shown against the right place. You are standing in it — '
                    'mark it once and it is fixed for everyone.',
            style: const TextStyle(fontSize: 12.5, color: AppColors.textPrimary),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 46,
            child: ElevatedButton.icon(
              onPressed: onPressed,
              icon: busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor:
                            AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : const Icon(Icons.add_location_alt_outlined, size: 20),
              label: Text(
                busy
                    ? 'Getting your location…'
                    : isCorrection
                        ? "Move it to where I'm standing"
                        : "Set it to where I'm standing",
                style: const TextStyle(fontSize: 14.5),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.navy,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DoneNotice extends StatelessWidget {
  const _DoneNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.success.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
      ),
      child: const Row(
        children: [
          Icon(Icons.check_circle, color: AppColors.success),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'This visit is complete.',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 17, color: AppColors.textMuted),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 14,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
