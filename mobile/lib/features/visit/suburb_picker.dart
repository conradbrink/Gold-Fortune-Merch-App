import 'package:flutter/material.dart';

import '../../core/terms.dart' show title;
import '../../data/models/store_summary.dart';
import '../../data/repositories/route_repository.dart' show tidySpaces;

/// A place name as letters and digits only, in small letters: "Mitchell's
/// Plain", "MITCHELLS PLAIN" and "mitchellsplain" are the same place. The
/// rule `store_add_from_phone()` matches a town with.
String placeKey(String text) =>
    text.toLowerCase().replaceAll(RegExp(r'[^\p{L}\p{N}]', unicode: true), '');

/// The suburbs a rep can pick for a new customer: the towns of the company's
/// customers that the office has placed in an area, each once, A–Z.
///
/// Owner, 31 Oct 2026: reps typed the town ("MITCHELL S PLAIN WESTRIDGE",
/// "TABLEVIEW"), so every customer they added had a town the office had to
/// tidy and no area, and was missing from area-based planning. A town picked
/// from these is one the server knows, and it gives the customer the area most
/// of that suburb's customers are in.
///
/// Spelled the way most of those customers have it.
List<String> companySuburbs(Iterable<StoreSummary> stores) {
  final counts = <String, Map<String, int>>{};
  for (final s in stores) {
    final city = s.city == null ? '' : tidySpaces(s.city!);
    if (s.territoryId == null || city.isEmpty) continue;
    final key = placeKey(city);
    if (key.isEmpty) continue;
    final spellings = counts.putIfAbsent(key, () => {});
    spellings[city] = (spellings[city] ?? 0) + 1;
  }
  final suburbs = [
    for (final spellings in counts.values)
      (spellings.entries.toList()
            ..sort((a, b) {
              final byCount = b.value.compareTo(a.value);
              return byCount != 0 ? byCount : a.key.compareTo(b.key);
            }))
          .first
          .key,
  ];
  suburbs.sort((a, b) {
    final byName = a.toLowerCase().compareTo(b.toLowerCase());
    return byName != 0 ? byName : a.compareTo(b);
  });
  return suburbs;
}

/// What the rep typed beside [suburb]: the words of [typed] left once the
/// whole words that spell the suburb are taken out ("Westridge" from
/// "Mitchell S PLAIN WESTRIDGE"), or null when no run of whole words spells
/// it. Empty when the words spell the suburb and nothing else.
String? wordsBeside(String typed, String suburb) {
  final target = placeKey(suburb);
  if (target.isEmpty) return null;
  final words = typed
      .split(RegExp(r'[\s,/]+'))
      .where((w) => placeKey(w).isNotEmpty)
      .toList();
  for (var i = 0; i < words.length; i++) {
    var run = '';
    for (var j = i; j < words.length; j++) {
      run += placeKey(words[j]);
      if (run == target) {
        return [...words.sublist(0, i), ...words.sublist(j + 1)].join(' ');
      }
      if (run.length >= target.length) break;
    }
  }
  return null;
}

/// The suburbs [search] could mean, best first: the same name, then a suburb
/// spelled out among the words typed, then names that start with it, then
/// names that have it inside. Empty search: all of them.
List<String> suburbsMatching(List<String> suburbs, String search) {
  final want = placeKey(search);
  if (want.isEmpty) return suburbs;
  int? rank(String suburb) {
    final key = placeKey(suburb);
    if (key == want) return 0;
    if (wordsBeside(search, suburb) != null) return 1;
    if (key.startsWith(want)) return 2;
    if (key.contains(want)) return 3;
    return null;
  }

  final ranked = <({String suburb, int rank, int order})>[];
  for (var i = 0; i < suburbs.length; i++) {
    final r = rank(suburbs[i]);
    if (r != null) ranked.add((suburb: suburbs[i], rank: r, order: i));
  }
  ranked.sort((a, b) => a.rank != b.rank ? a.rank - b.rank : a.order - b.order);
  return [for (final r in ranked) r.suburb];
}

/// The part of town the rep typed beside the suburb, tidied for the address:
/// "WESTRIDGE" and "westridge" become "Westridge"; a mix of capitals is kept.
String partOfTown(String words) {
  final tidy = tidySpaces(words);
  if (tidy != tidy.toUpperCase() && tidy != tidy.toLowerCase()) return tidy;
  return title(tidy.toLowerCase());
}

/// [address] with [part] on the end, unless it says so already.
String addressWith(String address, String part) {
  final tidy = address.trim();
  if (part.isEmpty || tidy.toLowerCase().contains(part.toLowerCase())) return address;
  return tidy.isEmpty ? part : '$tidy, $part';
}

/// [address] without [part] on the end, as [addressWith] put it there.
String addressWithout(String address, String part) {
  if (part.isEmpty) return address;
  final tidy = address.trimRight();
  if (tidy == part) return '';
  return tidy.endsWith(', $part') ? tidy.substring(0, tidy.length - part.length - 2) : address;
}

/// What the rep chose: a suburb from the list ([fromList]) or a town typed in
/// that is not on it, and the part of town typed beside the suburb, for the
/// address.
class SuburbChoice {
  const SuburbChoice(this.town, {required this.fromList, this.partOfTown = ''});

  final String town;
  final bool fromList;
  final String partOfTown;
}

/// The company's suburbs to search and pick from, with what the rep typed
/// still allowed for a suburb that is not on the list yet.
Future<SuburbChoice?> pickSuburb(BuildContext context, List<String> suburbs) {
  return showModalBottomSheet<SuburbChoice>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _SuburbPicker(suburbs: suburbs),
  );
}

class _SuburbPicker extends StatefulWidget {
  const _SuburbPicker({required this.suburbs});

  final List<String> suburbs;

  @override
  State<_SuburbPicker> createState() => _SuburbPickerState();
}

class _SuburbPickerState extends State<_SuburbPicker> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final typed = tidySpaces(_search.text);
    final shown = suburbsMatching(widget.suburbs, typed);
    final exact = shown.isNotEmpty && placeKey(shown.first) == placeKey(typed);
    final small = Theme.of(context).textTheme.bodySmall;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.8,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                controller: _search,
                autofocus: true,
                textCapitalization: TextCapitalization.words,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search suburbs',
                ),
              ),
            ),
            Expanded(
              child: ListView(
                children: [
                  if (typed.isNotEmpty && shown.isEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                      child: Text(
                        'No suburb on your list matches “$typed”. If it is part '
                        'of a bigger suburb, search for that one and put '
                        '“$typed” in the address.',
                        style: small,
                      ),
                    ),
                  for (final suburb in shown)
                    _SuburbTile(suburb: suburb, typed: typed),
                  if (typed.isNotEmpty && !exact)
                    ListTile(
                      leading: const Icon(Icons.edit_outlined),
                      title: Text('Use “$typed”'),
                      subtitle: const Text('Not on the list'),
                      onTap: () => Navigator.pop(
                        context,
                        SuburbChoice(typed, fromList: false),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SuburbTile extends StatelessWidget {
  const _SuburbTile({required this.suburb, required this.typed});

  final String suburb;
  final String typed;

  @override
  Widget build(BuildContext context) {
    final beside = wordsBeside(typed, suburb);
    final part = beside == null || beside.isEmpty ? '' : partOfTown(beside);
    return ListTile(
      title: Text(suburb),
      subtitle: part.isEmpty ? null : Text('Adds $part to the address'),
      onTap: () => Navigator.pop(
        context,
        SuburbChoice(suburb, fromList: true, partOfTown: part),
      ),
    );
  }
}
