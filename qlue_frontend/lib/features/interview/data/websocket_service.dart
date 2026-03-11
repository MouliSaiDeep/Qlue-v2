class WebsocketService {
  void connect(String sessionId,String token) {}
  void disconnect(){}
  void send(Map<String,dynamic>message){}
  Stream<Map<String,dynamic>> get messages=>const Stream.empty();
}