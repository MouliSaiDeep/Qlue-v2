import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as status;

enum WebSocketStatus { disconnected, connecting, connected, reconnecting }

class WebSocketClient {
  WebSocketChannel? _channel;
  StreamSubscription? _channelSubscription;
  int _socketGeneration = 0;
  final String url;
  final String userId;
  final String sessionId;
  final Map<String, String> headers;
  final Future<String?> Function()? tokenProvider;
  final WebSocketChannel Function(Uri)? channelFactory;

  final StreamController<Map<String, dynamic>> _messageController =
      StreamController<Map<String, dynamic>>.broadcast();
  final StreamController<String> _errorController =
      StreamController<String>.broadcast();
  final StreamController<void> _disconnectController =
      StreamController<void>.broadcast();
  final StreamController<void> _reconnectController =
      StreamController<void>.broadcast();
  final StreamController<int> _retryController =
      StreamController<int>.broadcast();
  final StreamController<void> _exhaustedController =
      StreamController<void>.broadcast();

  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  bool _isConnected = false;
  int _reconnectAttempts = 0;
  bool _exhaustionNotified = false;
  bool _externalRecovery = false;

  /// Interviews have one budget owner for token, transport and server recovery.
  void useExternalRecovery() {
    _externalRecovery = true;
    _reconnectTimer?.cancel();
  }
  static const int maxReconnectAttempts = 3;
  static const Duration reconnectDelay = Duration(seconds: 2);

  Completer<void>? _connectCompleter;
  WebSocketStatus _status = WebSocketStatus.disconnected;

  WebSocketStatus get connectionStatus => _status;

  WebSocketClient({
    required this.url,
    required this.userId,
    required this.sessionId,
    this.headers = const {},
    this.tokenProvider,
    this.channelFactory,
  });

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  Stream<String> get errors => _errorController.stream;
  Stream<void> get disconnects => _disconnectController.stream;
  Stream<void> get reconnects => _reconnectController.stream;
  Stream<int> get retryCounts => _retryController.stream;
  Stream<void> get reconnectExhausted => _exhaustedController.stream;
  bool get isConnected => _isConnected;

  Future<void> connect({String? authToken}) => _connect(authToken: authToken);
  Future<void> _connect({
    String? authToken,
    bool scheduledRetry = false,
  }) async {
    if (!scheduledRetry &&
        _reconnectAttempts >= maxReconnectAttempts &&
        _status != WebSocketStatus.connected) {
      _scheduleReconnect();
      throw StateError('Connection recovery exhausted');
    }
    if (_status == WebSocketStatus.connected ||
        _status == WebSocketStatus.connecting) {
      return;
    }

    _status = WebSocketStatus.connecting;
    _intentionalDisconnect = false;
    final generation = ++_socketGeneration;
    _connectCompleter = Completer<void>();
    _connectCompleter!.future.ignore(); // connect itself propagates the error

    try {
      // Append Firebase auth token as query param
      final wsUrl = authToken != null && authToken.isNotEmpty
          ? Uri.parse(
              url,
            ).replace(queryParameters: {'token': authToken}).toString()
          : url;

      _channel = (channelFactory ?? WebSocketChannel.connect)(Uri.parse(wsUrl));

      await _channel!.ready.timeout(const Duration(seconds: 15));
      if (_intentionalDisconnect || generation != _socketGeneration) return;
      _isConnected = true;
      _status = WebSocketStatus.connected;
      bool wasReconnecting = _reconnectAttempts > 0;
      // Reset only for a new reconciled question, not a transport handshake.

      _startHeartbeat();

      if (wasReconnecting) {
        _reconnectController.add(null);
      }

      // Listen to incoming messages
      _channelSubscription?.cancel();
      _channelSubscription = _channel!.stream.listen(
        (message) {
          if (generation == _socketGeneration && !_intentionalDisconnect) {
            _handleMessage(message);
          }
        },
        onError: (Object error) {
          if (generation == _socketGeneration && !_intentionalDisconnect) {
            _handleError(error);
          }
        },
        onDone: () {
          if (generation == _socketGeneration && !_intentionalDisconnect) {
            _handleDisconnect();
          }
        },
      );

      if (_connectCompleter != null && !_connectCompleter!.isCompleted) {
        _connectCompleter!.complete();
      }
    } catch (e) {
      if (_intentionalDisconnect ||
          generation != _socketGeneration ||
          _errorController.isClosed) {
        return;
      }
      _status = WebSocketStatus.disconnected;
      _isConnected = false;
      _channel?.sink.close().catchError((Object _) {});
      if (_connectCompleter?.isCompleted == false) {
        _connectCompleter!.completeError(e);
      }
      _scheduleReconnect();
      rethrow;
    }
  }

  Future<void> waitForConnection() async {
    if (_connectCompleter != null) {
      await _connectCompleter!.future;
    }
  }

  void _handleMessage(dynamic message) {
    try {
      final data = jsonDecode(message as String) as Map<String, dynamic>;
      _messageController.add(data);
    } catch (e) {
      _errorController.add('Failed to parse message: $e');
    }
  }

