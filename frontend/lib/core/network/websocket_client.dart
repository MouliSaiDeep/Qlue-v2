import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:flutter/foundation.dart';
import '../constants/app_constants.dart';

enum WebSocketStatus { connecting, connected, disconnected }

class WebSocketClient {
  static final WebSocketClient _instance = WebSocketClient._internal();
  factory WebSocketClient() => _instance;
  WebSocketClient._internal();

  WebSocketChannel? _channel;
  WebSocketStatus _status = WebSocketStatus.disconnected;
  
  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onMessage => _messageController.stream;
  
  WebSocketStatus get status => _status;
  
  Timer? _heartbeatTimer;
  int _reconnectAttempts = 0;
  String? _lastUrl;
  String? _sessionId;

  /// Store the active session ID so reconnect can re-associate
  void setSessionId(String? id) {
    _sessionId = id;
  }

  Future<void> connect(String url, String token) async {
    final uri = Uri.parse(url);
    final queryParams = Map<String, String>.from(uri.queryParameters);
    if (token.isNotEmpty && !queryParams.containsKey('token')) {
      queryParams['token'] = token;
    }
    final fullUrl = uri.replace(queryParameters: queryParams).toString();
    _lastUrl = fullUrl;
    _status = WebSocketStatus.connecting;
    
    try {
      _channel = WebSocketChannel.connect(Uri.parse(fullUrl));
      _status = WebSocketStatus.connected;
      _reconnectAttempts = 0;
      
      _startHeartbeat();
      
      _channel!.stream.listen(
        (message) {
          try {
            final data = jsonDecode(message);
            _messageController.add(data);
          } catch (e) {
            debugPrint('WebSocket: Failed to parse message: $e');
          }
        },
        onDone: () => _handleDisconnect(),
        onError: (e) => _handleDisconnect(),
      );
    } catch (e) {
      _handleDisconnect();
    }
  }

  void _handleDisconnect() {
    _status = WebSocketStatus.disconnected;
    _stopHeartbeat();
    
    // Stop after 5 attempts to prevent infinite loops
    if (_reconnectAttempts >= 5 || _lastUrl == null) {
      return;
    }

    final delay = math.min(
      math.pow(2, _reconnectAttempts) * 1000,
      AppConstants.maxWebsocketReconnectDelay.inMilliseconds.toDouble(),
    ).toInt();
    
    _reconnectAttempts++;
    debugPrint('WebSocket: Reconnecting in ${delay}ms (attempt $_reconnectAttempts/5)');
    Timer(Duration(milliseconds: delay), () async {
      if (_status == WebSocketStatus.disconnected && _lastUrl != null) {
        try {
          // FIX: Token is already embedded in _lastUrl query string
          await connect(_lastUrl!, '');
          
          // After successful reconnect, re-associate with active session
          if (_status == WebSocketStatus.connected && _sessionId != null) {
            debugPrint('WebSocket: Reconnected — re-associating session $_sessionId');
            send('session_reconnect', {'sessionId': _sessionId!});
          }
        } catch (e) {
          debugPrint('WebSocket: Reconnect failed: $e');
        }
      }
    });
  }

  void send(String type, Map<String, dynamic> payload) {
    if (_status == WebSocketStatus.connected && _channel != null) {
      _channel!.sink.add(jsonEncode({'type': type, 'payload': payload}));
    }
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(AppConstants.websocketHeartbeatInterval, (timer) {
      send('ping', {});
    });
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  void disconnect() {
    _lastUrl = null;
    _sessionId = null;
    _stopHeartbeat();
    _channel?.sink.close();
    _status = WebSocketStatus.disconnected;
  }
}
