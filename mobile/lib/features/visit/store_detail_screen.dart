import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/form_template.dart';
import '../../data/models/route_visit.dart';
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

class _StoreDetailScreenState extends ConsumerState<StoreDetailScreen> {
  bool _busy = false;
  bool _locating = false;

  RouteVisit? _find(List<RouteVisit> routes) {
    for (final r in routes) {
      if (r.cacheKey == widget.visitKey) return r;
    }
    return null;
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

  /// Asks the rep to confirm when they're leaving unusually fast, so a
  /// mis-tap or a drive-by doesn't silently record as a completed visit.
  Future<bool> _confirmShortVisit(Duration spent) async {
    final minutes = spent.inMinutes;
    final label = minutes < 1 ? 'less than a minute' : '$minutes min';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Check out already?'),
        content: Text(
          "You've only been at this store for $label. Short visits are "
          'flagged for your manager.\n\nAre you sure you want to check out?',
        ),
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
      if (rv.checkinAt != null) {
        final spent = DateTime.now().difference(rv.checkinAt!);
        if (spent < kMinimumVisitDuration) {
          final proceed = await _confirmShortVisit(spent);
          if (!proceed) return;
        }
      }

      if (!mounted) return;
      final session = ref.read(workdayControllerProvider).value;
      await ref.read(visitRepositoryProvider).checkOut(
            orgId: profile.orgId,
            repId: profile.id,
            routeVisit: rv,
            workdaySessionClientId: session?.clientGeneratedId,
          );
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