  void _handleError(Object error) {
    _errorController.add('WebSocket error: $error');
    _handleDisconnect();
  }

  void _handleDisconnect() {
    if (_intentionalDisconnect || !_isConnected) return;
    _isConnected = false;
    _status = WebSocketStatus.disconnected;
    _disconnectController.add(null);
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_intentionalDisconnect || _externalRecovery) return;
    if (_reconnectAttempts >= maxReconnectAttempts) {
      _status = WebSocketStatus.disconnected;
      if (!_exhaustionNotified) {
        _exhaustionNotified = true;
        _exhaustedController.add(null);
      }
      return;
    }

    _status = WebSocketStatus.reconnecting;
    final generation = _socketGeneration;
    _reconnectTimer?.cancel();
    final delay = reconnectDelay * math.min(_reconnectAttempts + 1, 15);
    _reconnectTimer = Timer(delay, () async {
      if (_intentionalDisconnect ||
          generation != _socketGeneration ||
          _errorController.isClosed) {
        return;
      }
      _reconnectAttempts++;
      _retryController.add(_reconnectAttempts);

      // BUG-7 FIX: Refresh Firebase token before reconnect
      try {
        final user = tokenProvider == null
            ? FirebaseAuth.instance.currentUser
            : null;
        if (tokenProvider == null && (user == null || user.uid != userId)) {
          throw StateError('The signed-in account is unavailable');
        }
        final newToken =
            await (tokenProvider != null
                    ? tokenProvider!()
                    : user!.getIdToken(true))
                .timeout(const Duration(seconds: 10));
        if (_intentionalDisconnect ||
            generation != _socketGeneration ||
            _errorController.isClosed) {
          return;
        }
        if (tokenProvider == null &&
            FirebaseAuth.instance.currentUser?.uid != userId) {
          return;
        }
        if (newToken == null || newToken.isEmpty) {
          throw StateError('Authentication is unavailable');
        }
        await _connect(authToken: newToken, scheduledRetry: true);
      } catch (e) {
        if (_intentionalDisconnect ||
            generation != _socketGeneration ||
            _errorController.isClosed) {
          return;
        }
        _errorController.add('Failed to refresh token for reconnect: $e');
        _scheduleReconnect();
      }
    });
  }

  void send(dynamic data) {
    if (_status != WebSocketStatus.connected || _channel == null) {
      throw StateError('WebSocket not connected. Status: $_status');
    }

    if (data is Map<String, dynamic>) {
      _sendMessage(data);
    } else if (data is String) {
      try {
        final message = jsonDecode(data) as Map<String, dynamic>;
        _sendMessage(message);
      } catch (e) {
        _errorController.add('Invalid send payload: $e');
      }
    } else {
      _errorController.add(
        'Unsupported send payload type: ${data.runtimeType}',
      );
    }
  }

  void sendMessage(Map<String, dynamic> message) {
    if (_isConnected && _channel != null) {
      _sendMessage(message);
    } else {
      _errorController.add('Cannot send message: not connected');
    }
  }

  void _sendMessage(Map<String, dynamic> message) {
    try {
      // Automatically inject the userId into the root of every outgoing message
      final messageToSend = Map<String, dynamic>.from(message);
      messageToSend['userId'] = userId;

      final jsonMessage = jsonEncode(messageToSend);
      _channel!.sink.add(jsonMessage);
    } catch (e) {
      _errorController.add('Failed to send message: $e');
    }
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(Duration(minutes: 5), (_) {
      if (_isConnected) {
        sendMessage({'type': 'ping'});
      }
    });
  }

  bool _intentionalDisconnect = false;

  /// A live transport can outlast its Firebase credential. Replacing the
  /// connection is necessary: resending on the old authenticated socket cannot
  /// refresh the identity that API Gateway stored at connect time.
  void refreshAuthentication() {
    if (_intentionalDisconnect || !_isConnected) return;
    _socketGeneration++;
    _channelSubscription?.cancel();
    _channel?.sink.close().catchError((Object _) {});
    _handleDisconnect();
  }

  void disconnect() {
    _intentionalDisconnect = true;
    _socketGeneration++;
    _channelSubscription?.cancel();
    _channelSubscription = null;
    _reconnectTimer?.cancel();
    _heartbeatTimer?.cancel();
    _channel?.sink.close(status.normalClosure);
    _channel = null;
    _isConnected = false;
    _status = WebSocketStatus.disconnected;
    // FE-BUG #6 FIX: Do NOT fire _disconnectController on intentional disconnect.
    // Unexpected disconnects (network loss) fire the disconnect event; intentional
    // ones (endSession) must not, to avoid triggering the feedback nav race condition.
  }

  void markReconciled() {
    _reconnectAttempts = 0;
    _exhaustionNotified = false;
  }

  void dispose() {
    disconnect();
    _messageController.close();
    _errorController.close();
    _disconnectController.close();
    _reconnectController
        .close(); // FE-BUG #5 FIX: was missing, causing stream memory leak
    _retryController.close();
    _exhaustedController.close();
  }
}
