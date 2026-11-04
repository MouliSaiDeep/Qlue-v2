import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import '../core/models/resume_model.dart';
import '../core/services/resume_api_service.dart';

class ResumeProvider extends ChangeNotifier {
  bool _disposed = false;
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  ResumeProvider({ResumeApiService? apiService})
    : _apiService = apiService ?? ResumeApiService();

  final ResumeApiService _apiService;
  Future<void>? _listRequest;
  final _detailRequests = <String, Future<ResumeModel?>>{};
  int _readEpoch = 0;
  int _loadingOperations = 0;

  List<ResumeModel> _resumes = [];
  List<ResumeModel> get resumes => _resumes;

  ResumeModel? _activeResume;
  ResumeModel? get activeResume => _activeResume;

  bool _isLoading = false;
  bool get isLoading => _isLoading;

  String? _error;
  String? get error => _error;

  int _maxAllowed = 5;
  int get maxAllowed => _maxAllowed;

  final Map<String, Timer> _pollingTimers = {};

  // Do not call fetchResumes in the constructor, we will do it when the user is authenticated.
  // The app flow usually handles fetching user-specific data on login.
  // For now, we'll let the UI call it on init.

  void _setLoading(bool value) {
    if (_disposed) return;
    _loadingOperations += value ? 1 : -1;
    assert(_loadingOperations >= 0);
    _isLoading = _loadingOperations > 0;
    notifyListeners();
  }

  void _setError(String? value) {
    if (_disposed) return;
    _error = value;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (var timer in _pollingTimers.values) {
      timer.cancel();
    }
    super.dispose();
  }

  Future<void> fetchResumes() {
    if (_disposed) return Future.value();
    final pending = _listRequest;
    if (pending != null) return pending;
    final completion = Completer<void>();
    _listRequest = completion.future;
    unawaited(
      _fetchResumes(
        _readEpoch,
      ).then(completion.complete, onError: completion.completeError),
    );
    return completion.future;
  }

  Future<void> _fetchResumes(int epoch) async {
    try {
      _setLoading(true);
      _setError(null);
      if (_disposed) return;
      final data = await _apiService.getResumeList();
      if (_disposed || epoch != _readEpoch) return;
      _resumes = data['resumes'] as List<ResumeModel>;
      _maxAllowed = data['maxAllowed'] as int;

      try {
        _activeResume = _resumes.firstWhere((r) => r.isActive);
      } catch (e) {
        _activeResume = null;
      }

      // A refresh may already contain a terminal or deleted record. Stop its
      // old timer before it can issue another detail request.
      final parsing = _resumes
          .where((r) => r.status == ResumeStatus.parsing)
          .map((r) => r.resumeId)
          .toSet();
      for (final id in _pollingTimers.keys.toList()) {
        if (!parsing.contains(id)) _pollingTimers.remove(id)?.cancel();
      }
      // Start polling for any resumes that are in parsing state
      for (var resume in _resumes) {
        if (resume.status == ResumeStatus.parsing) {
          _startPolling(resume.resumeId);
        }
      }
    } catch (e) {
      if (!_disposed && epoch == _readEpoch) _setError(e.toString());
    } finally {
      _listRequest = null;
      if (!_disposed) _setLoading(false);
    }
  }

  Future<ResumeModel?> fetchResumeDetail(String resumeId) {
    if (_disposed) return Future.value();
    final pending = _detailRequests[resumeId];
    if (pending != null) return pending;
    final completion = Completer<ResumeModel?>();
    _detailRequests[resumeId] = completion.future;
    unawaited(
      _fetchResumeDetail(
        resumeId,
        _readEpoch,
        _resumes,
        completion.future,
      ).then(completion.complete, onError: completion.completeError),
    );
    return completion.future;
  }

  ResumeModel? _cachedResume(String resumeId) {
    for (final resume in _resumes) {
      if (resume.resumeId == resumeId) return resume;
    }
    return null;
  }

  Future<ResumeModel?> _fetchResumeDetail(
    String resumeId,
    int epoch,
    List<ResumeModel> snapshot,
    Future<ResumeModel?> request,
  ) async {
    try {
      _setError(null);
      if (_disposed) return null;
      final resume = await _apiService.getResumeDetail(resumeId);
      if (_disposed) return null;
      // A list refresh or successful mutation supersedes this read. Return
      // current state to an existing poller without applying the old response.
      if (epoch != _readEpoch || !identical(snapshot, _resumes)) {
        return _cachedResume(resumeId);
      }
      final index = _resumes.indexWhere((r) => r.resumeId == resumeId);
      if (index != -1) {
        _resumes[index] = resume;
        notifyListeners();
      }
      return resume;
    } catch (e) {
      if (_disposed) return null;
      if (epoch != _readEpoch || !identical(snapshot, _resumes)) {
        return _cachedResume(resumeId);
      }
      _setError(e.toString());
      return null;
    } finally {
      // A post-mutation read may already own this key.
      if (identical(_detailRequests[resumeId], request)) {
        _detailRequests.remove(resumeId);
      }
    }
  }

