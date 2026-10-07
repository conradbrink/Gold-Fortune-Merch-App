import 'dart:io';
import 'dart:ui' show Color;

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../data/local/app_database.dart';
import 'product.dart';

/// The company's name, logo and two colours, from `my_company_config()`
/// (`branding`). The app paints itself in these once the configuration is
/// known; before that, and for a company that has set none, it is the product's
/// own neutral look.
class Branding {
  const Branding({
    this.name,
    this.legalName,
    this.logoPath,
    required this.primary,
    required this.accent,
  });

  /// The company's trading name, or null when unknown.
  final String? name;
  final String? legalName;

  /// Path of the logo inside the public `branding` bucket, or null for none.
  final String? logoPath;
  final Color primary;
  final Color accent;

  /// The product's look: no name, no logo, the neutral palette.
  static const product = Branding(
    primary: kProductPrimary,
    accent: kProductAccent,
  );

  /// The `branding` object of the config payload. A missing name stays null; a
  /// colour that is not `#RRGGBB` keeps the product's colour, so one bad value
  /// cannot paint the app in something nobody chose.
  factory Branding.fromJson(Object? raw) {
    final r = raw is Map ? raw : const {};
    String? text(Object? v) =>
        v is String && v.trim().isNotEmpty ? v.trim() : null;
    return Branding(
      name: text(r['name']),
      legalName: text(r['legal_name']),
      logoPath: text(r['logo_path']),
      primary: parseHexColor(r['primary']) ?? product.primary,
      accent: parseHexColor(r['accent']) ?? product.accent,
    );
  }
}

final _hex = RegExp(r'^#[0-9A-Fa-f]{6}$');

/// `#RRGGBB` as an opaque colour, or null for anything else — including the
/// short `#RGB` form and an alpha channel, which the server never sends.
Color? parseHexColor(Object? v) {
  if (v is! String || !_hex.hasMatch(v)) return null;
  return Color(0xFF000000 | int.parse(v.substring(1), radix: 16));
}

/// Where a logo in the public `branding` bucket is served from. Each segment
/// is encoded on its own, so a file name with a space survives.
Uri brandingLogoUrl(String supabaseUrl, String logoPath) {
  final base = Uri.parse(supabaseUrl);
  return base.replace(pathSegments: [
    ...base.pathSegments.where((s) => s.isNotEmpty),
    'storage',
    'v1',
    'object',
    'public',
    'branding',
    ...logoPath.split('/').where((s) => s.isNotEmpty),
  ]);
}

/// The company logo, kept on the phone.
///
/// Downloaded once per company into the app's support directory and used from
/// there, so the login screen and the header show it with no signal. It is
/// fetched again only when the company's `logo_path` changes — a new logo is a
/// new path, so the path is the version.
///
/// A failed download is no logo rather than an error: the logo is decoration,
/// and a rep must never be held up by it.
class LogoCache {
  LogoCache(this._db, {this.root, HttpClient Function()? client})
      : _client = client ?? HttpClient.new;

  final AppDatabase _db;

  /// Where the `branding` folder goes; the app's support directory unless a
  /// test says otherwise.
  final Directory? root;
  final HttpClient Function() _client;

  static String _pathKey(String orgId) => 'branding_logo:$orgId';

  Future<Directory> _dir() async {
    final base = root ?? await getApplicationSupportDirectory();
    final dir = Directory(p.join(base.path, 'branding'));
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// The logo file for [orgId] at [logoPath], downloading it when the phone
  /// does not already hold that exact one. Null when the company has no logo
  /// or it could not be fetched.
  Future<File?> ensure({
    required String orgId,
    required String? logoPath,
    required String supabaseUrl,
  }) async {
    if (logoPath == null) return null;
    try {
      final dir = await _dir();
      // Named after the path, not the company: a new logo is a new file, so
      // Flutter's image cache — keyed by file name — cannot keep showing the
      // old one.
      final file = File(p.join(
        dir.path,
        logoPath.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_'),
      ));
      final previous = await _db.getValue(_pathKey(orgId));
      if (previous == logoPath && await file.exists()) return file;

      final client = _client();
      try {
        final req = await client.getUrl(brandingLogoUrl(supabaseUrl, logoPath));
        final res = await req.close();
        if (res.statusCode != 200) {
          await res.drain<void>();
          return null;
        }
        // Written beside the real name and moved over it, so a download cut off
        // half way never leaves a truncated image behind.
        final part = File('${file.path}.part');
        await res.pipe(part.openWrite());
        await part.rename(file.path);
      } finally {
        client.close();
      }
      await _db.setValue(_pathKey(orgId), logoPath);
      // The logo this one replaces is no use to anybody now.
      if (previous != null && previous != logoPath) {
        final old = File(p.join(
          dir.path,
          previous.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_'),
        ));
        if (await old.exists()) await old.delete();
      }
      return file;
    } catch (_) {
      return null;
    }
  }
}
