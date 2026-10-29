// Signing in with a cell phone number (lib/features/auth/phone_login.dart):
// the same hidden login the web makes (web/lib/phone-login.ts), so a number
// typed on the phone signs in to the account the company set up on the web.

import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/features/auth/phone_login.dart';

void main() {
  test('an email is used as typed, in lower case', () {
    expect(loginCandidates(' Sipho@Demo.co.za '), ['sipho@demo.co.za']);
    // The full hidden login, as the welcome message spells it out, still works.
    expect(loginCandidates('27825550142@staff.tickd.co.za'), [
      '27825550142@staff.tickd.co.za',
    ]);
  });

  test('a South African cell number, with or without its 0', () {
    expect(loginCandidates('082 555 0142', country: 'ZA'), [
      '27825550142@staff.tickd.co.za',
    ]);
    expect(loginCandidates('0825550142'), ['27825550142@staff.tickd.co.za']);
    expect(loginCandidates('82 555 0142'), ['27825550142@staff.tickd.co.za']);
  });

  test('a country code typed without +, as WhatsApp shows a number', () {
    expect(loginCandidates('27825550142'), ['27825550142@staff.tickd.co.za']);
    expect(loginCandidates('267 71 234 567'), [
      '26771234567@staff.tickd.co.za',
    ]);
  });

  test('a Botswana cell number', () {
    expect(loginCandidates('71 234 567', country: 'BW'), [
      '26771234567@staff.tickd.co.za',
    ]);
  });

  test('the phone’s own country is tried first', () {
    // Nine digits starting 7 can only be South African; eight only Botswana's.
    expect(loginCandidates('712345678', country: 'BW'), [
      '27712345678@staff.tickd.co.za',
    ]);
    expect(loginCandidates('71234567', country: 'ZA'), [
      '26771234567@staff.tickd.co.za',
    ]);
  });

  test('with + or 00 the country code is typed, from anywhere', () {
    expect(loginCandidates('+27 82 555 0142'), [
      '27825550142@staff.tickd.co.za',
    ]);
    expect(loginCandidates('00267 71 234 567'), [
      '26771234567@staff.tickd.co.za',
    ]);
    // The home 0 kept after the country code, as many people write it.
    expect(loginCandidates('+27 (0)82 555 0142'), [
      '27825550142@staff.tickd.co.za',
    ]);
    expect(loginCandidates('+44 7700 900123', country: 'GB'), [
      '447700900123@staff.tickd.co.za',
    ]);
  });

  test('anything else is neither, and is not sent', () {
    expect(loginCandidates(''), isEmpty);
    expect(loginCandidates('sipho'), isEmpty);
    expect(loginCandidates('011 555 0142'), isEmpty); // a landline
    expect(loginCandidates('0825'), isEmpty);
    expect(loginCandidates('+27'), isEmpty);
  });
}