  Future<bool> uploadResume(dynamic fileOrBytes, String fileName) async {
    if (_disposed) return false;
    try {
      _setLoading(true);
      _setError(null);

      Uint8List bytes;
      if (fileOrBytes is Uint8List) {
        bytes = fileOrBytes;
      } else if (fileOrBytes is String) {
        final file = File(fileOrBytes);
        if (!await file.exists()) {
          throw Exception("File not found at path: $fileOrBytes");
        }
        bytes = await file.readAsBytes();
      } else {
        bytes = await (fileOrBytes as dynamic).readAsBytes();
      }
      if (_disposed) return false;
      final digest = sha256.convert(bytes);
      final hashStr = digest.toString();

      final validation = await _apiService.validateResumeHash(hashStr);
      if (_disposed) return false;
      if (validation['isDuplicate'] == true) {
        _setError(
          "Duplicate file detected. This resume has already been uploaded.",
        );
        return false;
      }

      // 2. Presigned URL
      final fileSize = bytes.length;
      final urlData = await _apiService.generatePresignedUrl(
        fileName: fileName,
        fileSize: fileSize,
        fileHash: hashStr,
      );
      if (_disposed) return false;

      final uploadUrl = urlData['uploadUrl'];
      final resumeId = urlData['resumeId'];

      // 3. S3 PUT — send raw bytes with strict headers matching the signature.
      // We use Uri.parse to ensure Dio doesn't re-encode the already signed URL.
      final s3Dio = Dio();
      try {
        final response = await s3Dio.putUri(
          Uri.parse(uploadUrl),
          data: bytes,
          options: Options(
            // must match exactly what was signed in backend
            headers: {'Content-Type': 'application/pdf'},
            validateStatus: (status) => status != null && status < 400,
          ),
        );
        if (response.statusCode != null && response.statusCode! >= 400) {
          throw Exception("S3 Upload returned ${response.statusCode}");
        }
      } on DioException catch (de) {
        final statusCode = de.response?.statusCode;
        final body =
            de.response?.data?.toString() ?? de.message ?? 'Unknown error';
        throw Exception("S3 Upload Failed ($statusCode): $body");
      } finally {
        s3Dio.close(force: true);
      }
      if (_disposed) return false;

      // 4. Trigger Processing — backend responds 202 immediately,
      //    then parses asynchronously. Frontend polls via _startPolling().
      await _apiService.processResumeUpload(resumeId);
      if (_disposed) return false;

      // Reload resumes (will show PARSING status)
      await _refreshAfterMutation();

      // Start polling this resume's status
      _startPolling(resumeId);

      return true;
    } catch (e) {
      _setError(e.toString());
      return false;
    } finally {
      _setLoading(false);
    }
  }

  Future<void> deleteResume(String resumeId) async {
    if (_disposed) return;
    try {
      _setLoading(true);
      _setError(null);
      if (_disposed) return;
      await _apiService.deleteResume(resumeId);
      if (_pollingTimers.containsKey(resumeId)) {
        _pollingTimers[resumeId]?.cancel();
        _pollingTimers.remove(resumeId);
      }
      await _refreshAfterMutation();
    } catch (e) {
      _setError(e.toString());
    } finally {
      _setLoading(false);
    }
  }

  Future<void> setActiveResume(String resumeId) async {
    if (_disposed) return;
    try {
      _setLoading(true);
      _setError(null);
      if (_disposed) return;
      await _apiService.setActiveResume(resumeId);
      await _refreshAfterMutation();
    } catch (e) {
      _setError(e.toString());
    } finally {
      _setLoading(false);
    }
  }

  Future<void> _refreshAfterMutation() async {
    if (_disposed) return;
    ++_readEpoch;
    _detailRequests.clear();
    // A read started before a successful write cannot acknowledge that write.
    // Let it finish, then fetch fresh state instead of joining a stale read.
    await _listRequest;
    if (!_disposed) await fetchResumes();
  }

  void _startPolling(String resumeId) {
    if (_disposed || _pollingTimers.containsKey(resumeId)) return;

    _pollingTimers[resumeId] = Timer.periodic(const Duration(seconds: 2), (
      timer,
    ) async {
      final resume = await fetchResumeDetail(resumeId);
      // Several ticks can await the same slow read. Only the still-current
      // timer may react to completion and refresh the list once.
      if (_disposed || !identical(_pollingTimers[resumeId], timer)) return;
      if (resume != null) {
        if (resume.status == ResumeStatus.parsed ||
            resume.status == ResumeStatus.failed) {
          timer.cancel();
          _pollingTimers.remove(resumeId);
          await fetchResumes();
        }
      } else {
        timer.cancel();
        _pollingTimers.remove(resumeId);
      }
    });
  }
}
