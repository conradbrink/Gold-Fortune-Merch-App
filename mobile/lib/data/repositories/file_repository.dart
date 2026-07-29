import 'dart:io';

import 'package:drift/drift.dart' show Value;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../local/app_database.dart';

/// Shared documents — planograms, price lists, notices.
///
/// This repository never decides who may see what. `files` carries an RLS
/// policy that does, and the storage bucket's read policy joins to it, so a
/// plain select returns exactly what this rep is entitled to and a signed URL
/// cannot be minted for anything else. If the rules change on the server, the
/// app follows without a release.
class FileRepository {
  FileRepository(this._client, this._db);

  final SupabaseClient _client;
  final AppDatabase _db;

  static const _bucket = 'files';

  /// Refreshes the metadata list, falling back to the cache when offline.
  ///
  /// Only metadata — names and sizes — crosses the wire here. Downloading
  /// every assigned document on a refresh would spend the rep's data without
  /// asking, so the file itself waits for a tap.
  Future<List<CachedFile>> fetchFiles() async {
    try {
      final rows = await _client
          .from('files')
          .select('id, name, description, storage_path, mime_type, size_bytes, updated_at')
          .order('updated_at', ascending: false);

      final now = DateTime.now();
      await _db.replaceCachedFiles([
        for (final r in rows as List)
          CachedFilesCompanion.insert(
            fileId: r['id'] as String,
            name: (r['name'] as String?) ?? 'Untitled',
            description: Value(r['description'] as String?),
            storagePath: r['storage_path'] as String,
            mimeType: Value(r['mime_type'] as String?),
            sizeBytes: Value((r['size_bytes'] as num?)?.toInt()),
            updatedAt: DateTime.tryParse(r['updated_at'] as String? ?? '') ?? now,
            cachedAt: now,
          ),
      ]);

      // A file that vanished from the server — un-shared or deleted — leaves a
      // downloaded copy behind on disk. Clean those up so storage does not grow
      // with documents the rep is no longer meant to have.
      await _pruneOrphanedDownloads();
    } catch (_) {
      // Offline, or the request failed. The cached list is still the rep's
      // best available answer, so fall through to it rather than showing
      // nothing.
    }
    return _db.allCachedFiles();
  }

  /// Downloads one file and remembers where it landed.
  ///
  /// Returns the local path. Throws if the download fails — including when the
  /// rep is no longer entitled, in which case the signed URL is simply refused
  /// by the storage policy.
  Future<String> download(CachedFile file) async {
    final bytes = await _client.storage.from(_bucket).download(file.storagePath);

    final dir = await getApplicationDocumentsDirectory();
    final folder = Directory(p.join(dir.path, 'files'));
    if (!await folder.exists()) await folder.create(recursive: true);

    // Keyed by file id, so re-downloading an updated file replaces the old copy
    // rather than accumulating versions.
    final target = File(p.join(folder.path, '${file.fileId}_${p.basename(file.storagePath)}'));
    await target.writeAsBytes(bytes, flush: true);

    await _db.setLocalPath(file.fileId, target.path);
    return target.path;
  }

  /// True when a previous download is still on disk.
  ///
  /// The recorded path is checked rather than trusted: the OS can reclaim the
  /// documents directory, and offering to open a file that is gone is worse
  /// than offering to fetch it again.
  Future<bool> isDownloaded(CachedFile file) async {
    final path = file.localPath;
    if (path == null) return false;
    if (await File(path).exists()) return true;
    await _db.setLocalPath(file.fileId, null);
    return false;
  }

  Future<void> removeDownload(CachedFile file) async {
    final path = file.localPath;
    if (path != null) {
      final f = File(path);
      if (await f.exists()) await f.delete();
    }
    await _db.setLocalPath(file.fileId, null);
  }

  Future<void> _pruneOrphanedDownloads() async {
    final dir = await getApplicationDocumentsDirectory();
    final folder = Directory(p.join(dir.path, 'files'));
    if (!await folder.exists()) return;

    final keep = {
      for (final f in await _db.allCachedFiles())
        if (f.localPath != null) f.localPath!,
    };

    await for (final entity in folder.list()) {
      if (entity is File && !keep.contains(entity.path)) {
        await entity.delete();
      }
    }
  }
}
