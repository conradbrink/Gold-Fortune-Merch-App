import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/workday/workday_auto_end.dart';
import 'branding.dart';
import 'env.dart';
import 'location_tracking.dart';
import 'providers.dart';
import 'supabase_client.dart';
import 'terms.dart';

/// The rep's company configuration: which modules it has, the field settings
/// the phone obeys — GPS interval, short-visit threshold, the auto-end rule, the
/// default check-in radius — and the company's own words and look.
///
/// Read from `my_company_config()` (the same call the web makes) and kept per
/// company in the local key/value store, because the phone must know its rules
/// offline: a rep starting the day in a dead spot still needs the right GPS
/// interval and the right auto-end time.
///
/// **Fallback.** A first launch with no network and nothing cached gets
/// [CompanyConfig.fallback]: every module on and the values this app has always
/// used. Showing a module the company lacks is the safe direction to be wrong
/// in for one offline launch — the database refuses its data regardless
/// (`module_gate`, `require_module`) — whereas hiding one it has would strand a
/// rep without a screen they need.
class CompanyConfig {
  const CompanyConfig({
    required this.modules,
    required this.pingInterval,
    required this.shortVisit,
    required this.autoEnd,
    required this.checkinRadiusM,
    this.terms = Terms.defaults,
    this.branding = Branding.product,
  });

  /// Modules switched on, `core` always included.
  final Set<String> modules;

  /// How often the trail samples while a workday is open.
  final Duration pingInterval;

  /// A check-out sooner than this asks for confirmation. Zero turns it off.
  final Duration shortVisit;

  /// When a forgotten workday ends itself, or never.
  final AutoEndRule autoEnd;

  /// The company's default check-in radius, for a site that has none.
  final int checkinRadiusM;

  /// The company's words for site, job, staff and the rest.
  final Terms terms;

  /// The company's name, logo and colours.
  final Branding branding;

  bool has(String module) => module == 'core' || modules.contains(module);

  /// The floor between two written pings: four fifths of the interval, so a
  /// stream delivering slightly early is not dropped. 4 min at 5.
  Duration get minPingSpacing => pingInterval * 4 ~/ 5;

  /// How long a running trail may go silent before it is restarted on
  /// resume: two intervals, so one late fix does not count. 10 min at 5.
  Duration get trailStallAfter => pingInterval * 2;

  static const fallback = CompanyConfig(
    modules: {
      'core',
      'recurring_jobs',
      'checklists_forms',
      'reports',
      'distribution',
      'warehouse',
      'hr',
    },
    pingInterval: kLocationPingInterval,
    shortVisit: Duration(minutes: 5),
    autoEnd: AutoEndRule.fallback,
    checkinRadiusM: 100,
  );

  /// From `my_company_config()`. Anything missing or malformed keeps the
  /// fallback's value for that field rather than failing the whole config: a
  /// newer server adding a setting must not break an older app.
  factory CompanyConfig.fromJson(Map<String, dynamic> json) {
    final f = fallback;
    final rawModules = json['modules'];
    final modules = <String>{'core'};
    if (rawModules is Map) {
      rawModules.forEach((k, v) {
        if (v == true) modules.add(k as String);
      });
    } else {
      modules.addAll(f.modules);
    }
    final s = json['settings'] is Map
        ? Map<String, dynamic>.from(json['settings'] as Map)
        : const <String, dynamic>{};

    int? intOf(String key) => s[key] is num ? (s[key] as num).toInt() : null;

    final interval = intOf('gps_ping_interval_minutes');
    final shortVisit = intOf('short_visit_minutes');
    final radius = intOf('checkin_radius_m');
    final autoEnabled = s['auto_end_enabled'] is bool ? s['auto_end_enabled'] as bool : null;
    final autoTime = AutoEndRule.parseTime(s['auto_end_time']);

    return CompanyConfig(
      modules: modules,
      pingInterval: interval != null && interval > 0
          ? Duration(minutes: interval)
          : f.pingInterval,
      shortVisit: shortVisit != null && shortVisit >= 0
          ? Duration(minutes: shortVisit)
          : f.shortVisit,
      autoEnd: AutoEndRule(
        enabled: autoEnabled ?? f.autoEnd.enabled,
        hour: autoTime?.$1 ?? f.autoEnd.hour,
        minute: autoTime?.$2 ?? f.autoEnd.minute,
      ),
      checkinRadiusM: radius != null && radius > 0 ? radius : f.checkinRadiusM,
      terms: Terms.fromJson(json['terms']),
      branding: Branding.fromJson(json['branding']),
    );
  }
}

/// The configuration, cache-first.
///
/// Answers from the local cache at once when there is one, and refreshes from
/// the server in the background; a refresh that changes anything invalidates
/// this provider so the new values reach everything watching it. With no cache
/// it waits for the server, and with neither it is [CompanyConfig.fallback].
final companyConfigProvider = FutureProvider<CompanyConfig>((ref) async {
  final profile = await ref.watch(profileProvider.future);
  if (profile == null) return CompanyConfig.fallback;

  final db = ref.watch(appDatabaseProvider);
  final key = 'company_config:${profile.orgId}';
  final cached = await db.getValue(key);

  Future<String?> fetch() async {
    final data = await supabase.rpc('my_company_config');
    if (data is! Map) return null;
    final raw = jsonEncode(data);
    await db.setValue(key, raw);
    await db.setValue(_lastCompanyKey, profile.orgId);
    return raw;
  }

  if (cached != null) {
    await db.setValue(_lastCompanyKey, profile.orgId);
    unawaited(
      fetch().then((fresh) {
        if (fresh != null && fresh != cached && ref.mounted) ref.invalidateSelf();
      }).catchError((Object _) {}),
    );
    return CompanyConfig.fromJson(jsonDecode(cached) as Map<String, dynamic>);
  }

  try {
    final fresh = await fetch();
    return fresh == null
        ? CompanyConfig.fallback
        : CompanyConfig.fromJson(jsonDecode(fresh) as Map<String, dynamic>);
  } catch (_) {
    return CompanyConfig.fallback;
  }
});

