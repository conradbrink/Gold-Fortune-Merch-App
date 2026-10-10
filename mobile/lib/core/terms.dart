/// The company's own words for the things the product is about.
///
/// A cleaning company has sites and cleaners where a distributor has stores
/// and reps, and the screens say whichever the company chose. The words arrive
/// with `my_company_config()` (`terms`), falling back key by key to the
/// catalogue's neutral defaults, so a screen never shows an empty label.
///
/// Mirrors `web/lib/terms.ts`, so a word reads the same on the phone as on the
/// dashboard:
///
///   t.site.one              "Store"
///   t.site.count(3)         "3 stores"
///   t.job.withArticle       "a visit"
///   lower(t.staff.many)     "reps"
library;

/// One term: its singular and plural label, and the article when the first
/// letter does not tell ("an hour", "a unit").
class Term {
  const Term(this.one, this.many, {this.article});

  /// Singular, as a label: "Store".
  final String one;

  /// Plural, as a label: "Stores".
  final String many;

  /// "a" / "an" set by the company; null to decide from the first letter.
  final String? article;

  /// "a" or "an", the company's choice first.
  String get a =>
      article ?? (RegExp('^[aeiou]', caseSensitive: false).hasMatch(one) ? 'an' : 'a');

  /// "a store": the singular, lower-case, with its article.
  String get withArticle => '$a ${lower(one)}';

  /// The singular for use mid-sentence: "store".
  String get oneLower => lower(one);

  /// The plural for use mid-sentence: "stores".
  String get manyLower => lower(many);

  /// "1 store", "3 stores", "0 stores". Lower-case for running text;
  /// [label] keeps the label's capital ("3 Stores").
  String count(int n, {bool label = false}) {
    final w = n == 1 ? one : many;
    return '$n ${label ? w : lower(w)}';
  }

  @override
  bool operator ==(Object other) =>
      other is Term &&
      other.one == one &&
      other.many == many &&
      other.article == article;

  @override
  int get hashCode => Object.hash(one, many, article);
}

/// Every term the app uses, by its catalogue key.
class Terms {
  const Terms({
    required this.site,
    required this.siteGroup,
    required this.job,
    required this.staff,
    required this.client,
    required this.region,
    required this.territory,
    required this.prospect,
    required this.scheduleCycle,
    required this.dayPlan,
    required this.workday,
  });

  /// A place the team works at. "Store", "Site".
  final Term site;

  /// A group of sites. "Chain", "Group".
  final Term siteGroup;

  /// One piece of work at a site. "Visit", "Job".
  final Term job;

  /// A person in the field team. "Rep", "Staff member".
  final Term staff;

  /// Who the work is for. "Customer", "Client".
  final Term client;
  final Term region;
  final Term territory;

  /// Somebody who might become a client. "Lead".
  final Term prospect;
  final Term scheduleCycle;

  /// The day's list of work. "Today's route", "Today's jobs".
  final Term dayPlan;
  final Term workday;

  /// The catalogue's neutral defaults, mirrored from `term_definitions` and
  /// from the web's `DEFAULT_TERMS`. Used before the configuration has loaded
  /// and for any key the payload lacks.
  static const defaults = Terms(
    site: Term('Site', 'Sites'),
    siteGroup: Term('Group', 'Groups'),
    job: Term('Job', 'Jobs'),
    staff: Term('Staff member', 'Staff'),
    client: Term('Client', 'Clients'),
    region: Term('Region', 'Regions'),
    territory: Term('Territory', 'Territories'),
    prospect: Term('Lead', 'Leads'),
    scheduleCycle: Term('Recurring schedule', 'Recurring schedules'),
    dayPlan: Term("Today's jobs", "Today's jobs"),
    workday: Term('Workday', 'Workdays'),
  );

  /// The `terms` object of the config payload, checked key by key: a missing
  /// key, a blank word or an article other than "a"/"an" keeps the default
  /// for that word alone.
  factory Terms.fromJson(Object? raw) {
    final r = raw is Map ? raw : const {};
    const d = defaults;

    Term term(String key, Term fallback) {
      final v = r[key] is Map ? r[key] as Map : const {};
      String word(Object? w, String fallback) =>
          w is String && w.trim().isNotEmpty ? w.trim() : fallback;
      final article = v['article'];
      return Term(
        word(v['one'], fallback.one),
        word(v['many'], fallback.many),
        article: article == 'a' || article == 'an' ? article as String : null,
      );
    }

    return Terms(
      site: term('site', d.site),
      siteGroup: term('site_group', d.siteGroup),
      job: term('job', d.job),
      staff: term('staff', d.staff),
      client: term('client', d.client),
      region: term('region', d.region),
      territory: term('territory', d.territory),
      prospect: term('prospect', d.prospect),
      scheduleCycle: term('schedule_cycle', d.scheduleCycle),
      dayPlan: term('day_plan', d.dayPlan),
      workday: term('workday', d.workday),
    );
  }
}

/// Lower-case a term for use mid-sentence, leaving acronyms alone: "Store" →
/// "store", but "POS outlet" stays "POS outlet" and "ATM" stays "ATM".
String lower(String text) => text
    .split(' ')
    .map((w) => w.length > 1 && w == w.toUpperCase()
        ? w
        : w.isEmpty
            ? w
            : w[0].toLowerCase() + w.substring(1))
    .join(' ');

/// Capitalise the first letter, for a term that opens a sentence.
String capital(String text) =>
    text.isEmpty ? text : text[0].toUpperCase() + text.substring(1);

/// Every word capitalised, for titles: "Call cycle" → "Call Cycle".
String title(String text) => text.split(' ').map(capital).join(' ');

/// "Store's", "Reps'": the possessive of a singular or plural label.
String possessive(String text) =>
    RegExp(r's$', caseSensitive: false).hasMatch(text) ? "$text'" : "$text's";
