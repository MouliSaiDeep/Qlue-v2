import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as status;

enum WebSocketStatus { disconnected, connecting, connected, reconnecting }

class WebSocketClient {
  WebSocketChannel? _channel;
  final String url;
  final String userId;
  final String sessionId;
  final Map<String, String> headers;

  String? _authToken; // BUG-7 FIX: Store token for reconnect

  final StreamController<Map<String, dynamic>> _messageController =
      StreamController<Map<String, dynamic>>.broadcast();
  final StreamController<String> _errorController =
      StreamController<String>.broadcast();
  final StreamController<void> _disconnectController =
      StreamController<void>.broadcast();
  final StreamController<void> _reconnectController =
      StreamController<void>.broadcast();

  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  bool _isConnected = false;
  int _reconnectAttempts = 0;
  static const int maxReconnectAttempts = 5;
  static const Duration reconnectDelay = Duration(seconds: 2);

  Completer<void>? _connectCompleter;
  WebSocketStatus _status = WebSocketStatus.disconnected;

  WebSocketStatus get connectionStatus => _status;

  WebSocketClient({
    required this.url,
    required this.userId,
    required this.sessionId,
    this.headers = const {},
  });

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  Stream<String> get errors => _errorController.stream;
  Stream<void> get disconnects => _disconnectController.stream;
  Stream<void> get reconnects => _reconnectController.stream;
  bool get isConnected => _isConnected;

  Future<void> connect({String? authToken}) async {
    if (_status == WebSocketStatus.connected ||
        _status == WebSocketStatus.connecting) {
      return;
    }

    _status = WebSocketStatus.connecting;
    _connectCompleter = Completer<void>();

    try {
      // BUG-7 FIX: Store authToken for use in reconnect
      _authToken = authToken;

      // Append Firebase auth token as query param
      final wsUrl = authToken != null && authToken.isNotEmpty
          ? Uri.parse(
              url,
            ).replace(queryParameters: {'token': authToken}).toString()
          : url;

      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));

      await _channel!.ready;
      _isConnected = true;
      _status = WebSocketStatus.connected;
      bool wasReconnecting = _reconnectAttempts > 0;
      _reconnectAttempts = 0;

      _startHeartbeat();

      if (wasReconnecting) {
        _reconnectController.add(null);
      }

      // Listen to incoming messages
      _channel!.stream.listen(
        _handleMessage,
        onError: _handleError,
        onDone: _handleDisconnect,
      );

      if (_connectCompleter != null && !_connectCompleter!.isCompleted) {
        _connectCompleter!.complete();
      }
    } catch (e) {
      _status = WebSocketStatus.disconnected;
      _connectCompleter?.completeError(e);
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
    _isConnected = false;
    _status = WebSocketStatus.disconnected;
    _disconnectController.add(null);
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_intentionalDisconnect || _reconnectAttempts >= maxReconnectAttempts) return;

    _status = WebSocketStatus.reconnecting;
    _reconnectTimer?.cancel();
    final delay = reconnectDelay * math.min(_reconnectAttempts + 1, 15);
    _reconnectTimer = Timer(delay, () async {
      _reconnectAttempts++;

      // BUG-7 FIX: Refresh Firebase token before reconnect
      try {
        final newToken = await FirebaseAuth.instance.currentUser?.getIdToken(
          true,
        );
        await connect(authToken: newToken);
      } catch (e) {
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

  void disconnect() {
    _intentionalDisconnect = true;
    _reconnectTimer?.cancel();
    _heartbeatTimer?.cancel();
    _channel?.sink.close(status.goingAway);
    _channel = null;
    _isConnected = false;
    _status = WebSocketStatus.disconnected;
    // FE-BUG #6 FIX: Do NOT fire _disconnectController on intentional disconnect.
    // Unexpected disconnects (network loss) fire the disconnect event; intentional
    // ones (endSession) must not, to avoid triggering the feedback nav race condition.
  }

  void dispose() {
    disconnect();
    _messageController.close();
    _errorController.close();
    _disconnectController.close();
    _reconnectController.close(); // FE-BUG #5 FIX: was missing, causing stream memory leak
  }
}
