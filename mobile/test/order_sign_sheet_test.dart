// Every order is signed for by the shop's manager before it is saved (owner,
// 27 Oct 2026). The sheet will not hand back a signature without ink and a
// name, and what it hands back is a picture.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/core/company_config.dart';
import 'package:gf_merch_rep/core/terms.dart';
import 'package:gf_merch_rep/features/orders/order_sign_sheet.dart';
import 'package:gf_merch_rep/shared/widgets/signature_pad.dart';

void main() {
  Future<List<OrderSignature?>> open(WidgetTester tester, {String? signer}) async {
    final results = <OrderSignature?>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [termsProvider.overrideWithValue(Terms.defaults)],
        child: MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async => results.add(
                  await showOrderSignSheet(
                    context,
                    lineCount: 3,
                    storeName: 'Main Road Superette',
                    signerName: signer,
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return results;
  }

  FilledButton save(WidgetTester tester) =>
      tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Signed. Save the order'));

  testWidgets('no ink, no save; a tap is not a signature', (tester) async {
    await open(tester, signer: 'Thabo');
    expect(save(tester).onPressed, isNull);
    await tester.tap(find.byType(SignaturePad));
    await tester.pump();
    expect(save(tester).onPressed, isNull);
  });

  testWidgets('a name is needed beside the signature', (tester) async {
    await open(tester);
    await tester.drag(find.byType(SignaturePad), const Offset(150, 40));
    await tester.pump();
    expect(save(tester).onPressed, isNull);
    await tester.enterText(find.byType(TextField), 'Thabo Manager');
    await tester.pump();
    expect(save(tester).onPressed, isNotNull);
  });

  testWidgets('signed and named, it hands back a PNG and the name', (tester) async {
    final results = await open(tester, signer: 'Who placed it');
    await tester.drag(find.byType(SignaturePad), const Offset(150, 40));
    await tester.pump();
    await tester.runAsync(() async {
      await tester.tap(find.widgetWithText(FilledButton, 'Signed. Save the order'));
      // toPng renders off the test clock.
      for (var i = 0; i < 20 && results.isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
        await tester.pump();
      }
    });
    await tester.pumpAndSettle();
    expect(results, hasLength(1));
    final sig = results.single!;
    expect(sig.name, 'Who placed it');
    expect(sig.png.sublist(0, 4), [0x89, 0x50, 0x4e, 0x47], reason: 'PNG signature bytes');
  });

  testWidgets('closing it hands back nothing, so the order stays a draft', (tester) async {
    final results = await open(tester, signer: 'Thabo');
    await tester.tap(find.byTooltip('Back to the order'));
    await tester.pumpAndSettle();
    expect(results, [null]);
  });

  testWidgets('a downward stroke on a small screen draws, and does not scroll the sheet', (tester) async {
    // Small enough that the sheet's content overflows and can scroll: a
    // plain pan would lose a mostly vertical stroke to the scroll view.
    tester.view.physicalSize = const Size(320, 420);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await open(tester, signer: 'Thabo');
    final pad = find.byType(SignaturePad);
    await tester.ensureVisible(pad);
    await tester.pumpAndSettle();
    final scrollable = tester.state<ScrollableState>(find.byType(Scrollable).last);
    final before = scrollable.position.pixels;

    final gesture = await tester.startGesture(tester.getCenter(pad) - const Offset(0, 60));
    for (var i = 0; i < 12; i++) {
      await gesture.moveBy(const Offset(1, 10));
      await tester.pump();
    }
    await gesture.up();
    await tester.pump();

    expect(scrollable.position.pixels, before, reason: 'the stroke is the pad\'s, not the scroll view\'s');
    expect(save(tester).onPressed, isNotNull, reason: 'a 120 px stroke counts as signed');
  });
}
