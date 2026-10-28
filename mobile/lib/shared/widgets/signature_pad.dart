import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// What has been drawn on a [SignaturePad], and the picture of it.
///
/// Strokes are kept in the pad's own coordinates and drawn again into the
/// picture, rather than the screen being captured: the picture then has a
/// white background and black ink whatever the theme, which is what a
/// signature on an order page or a printout has to look like.
class SignaturePadController extends ChangeNotifier {
  final List<List<Offset>> _strokes = [];
  Size _size = Size.zero;

  List<List<Offset>> get strokes => _strokes;

  /// Enough ink to count as a signature, not a stray tap: a dot or a short
  /// flick is what a thumb leaves by accident.
  bool get isSigned {
    var length = 0.0;
    for (final s in _strokes) {
      for (var i = 1; i < s.length; i++) {
        length += (s[i] - s[i - 1]).distance;
        if (length >= 60) return true;
      }
    }
    return false;
  }

  void _start(Offset p) {
    _strokes.add([p]);
    notifyListeners();
  }

  void _extend(Offset p) {
    if (_strokes.isEmpty) return;
    _strokes.last.add(p);
    notifyListeners();
  }

  void clear() {
    _strokes.clear();
    notifyListeners();
  }

  /// The signature as a PNG, black on white, at the pad's size times
  /// [pixelRatio]. Null when nothing has been drawn.
  Future<Uint8List?> toPng({double pixelRatio = 2}) async {
    if (_strokes.isEmpty || _size.isEmpty) return null;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(pixelRatio);
    canvas.drawRect(Offset.zero & _size, Paint()..color = Colors.white);
    _SignaturePainter.paintStrokes(canvas, _strokes, Colors.black);
    final image = await recorder.endRecording().toImage(
          (_size.width * pixelRatio).round(),
          (_size.height * pixelRatio).round(),
        );
    try {
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      return bytes?.buffer.asUint8List();
    } finally {
      image.dispose();
    }
  }
}

/// A box to sign in with a finger.
class SignaturePad extends StatelessWidget {
  const SignaturePad({super.key, required this.controller, this.height = 180});

  final SignaturePadController controller;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: LayoutBuilder(
        builder: (context, box) {
          controller._size = box.biggest;
          return RawGestureDetector(
            // Claimed the moment a finger lands. A plain pan loses a mostly
            // downward stroke to the scrolling sheet around it (a pan's slop
            // is twice a vertical drag's), and the stroke stops short.
            gestures: {
              _EagerPan: GestureRecognizerFactoryWithHandlers<_EagerPan>(
                _EagerPan.new,
                (r) {
                  r.onDown = (d) => controller._start(d.localPosition);
                  r.onUpdate = (d) => controller._extend(d.localPosition);
                },
              ),
            },
            child: ListenableBuilder(
              listenable: controller,
              builder: (context, _) => CustomPaint(
                size: box.biggest,
                painter: _SignaturePainter(controller.strokes),
                child: controller.strokes.isEmpty
                    ? const Center(
                        child: Text(
                          'Sign here',
                          style: TextStyle(color: AppColors.textMuted, fontSize: 16),
                        ),
                      )
                    : null,
              ),
            ),
          );
        },
      ),
    );
  }
}

/// A pan that wins the gesture arena on touch-down instead of after it has
/// moved, so nothing around the pad can take the stroke.
class _EagerPan extends PanGestureRecognizer {
  @override
  void addAllowedPointer(PointerDownEvent event) {
    super.addAllowedPointer(event);
    resolve(GestureDisposition.accepted);
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter(this.strokes);

  final List<List<Offset>> strokes;

  static void paintStrokes(Canvas canvas, List<List<Offset>> strokes, Color ink) {
    final paint = Paint()
      ..color = ink
      ..strokeWidth = 2.6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final s in strokes) {
      if (s.length == 1) {
        canvas.drawCircle(s.first, 1.3, paint..style = PaintingStyle.fill);
        paint.style = PaintingStyle.stroke;
        continue;
      }
      final path = Path()..moveTo(s.first.dx, s.first.dy);
      for (final p in s.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  void paint(Canvas canvas, Size size) => paintStrokes(canvas, strokes, Colors.black);

  // The strokes are the controller's own lists, changed in place, so a
  // repaint cannot be decided by comparing them; the ListenableBuilder above
  // rebuilds only when something was drawn.
  @override
  bool shouldRepaint(_SignaturePainter oldDelegate) => true;
}
