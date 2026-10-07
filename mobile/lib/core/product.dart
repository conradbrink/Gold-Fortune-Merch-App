import 'dart:ui' show Color;

/// The product's own identity, for the one place the app cannot yet know whose
/// it is: the login screen of a phone that has never signed in. Everywhere
/// else the company's name, logo and colours take over (see `Branding`).
const kProductName = 'Field Teams';

/// The neutral mark shown beside [kProductName]. Generated, not drawn: see
/// `tool/make_product_mark.py`.
const kProductMarkAsset = 'assets/product_mark.png';

/// The product palette, for a company that has not chosen its own colours and
/// for the login screen before anyone has signed in. Mirrors the web's.
const kProductPrimary = Color(0xFF1E293B);
const kProductAccent = Color(0xFF0EA5A4);
