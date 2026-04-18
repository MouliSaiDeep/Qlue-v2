import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../core/network/dio_client.dart';
import 'package:dio/dio.dart';
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
      // 1. Call backend to check verification and get sync status
      final response = await DioClient().dio.post(
        ApiConstants.login,
        data: {'email': email, 'password': password},
      );

      if (response.statusCode == 200) {
        // 2. If backend is happy, sign in locally to maintain Firebase state
        await _auth.signInWithEmailAndPassword(email: email, password: password);
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 403) {
        _error = "EMAIL_NOT_VERIFIED";
      } else {
        _error = e.response?.data?['details'] ?? "Login failed.";
      }
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
      // Call backend to handle registration and verification email
      await DioClient().dio.post(
        ApiConstants.register,
        data: {
          'email': email,
          'password': password,
          'displayName': displayName,
        },
      );
      // We don't sign in locally yet because email isn't verified
    } on DioException catch (e) {
      _error = e.response?.data?['error'] ?? "Registration failed.";
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

      // 4. Explicitly sync with backend for Google Sign-in
      final idToken = await _auth.currentUser?.getIdToken();
      await DioClient().dio.post(
        ApiConstants.googleLogin,
        data: {'idToken': idToken},
      );
    } catch (e) {
      _error = "Google sign-in failed.";
    } finally {
      _setLoading(false);
    }
  }

  Future<void> logout() async {
    await _auth.signOut();
    await _googleSignIn.signOut();
    _isBypassAuthenticated = false;
    notifyListeners();
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
