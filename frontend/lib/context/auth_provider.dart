import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../core/network/dio_client.dart';
import '../core/constants/api_constants.dart';

class AuthProvider extends ChangeNotifier {
  User? _currentUser;
  bool _isLoading = false;
  String? _error;

  bool _isBypassAuthenticated = false;

  User? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isAuthenticated => _currentUser != null || _isBypassAuthenticated;
  
  void setBypassAuthenticated() {
    _isBypassAuthenticated = true;
    notifyListeners();
  }
  
  // Interface expected by screens - using fallbacks to avoid null lints in untouchable screens
  String get profileImageUrl => _currentUser?.photoURL ?? "";
  String get displayName => _currentUser?.displayName ?? "User";

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final GoogleSignIn _googleSignIn = GoogleSignIn.instance;

  AuthProvider() {
    _auth.authStateChanges().listen((User? user) {
      _currentUser = user;
      notifyListeners();
      if (user != null) {
        _syncWithBackend();
      }
    });
  }

  Future<void> login(String email, String password) async {
    _setLoading(true);
    _clearError();
    try {
      await _auth.signInWithEmailAndPassword(email: email, password: password);
    } on FirebaseAuthException catch (e) {
      _error = _mapFirebaseError(e.code);
    } catch (e) {
      _error = "An unexpected error occurred.";
    } finally {
      _setLoading(false);
    }
  }

  Future<void> register(String email, String password, String displayName) async {
    _setLoading(true);
    _clearError();
    try {
      final credential = await _auth.createUserWithEmailAndPassword(email: email, password: password);
      await credential.user?.updateDisplayName(displayName);
      await credential.user?.reload();
      _currentUser = _auth.currentUser;
    } on FirebaseAuthException catch (e) {
      _error = _mapFirebaseError(e.code);
    } catch (e) {
      _error = "An unexpected error occurred.";
    } finally {
      _setLoading(false);
    }
  }

  Future<void> signInWithGoogle() async {
    _setLoading(true);
    _clearError();
    try {
      final GoogleSignInAccount? googleUser = await _googleSignIn.authenticate();
      if (googleUser == null) return;

      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
      // Requesting scopes specifically as required by v7.x for accessToken
      final authorizedUser = await googleUser.authorizationClient.authorizeScopes([
        'email',
        'profile',
        'openid',
      ]);

      final AuthCredential credential = GoogleAuthProvider.credential(
        accessToken: authorizedUser.accessToken,
        idToken: googleAuth.idToken,
      );

      await _auth.signInWithCredential(credential);
    } catch (e) {
      _error = "Google sign-in failed.";
    } finally {
      _setLoading(false);
    }
  }

  Future<void> logout() async {
    await _auth.signOut();
    await _googleSignIn.signOut();
  }

  Future<void> _syncWithBackend() async {
    try {
      await DioClient().dio.post(ApiConstants.authSync);
    } catch (e) {}
  }

  Future<void> updateUserProfile({String? name, String? imageUrl}) async {
    if (_currentUser == null) return;
    try {
      if (name != null) await _currentUser!.updateDisplayName(name);
      if (imageUrl != null) await _currentUser!.updatePhotoURL(imageUrl);
      await _currentUser!.reload();
      _currentUser = _auth.currentUser;
      notifyListeners();
    } catch (e) {}
  }

  Future<void> updateFcmToken(String token) async {
    try {
      await DioClient().dio.post(ApiConstants.updateFcmToken, data: {'token': token});
    } catch (e) {}
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  void _clearError() {
    _error = null;
    notifyListeners();
  }

  void clearError() => _clearError();

  String _mapFirebaseError(String code) {
    switch (code) {
      case 'user-not-found': return 'No user found for that email.';
      case 'wrong-password': return 'Wrong password provided.';
      case 'email-already-in-use': return 'The account already exists for that email.';
      case 'invalid-email': return 'The email address is not valid.';
      case 'weak-password': return 'The password is too weak.';
      default: return 'Authentication failed.';
    }
  }
}
