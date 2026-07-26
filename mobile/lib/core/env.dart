// Public Supabase project config. The anon/publishable key is safe to embed
// in client code (mirrors what the web dashboard uses) — real access control
// is enforced entirely by Postgres RLS, not by keeping this secret.
class Env {
  static const supabaseUrl = 'https://bvbgtsxasttjzlemumwy.supabase.co';
  static const supabasePublishableKey =
      'sb_publishable_ul9dGypnoGkwgddxEBVBYQ_Tlao-Lej';
}
