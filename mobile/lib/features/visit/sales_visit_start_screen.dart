import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/company_config.dart';
import '../../core/providers.dart';

/// What the rep records on the way in to a prospect.
///
/// Only two fields are required, and that is deliberate: this is filled in
/// standing outside a shop, often one-handed. Everything else — the contact,
/// the outcome, the follow-up — is either optional or asked for on the way out,
/// when there is something to say.
class SalesVisitStartScreen extends ConsumerStatefulWidget {
  const SalesVisitStartScreen({super.key});

  @override
  ConsumerState<SalesVisitStartScreen> createState() =>
      _SalesVisitStartScreenState();
}

class _SalesVisitStartScreenState extends ConsumerState<SalesVisitStartScreen> {
  final _company = TextEditingController();
  final _purpose = TextEditingController();
  final _contact = TextEditingController();
  final _phone = TextEditingController();

  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _company.dispose();
    _purpose.dispose();
    _contact.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) {
      setState(() => _error =
          'Your profile has not loaded yet. Try again in a moment.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final lead = await ref.read(leadRepositoryProvider).start(
            orgId: profile.orgId,
            repId: profile.id,
            companyName: _company.text,
            purpose: _purpose.text,
            contactName: _contact.text,
            contactPhone: _phone.text,
          );
      ref.invalidate(myLeadsProvider);
      // The widget can be gone by now — the position lookup takes a moment and
      // the rep may have backed out of it.
      if (!mounted) return;
      context.go('/unscheduled/sales/${lead.clientGeneratedId}');
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = _company.text.trim().isNotEmpty && _purpose.text.trim().isNotEmpty;
    final t = ref.watch(termsProvider);
    final job = t.job.oneLower;

    return Scaffold(
      appBar: AppBar(title: Text('Sales $job')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          TextField(
            controller: _company,
            textCapitalization: TextCapitalization.words,
            // Examples that belong to no particular company or country: the
            // same app is used by companies that sell very different things.
            decoration: InputDecoration(
              labelText: 'Company or ${t.site.oneLower}',
              hintText: 'e.g. Riverside Traders',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _purpose,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              labelText: 'Purpose of the $job',
              hintText: 'e.g. Introduce our new range',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _contact,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Contact person (optional)',
              hintText: 'Who you spoke to',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'Contact number (optional)',
              hintText: 'Mobile or landline',
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _saving || !ready ? null : _start,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.play_arrow),
            label: Text(_saving ? 'Starting…' : 'Start $job'),
          ),
          const SizedBox(height: 8),
          Text(
            'Your position and the time are recorded when the $job starts, '
            'and cannot be changed afterwards. It works with no signal — the '
            '$job syncs when you are back in coverage.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
