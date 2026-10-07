import 'dart:ui' show Color;

/// The product's own identity, for the one place the app cannot yet know whose
/// it is: the login screen of a phone that has never signed in. Everywhere
/// else the company's name, logo and colours take over (see `Branding`).
const kProductName = 'Tickd';

/// The Tickd double-tick mark shown beside [kProductName]. Generated from the
/// logo's geometry, not drawn by hand: see `tool/make_product_mark.py`.
const kProductMarkAsset = 'assets/product_mark.png';

/// The product palette, for a company that has not chosen its own colours and
/// for the login screen before anyone has signed in. Mirrors the web's.
const kProductPrimary = Color(0xFF0F3D3E); // Tickd teal
const kProductAccent = Color(0xFFF5A524); // Tickd amber
