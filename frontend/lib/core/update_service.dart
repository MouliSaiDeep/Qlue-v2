import 'dart:io';

import 'package:dio/dio.dart';
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

/// Details of a newer release found on GitHub.
class UpdateInfo {
  final String version; // normalized, e.g. "1.0.4"
  final String downloadUrl; // browser_download_url of Qlue.apk
  final String releaseNotes; // release body (may be empty)
  final int sizeBytes; // apk asset size, 0 if unknown

  const UpdateInfo({
    required this.version,
    required this.downloadUrl,
    required this.releaseNotes,
    required this.sizeBytes,
  });
}

/// Outcome of handing the downloaded APK to the OS installer.
enum InstallOutcome { launched, permissionDenied, failed }

/// Self-update against the app's own public GitHub Releases.
///
/// The app is distributed as an APK outside the Play Store, so updates are
/// checked and installed manually: read the latest release, compare its tag to
/// the running [PackageInfo.version], download the `Qlue.apk` asset, and hand
/// it to the Android package installer. Android still shows the system install
/// prompt — a normal (non-system) app cannot install silently.
class UpdateService {
  // The update source is the app's own public repo; there is nothing secret
  // here, so it is a constant rather than an env value.
  static const String _owner = 'MouliSaiDeep';
  static const String _repo = 'Qlue-v2';
  static const String _apkAssetName = 'qlue.apk'; // compared case-insensitively

  final Dio _dio;

  UpdateService([Dio? dio]) : _dio = dio ?? Dio();

  /// Returns [UpdateInfo] when the latest release is newer than the running
  /// build, otherwise null. Throws on network/parse failure so the caller can
  /// surface a "couldn't check" message.
  Future<UpdateInfo?> checkForUpdate() async {
    final info = await PackageInfo.fromPlatform();

    final res = await _dio.get(
      'https://api.github.com/repos/$_owner/$_repo/releases/latest',
      options: Options(
        headers: {
          'Accept': 'application/vnd.github+json',
          // GitHub's API rejects requests without a User-Agent.
          'User-Agent': 'Qlue-App',
        },
      ),
    );

    final data = res.data as Map<String, dynamic>;
    final latest = _normalize((data['tag_name'] as String?) ?? '');
    if (latest.isEmpty || !_isNewer(latest, _normalize(info.version))) {
      return null;
    }

    final assets = (data['assets'] as List?) ?? const [];
    Map<String, dynamic>? apk;
    for (final a in assets) {
      final m = a as Map<String, dynamic>;
      if ((m['name'] as String?)?.toLowerCase() == _apkAssetName) {
        apk = m;
        break;
      }
    }
    final url = apk?['browser_download_url'] as String?;
    if (url == null) return null; // release exists but has no installable APK

    return UpdateInfo(
      version: latest,
      downloadUrl: url,
      releaseNotes: ((data['body'] as String?) ?? '').trim(),
      sizeBytes: (apk?['size'] as int?) ?? 0,
    );
  }

  /// Downloads the APK to a private cache dir, returning its local path.
  Future<String> downloadApk(
    String url, {
    void Function(int received, int total)? onProgress,
  }) async {
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/Qlue-update.apk';
    final existing = File(path);
    if (await existing.exists()) {
      await existing.delete(); // never install a stale/partial file
    }
    await _dio.download(url, path, onReceiveProgress: onProgress);
    return path;
  }

  /// Opens the downloaded APK with the system package installer.
  Future<InstallOutcome> installApk(String path) async {
    final result = await OpenFilex.open(
      path,
      type: 'application/vnd.android.package-archive',
    );
    switch (result.type) {
      case ResultType.done:
        return InstallOutcome.launched;
      case ResultType.permissionDenied:
        return InstallOutcome.permissionDenied;
      default:
        return InstallOutcome.failed;
    }
  }

  /// Strips a leading `v` and any pre-release/build suffix: `v1.2.3-rc+7` -> `1.2.3`.
  String _normalize(String v) {
    var s = v.trim();
    if (s.startsWith('v') || s.startsWith('V')) s = s.substring(1);
    return s.split('+').first.split('-').first;
  }

  /// Numeric dotted-version compare: is [latest] strictly greater than [current]?
  bool _isNewer(String latest, String current) {
    final a = latest.split('.');
    final b = current.split('.');
    final len = a.length > b.length ? a.length : b.length;
    for (var i = 0; i < len; i++) {
      final x = i < a.length ? (int.tryParse(a[i]) ?? 0) : 0;
      final y = i < b.length ? (int.tryParse(b[i]) ?? 0) : 0;
      if (x != y) return x > y;
    }
    return false;
  }
}
