import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:open_filex/open_filex.dart';

import '../../core/providers.dart';
import '../../data/local/app_database.dart';

/// Shared documents the manager has made available to this rep.
///
/// Nothing downloads on its own. The list is metadata the app already has
/// cached, and a file is fetched only when the rep taps it — they are on
/// mobile data, and a planogram that quietly costs them a chunk of their
/// bundle is one they will stop opening. Once fetched it stays on the phone,
/// which is the point: the document is needed in the aisle, where signal is
/// worst.
class FilesScreen extends ConsumerStatefulWidget {
  const FilesScreen({super.key});

  @override
  ConsumerState<FilesScreen> createState() => _FilesScreenState();
}

class _FilesScreenState extends ConsumerState<FilesScreen> {
  /// File ids currently downloading, so each row shows its own spinner.
  final _busy = <String>{};

  String _size(int? bytes) {
    if (bytes == null || bytes <= 0) return '';
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  IconData _icon(String? mime) {
    if (mime == null) return Icons.insert_drive_file_outlined;
    if (mime.startsWith('image/')) return Icons.image_outlined;
    if (mime.contains('pdf')) return Icons.picture_as_pdf_outlined;
    if (mime.contains('sheet') || mime.contains('excel') || mime.contains('csv')) {
      return Icons.table_chart_outlined;
    }
    return Icons.description_outlined;
  }

  Future<void> _openFile(CachedFile file) async {
    final repo = ref.read(fileRepositoryProvider);
    setState(() => _busy.add(file.fileId));
    try {
      var path = file.localPath;
      if (!await repo.isDownloaded(file)) {
        path = await repo.download(file);
      }
      if (path == null) return;

      final result = await OpenFilex.open(path);
      if (result.type != ResultType.done && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open this file: ${result.message}')),
        );
      }
      // Refresh so the row switches from "Tap to download" to "Saved".
      ref.invalidate(filesProvider);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Could not download this file. Check your connection and try again.\n$e',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy.remove(file.fileId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final files = ref.watch(filesProvider);
    final repo = ref.read(fileRepositoryProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Files')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(filesProvider),
        child: files.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(
            children: [
              const SizedBox(height: 80),
              Center(child: Text('Could not load files.\n$e', textAlign: TextAlign.center)),
            ],
          ),
          data: (list) {
            if (list.isEmpty) {
              return ListView(
                children: const [
                  SizedBox(height: 120),
                  Icon(Icons.folder_outlined, size: 48, color: Colors.black26),
                  SizedBox(height: 12),
                  Center(
                    child: Padding(
                      padding: EdgeInsets.symmetric(horizontal: 32),
                      child: Text(
                        'No files have been shared with you yet.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
                ],
              );
            }

            return ListView.separated(
              itemCount: list.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final file = list[i];
                final downloading = _busy.contains(file.fileId);

                return FutureBuilder<bool>(
                  future: repo.isDownloaded(file),
                  builder: (context, snap) {
                    final saved = snap.data ?? false;
                    final size = _size(file.sizeBytes);

                    return ListTile(
                      leading: Icon(_icon(file.mimeType)),
                      title: Text(file.name),
                      subtitle: Text(
                        [
                          if (file.description != null && file.description!.isNotEmpty)
                            file.description!,
                          // Saying the size up front is the whole courtesy of
                          // download-on-tap: the rep decides knowingly.
                          if (saved) 'Saved on this phone' else if (size.isNotEmpty)
                            'Tap to download · $size'
                          else
                            'Tap to download',
                        ].join(' · '),
                      ),
                      trailing: downloading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Icon(
                              saved ? Icons.offline_pin_outlined : Icons.download_outlined,
                              color: saved ? Colors.green.shade600 : null,
                            ),
                      onTap: downloading ? null : () => _openFile(file),
                      onLongPress: saved
                          ? () async {
                              await repo.removeDownload(file);
                              // The guard has to come *before* the ref, not
                              // between the ref and the snackbar: `ref` after
                              // unmount is a StateError in its own right, so the
                              // old order protected the message and not the
                              // thing that actually throws.
                              if (!context.mounted) return;
                              ref.invalidate(filesProvider);
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Removed the copy from this phone.'),
                                ),
                              );
                            }
                          : null,
                    );
                  },
                );
              },
            );
          },
        ),
      ),
    );
  }
}
