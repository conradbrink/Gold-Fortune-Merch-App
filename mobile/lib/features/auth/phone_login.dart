// Staff with no email address sign in with their cell phone number and a
// password, as on the web (web/lib/phone-login.ts). Underneath it is still
// email and password: a number becomes a login nobody types or sees,
// "+27 82 555 0142" -> "27825550142@staff.tickd.co.za".
//
// The web reads a number with libphonenumber; the phone has no such library,
// so it knows the mobile numbers of the two countries Tickd sells in. A
// number typed with + (or 00) and its country code works from anywhere.

/// Must match `STAFF_LOGIN_DOMAIN` on the web: every phone login carries it.
const kStaffLoginDomain = 'staff.tickd.co.za';

/// A country's mobile numbers as people type them at home.
typedef _MobilePlan = ({
  String code,
  bool trunkZero,
  int length,
  String firstDigits,
});

const Map<String, _MobilePlan> _plans = {
  // 082 555 0142: a 0, then nine digits starting 6, 7 or 8.
  'ZA': (code: '27', trunkZero: true, length: 9, firstDigits: '678'),
  // 71 234 567: eight digits starting 7, with no 0 in front.
  'BW': (code: '267', trunkZero: false, length: 8, firstDigits: '7'),
};

/// The logins to try for what someone typed: an email as typed, or a cell
/// number read in [country] (the phone's own) first and then each country
/// Tickd knows, until one signs in. Empty when it is neither.
List<String> loginCandidates(String typed, {String? country}) {
  final raw = typed.trim();
  if (raw.contains('@')) return [raw.toLowerCase()];
  if (!RegExp(r'^\+?[\d\s().-]{6,}$').hasMatch(raw)) return const [];
  final digits = raw.replaceAll(RegExp(r'\D'), '');
  if (raw.startsWith('+') || raw.startsWith('00')) {
    var international = raw.startsWith('+') ? digits : digits.substring(2);
    // "+27 082 555 0142": the home 0 kept after the country code, as many
    // people write it. The web's libphonenumber drops it; so does this.
    for (final plan in _plans.values) {
      if (plan.trunkZero && international.startsWith('${plan.code}0')) {
        international =
            plan.code + international.substring(plan.code.length + 1);
      }
    }
    return international.length >= 8 && international.length <= 15
        ? ['$international@$kStaffLoginDomain']
        : const [];
  }
  final countries = {
    if (country != null && _plans.containsKey(country.toUpperCase()))
      country.toUpperCase(),
    ..._plans.keys,
  };
  final out = <String>[];
  for (final c in countries) {
    final plan = _plans[c]!;
    var national = digits;
    if (plan.trunkZero && national.startsWith('0')) {
      national = national.substring(1);
    }
    // "27825550142": the country code typed without + (as WhatsApp shows
    // it). Only when the rest is a whole mobile number of that country.
    if (digits.startsWith(plan.code) &&
        digits.length == plan.code.length + plan.length &&
        plan.firstDigits.contains(digits[plan.code.length])) {
      national = digits.substring(plan.code.length);
    }
    if (national.length == plan.length &&
        plan.firstDigits.contains(national[0])) {
      final login = '${plan.code}$national@$kStaffLoginDomain';
      if (!out.contains(login)) out.add(login);
    }
  }
  return out;
}
