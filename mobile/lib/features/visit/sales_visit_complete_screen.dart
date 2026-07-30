import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../data/models/lead.dart';
import '../../data/repositories/lead_repository.dart';

/// What the rep records on the way out of a prospect.
///
/// The call is already durable by the time this screen opens — the start was
/// written and queued — so nothing here can lose it. Leaving without finishing
/// leaves it open, and the chooser offers it back.
class SalesVisitCompleteScreen extends ConsumerStatefulWidget {
  const SalesVisitCompleteScreen({super.key, required this.clientId});

  final String clientId;

  @override
  ConsumerState<SalesVisitCompleteScreen> createState() =>
      _SalesVisitCompleteScreenState();
}

class _SalesVisitCompleteScreenState
    extends ConsumerState<SalesVisitCompleteScreen> {
  final _outcome = TextEditingController();
  final _notes = TextEditingController();

  bool _followUp = false;
  DateTime? _followUpOn;
  bool _saving = false;
  String? _error;
  Lead? _lead;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final lead =
        await ref.read(leadRepositoryProvider).byClientId(widget.clientId);
    if (!mounted) return;
    setState(() {
      _lead = lead;
      _loading = false;
      if (lead != null) {
        _outcome.text = lead.outcome ?? '';
        _notes.text = lead.notes ?? '';
        _followUp = lead.followUpRequired;
        if (lead.followUpOn != null) {
          _followUpOn = DateTime.parse(lead.followUpOn!);
        }
      }
    });
  }

  @override
  void dispose() {
    _outcome.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _followUpOn ?? now.add(const Duration(days: 7)),
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 2),
    );
    // The dialog can outlive this widget — navigating away or backgrounding
    // the app while it is open resumes here with nothing to set state on.
    if (!mounted || picked == null) return;
    setState(() => _followUpOn = picked);
  }

  Future<void> _complete() async {
    final lead = _lead;
    if (lead == null) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(leadRepositoryProvider).complete(
            lead: lead,
            outcome: _outcome.text,
            notes: _notes.text,
            followUpRequired: _followUp,
            followUpOn: _followUpOn == null ? null : localDate(_followUpOn!),
          );
      ref.invalidate(myLeadsProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sales visit recorded.')),
      );
      context.go('/');
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final lead = _lead;
    if (lead == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Sales visit')),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'That visit is no longer on this device.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }

    // A follow-up with no date is a reminder nobody will ever be given.
    final ready = _outcome.text.trim().isNotEmpty &&
        (!_followUp || _followUpOn != null);

    return Scaffold(
      appBar: AppBar(title: Text(lead.companyName)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(lead.purpose),
                  if (lead.contactName != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      lead.contactName!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                  const SizedBox(height: 4),
                  Text(
                    lead.startLat != null
                        ? 'Started ${TimeOfDay.fromDateTime(lead.startedAt).format(context)} · position recorded'
                        : 'Started ${TimeOfDay.fromDateTime(lead.startedAt).format(context)} · no position',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),

          TextField(
            controller: _outcome,
            textCapitalization: TextCapitalization.sentences,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'Outcome',
              hintText: 'e.g. Buyer wants a price list before deciding',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _notes,
            textCapitalization: TextCapitalization.sentences,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Notes (optional)',
              hintText: 'Anything the office should know',
            ),
          ),
          const SizedBox(height: 8),

          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Follow-up required'),
            value: _followUp,
            onChanged: (v) => setState(() {
              _followUp = v;
              // Clearing the date with the switch keeps this in step with the
              // server, which refuses a follow-up date without the flag.
              if (!v) _followUpOn = null;
            }),
          ),
          if (_followUp)
            OutlinedButton.icon(
              onPressed: _pickDate,
              icon: const Icon(Icons.event_outlined),
              label: Text(
                _followUpOn == null
                    ? 'Pick a follow-up date'
                    : 'Follow up on ${localDate(_followUpOn!)}',
              ),
            ),

          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _saving || !ready ? null : _complete,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check),
            label: Text(_saving ? 'Saving…' : 'Complete visit'),
          ),
          const SizedBox(height: 8),
          Text(
            'Leaving without completing keeps the visit open — it will be waiting '
            'for you under Unscheduled visit.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