/// The configuration to act on right now: the loaded one, or the fallback
/// while it loads. For code that must decide synchronously — a check-out, a
/// timer — and cannot wait for a future.
final companyConfigValueProvider = Provider<CompanyConfig>((ref) {
  return ref.watch(companyConfigProvider).value ?? CompanyConfig.fallback;
});

/// Which company's configuration this phone last held, so the login screen
/// after a sign-out — and the first frame of the next launch — can wear that
/// company's name, logo and colours instead of the product's.
const _lastCompanyKey = 'company_config:last_org';

/// The company this phone last signed in to, with its cached configuration.
typedef LastCompany = ({String orgId, CompanyConfig config});

/// The last company's configuration, from the local cache only.
///
/// Recomputed on every sign-in and sign-out, so the login screen that follows
/// a sign-out shows the company that was just signed out of. `main` reads it
/// before the first frame, which is what keeps a signed-in rep from seeing the
/// product's colours flash up while their profile loads over the network.
final lastCompanyProvider = FutureProvider<LastCompany?>((ref) async {
  final user = ref.watch(currentUserProvider);
  final db = ref.watch(appDatabaseProvider);
  var orgId = await db.getValue(_lastCompanyKey);
  // A phone updated from a release that never wrote the key above still has
  // the signed-in rep's profile cached, and the profile names the company.
  if (orgId == null && user != null) {
    final raw = await db.getValue('profile:${user.id}');
    if (raw != null) {
      orgId = (jsonDecode(raw) as Map<String, dynamic>)['org_id'] as String?;
    }
  }
  if (orgId == null) return null;
  final raw = await db.getValue('company_config:$orgId');
  if (raw == null) return null;
  return (
    orgId: orgId,
    config: CompanyConfig.fromJson(jsonDecode(raw) as Map<String, dynamic>),
  );
});

/// What the screens wear right now: whose words, whose look.
typedef CompanyLook = ({String? orgId, Terms terms, Branding branding});

/// The signed-in company's words and look once its configuration is known;
/// until then — and on the login screen — the last company this phone knew;
/// and on a phone that has never signed in, the product's own.
///
/// [CompanyConfig.fallback] stands for "not known yet" here (signed out, or
/// offline with nothing cached): its modules are a deliberate everything-on,
/// but its words and colours are only the neutral defaults, and the last
/// company's are the better guess.
final companyLookProvider = Provider<CompanyLook>((ref) {
  final loaded = ref.watch(companyConfigProvider).value;
  if (loaded != null && !identical(loaded, CompanyConfig.fallback)) {
    return (
      orgId: ref.watch(profileProvider).value?.orgId,
      terms: loaded.terms,
      branding: loaded.branding,
    );
  }
  final last = ref.watch(lastCompanyProvider).value;
  if (last != null) {
    return (
      orgId: last.orgId,
      terms: last.config.terms,
      branding: last.config.branding,
    );
  }
  return (orgId: null, terms: Terms.defaults, branding: Branding.product);
});

/// The company's words. `final t = ref.watch(termsProvider);` then
/// `t.site.one`, `t.job.count(3)`.
final termsProvider = Provider<Terms>((ref) {
  return ref.watch(companyLookProvider).terms;
});

/// The company's name, logo path and colours.
final brandingProvider = Provider<Branding>((ref) {
  return ref.watch(companyLookProvider).branding;
});

final logoCacheProvider = Provider<LogoCache>((ref) {
  return LogoCache(ref.watch(appDatabaseProvider));
});

/// The company logo as a file on the phone, or null for none. Downloaded the
/// first time it is asked for while signed in — the app asks at once, so that
/// it is already there for the next login screen, which may have no signal.
final companyLogoProvider = FutureProvider<File?>((ref) async {
  final key = ref.watch(companyLookProvider
      .select((l) => (orgId: l.orgId, logoPath: l.branding.logoPath)));
  if (key.orgId == null) return null;
  return ref.watch(logoCacheProvider).ensure(
        orgId: key.orgId!,
        logoPath: key.logoPath,
        supabaseUrl: Env.supabaseUrl,
      );
});

/// The module a screen of this app belongs to, from its location — `core`
/// when none claims it. The router sends a rep away from a screen whose module
/// the company lacks, so a deep link or a stale back stack cannot open what
/// the menus no longer offer. Same idea, and same shape, as the web's
/// `moduleForPath`.
String moduleForLocation(String location) {
  bool under(String prefix) =>
      location == prefix || location.startsWith('$prefix/');
  if (under('/my-hr')) return 'hr';
  if (under('/deliveries')) return 'warehouse';
  if (under('/unscheduled/sales')) return 'distribution';
  if (RegExp(r'^/visit/[^/]+/order(/|$)').hasMatch(location)) {
    return 'distribution';
  }
  return 'core';
}
