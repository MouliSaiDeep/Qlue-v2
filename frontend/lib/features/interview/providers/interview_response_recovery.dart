part of 'interview_provider.dart';

// Connection/answer retries keep the same owner and clientTurnId. Public state
// transitions remain on InterviewProvider; this part owns response scheduling.
extension _InterviewResponseRecovery on InterviewProvider {
  void _sendPendingAnswer() {
    if (_pendingAnswer == null) return;
    if (sessionId == null && _wsClient == null) return;
    if (_wsClient == null || _transportLost || !_wsClient!.isConnected) {
      _scheduleResponseRecovery();
      return;
    }
    _wsClient?.sendMessage({'type': 'turn_submit', 'payload': _pendingAnswer});
    _armResponseWatchdog();
  }

  void _armResponseWatchdog() {
    final gen = _generation;
    _responseTimer?.cancel();
    _responseTimer = Timer(const Duration(seconds: 45), () {
      if (!_isStale(gen) && !_isEnding) _scheduleResponseRecovery();
    });
  }

  void _requestReconnect() {
    if (_wsClient == null || !_wsClient!.isConnected || _transportLost) {
      _scheduleResponseRecovery();
      return;
    }
    _awaitingReconnect = true;
    _requestId = '$_generation-${++_recoveryOperation}';
    _wsClient?.sendMessage({
      'type': 'session_reconnect',
      'payload': {
        'sessionId': sessionId,
        'turnId': _currentTurnId,
        'requestId': _requestId,
      },
    });
    _armResponseWatchdog();
  }

  void _scheduleResponseRecovery() {
    if (_isEnding ||
        isSessionEnded ||
        _suspended ||
        _recoveryStopped ||
        _recoveryTimer?.isActive == true) {
      return;
    }
    _responseTimer?.cancel();
    if (_responseRetries >= InterviewProvider.maxRecoveryAttempts) {
      _stopRecovery(
        'Interview recovery stopped after 3 attempts. Your answer is kept in this session. You can end the interview.',
      );
      return;
    }
    _currentPhase = InterviewPhase.reconnecting;
    errorMessage = 'Recovering your interview automatically…';
    final gen = _generation;
    _recoveryTimer = Timer(const Duration(seconds: 2), () async {
      if (_isStale(gen) || _isEnding || _suspended || _recoveryStopped) return;
      if (_connectingTransport || _isInitializing) {
        return; // the active real operation owns its deadline
      }
      recoveryAttempt = ++_responseRetries;
      errorMessage =
          'Recovering your interview automatically ($recoveryAttempt/3)…';
      _safeNotify();
      // Reuse the exact clientTurnId; a retry must never become a new answer.
      if (sessionId == null && _initialRequest != null) {
        await initSession(
          _initialRequest!['type'],
          resumeId: _initialRequest!['resumeId'],
          websiteUrl: _initialRequest!['websiteUrl'],
          analysisId: _initialRequest!['analysisId'],
        );
      } else if (_refreshCredentials ||
          _wsClient == null ||
          !_wsClient!.isConnected ||
          _transportLost) {
        await resumeSession();
      } else if (_pendingAnswer != null) {
        _sendPendingAnswer();
      } else {
        _requestReconnect();
      }
    });
    _safeNotify();
  }
}
