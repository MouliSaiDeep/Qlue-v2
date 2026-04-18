import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/models/resume_model.dart';
import '../core/services/resume_api_service.dart';

class ResumeProvider extends ChangeNotifier {
  final ResumeApiService _apiService = ResumeApiService();
  
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
    _isLoading = value;
    notifyListeners();
  }

  void _setError(String? value) {
    _error = value;
    notifyListeners();
  }

  @override
  void dispose() {
    for (var timer in _pollingTimers.values) {
      timer.cancel();
    }
    super.dispose();
  }

  Future<void> fetchResumes() async {
    try {
      _setLoading(true);
      _setError(null);
      final data = await _apiService.getResumeList();
      _resumes = data['resumes'] as List<ResumeModel>;
      _maxAllowed = data['maxAllowed'] as int;
      
      try {
        _activeResume = _resumes.firstWhere((r) => r.isActive);
      } catch (e) {
        _activeResume = null;
      }
      
      // Start polling for any resumes that are in parsing state
      for (var resume in _resumes) {
        if (resume.status == ResumeStatus.parsing) {
          _startPolling(resume.resumeId);
        }
      }
    } catch (e) {
      _setError(e.toString());
    } finally {
      _setLoading(false);
    }
  }

  Future<ResumeModel?> fetchResumeDetail(String resumeId) async {
    try {
      _setError(null);
      final resume = await _apiService.getResumeDetail(resumeId);
      final index = _resumes.indexWhere((r) => r.resumeId == resumeId);
      if (index != -1) {
        _resumes[index] = resume;
        notifyListeners();
      }
      return resume;
    } catch (e) {
      _setError(e.toString());
      return null;
    }
  }

  Future<bool> uploadResume(dynamic fileOrBytes, String fileName) async {
    try {
      _setLoading(true);
      _setError(null);
      
      Uint8List bytes;
      if (fileOrBytes is Uint8List) {
        bytes = fileOrBytes;
      } else {
        // Assume it's a File-like object with readAsBytes
        bytes = await (fileOrBytes as dynamic).readAsBytes();
      }
      final digest = sha256.convert(bytes);
      final hashStr = digest.toString();
      
      final validation = await _apiService.validateResumeHash(hashStr);
      if (validation['isDuplicate'] == true) {
        _setError("Duplicate file detected. This resume has already been uploaded.");
        return false;
      }

      // 2. Presigned URL
      final fileSize = bytes.length;
      final urlData = await _apiService.generatePresignedUrl(
        fileName: fileName,
        fileSize: fileSize,
        fileHash: hashStr,
      );

      final uploadUrl = urlData['uploadUrl'];
      final resumeId = urlData['resumeId'];

      // 3. S3 PUT
      final dio = Dio();
      await dio.put(
        uploadUrl,
        data: bytes,
        options: Options(
          headers: {
            Headers.contentLengthHeader: fileSize,
            Headers.contentTypeHeader: "application/pdf",
          },
        ),
      );

      // 4. Trigger Processing
      await _apiService.processResumeUpload(resumeId);
      
      // Reload resumes
      await fetchResumes();
      
      return true;

    } catch (e) {
      _setError(e.toString());
      return false;
    } finally {
      _setLoading(false);
    }
  }

  Future<void> deleteResume(String resumeId) async {
    try {
      _setLoading(true);
      _setError(null);
      await _apiService.deleteResume(resumeId);
      if (_pollingTimers.containsKey(resumeId)) {
        _pollingTimers[resumeId]?.cancel();
        _pollingTimers.remove(resumeId);
      }
      await fetchResumes();
    } catch (e) {
      _setError(e.toString());
    } finally {
      _setLoading(false);
    }
  }

  Future<void> setActiveResume(String resumeId) async {
    try {
      _setLoading(true);
      _setError(null);
      await _apiService.setActiveResume(resumeId);
      await fetchResumes();
    } catch (e) {
      _setError(e.toString());
    } finally {
      _setLoading(false);
    }
  }

  void _startPolling(String resumeId) {
    if (_pollingTimers.containsKey(resumeId)) return;

    _pollingTimers[resumeId] = Timer.periodic(const Duration(seconds: 5), (timer) async {
      final resume = await fetchResumeDetail(resumeId);
      if (resume != null) {
        if (resume.status == ResumeStatus.parsed || resume.status == ResumeStatus.failed) {
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
