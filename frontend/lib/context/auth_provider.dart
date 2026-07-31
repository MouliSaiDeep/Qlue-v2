import 'package:flutter/material.dart';

class AuthProvider extends ChangeNotifier {
  bool _isAuthenticated = false;
  bool get isAuthenticated => _isAuthenticated;

  String _displayName = "Rishi";
  String get displayName => _displayName;

  String _profileImageUrl = "https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=200&h=200&auto=format&fit=crop";
  String get profileImageUrl => _profileImageUrl;

  void updateUserProfile({String? name, String? imageUrl}) {
    if (name != null) _displayName = name;
    if (imageUrl != null) _profileImageUrl = imageUrl;
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    // Mock network request
    await Future.delayed(const Duration(seconds: 1));
    _isAuthenticated = true;
    notifyListeners();
  }

  Future<void> register(String name, String email, String password) async {
    // Mock network request
    await Future.delayed(const Duration(seconds: 1));
    _displayName = name;
    _isAuthenticated = true;
    notifyListeners();
  }

  Future<void> signInWithGoogle() async {
    // Mock network request for UI purposes only
    await Future.delayed(const Duration(seconds: 1));
    _isAuthenticated = true;
    notifyListeners();
  }

  void logout() {
    _isAuthenticated = false;
    notifyListeners();
  }
}
