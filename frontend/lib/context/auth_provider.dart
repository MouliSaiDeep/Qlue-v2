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

  String _email = "";
  String _profession = "";
  List<String> _skills = [];
  String _voiceId = "Tiffany";

  bool _isBypassAuthenticated = false;

  User? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isAuthenticated => _currentUser != null || _isBypassAuthenticated;
  
  String get email => _email.isNotEmpty ? _email : (_currentUser?.email ?? "");
  String get profession => _profession;
  List<String> get skills => _skills;
  String get voiceId => _voiceId;

  void setBypassAuthenticated() {
    _isBypassAuthenticated = true;
    notifyListeners();
  }
  
  // Interface expected by screens - using fallbacks to avoid null lints in untouchable screens
  String get profileImageUrl => _currentUser?.photoURL ?? "";
  String get displayName => _currentUser?.displayName ?? "User";

  final FirebaseAuth _auth = FirebaseAuth.instance;
  // google_sign_in 7.x uses singleton instance
  final GoogleSignIn _googleSignIn = GoogleSignIn.instance;

  AuthProvider() {
    _auth.authStateChanges().listen((User? user) {
      final wasNull = _currentUser == null;
      _currentUser = user;
      notifyListeners();
      if (user != null) {
        _syncWithBackend();
        if (wasNull) fetchProfileData(); // Auto fetch on login
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
      // 1. Authenticate (Replacement for signIn() in 7.x)
      final GoogleSignInAccount? googleUser = await _googleSignIn.authenticate();
      if (googleUser == null) {
        _setLoading(false);
        return;
      }

      // 2. Authentication result (No longer a Future in 7.x)
      final GoogleSignInAuthentication googleAuth = googleUser.authentication;
      
      // 3. Request Access Token (Authorization is separate in 7.x)
      final authorization = await googleUser.authorizationClient.authorizeScopes([
        'email',
        'profile',
        'openid',
      ]);

      final AuthCredential credential = GoogleAuthProvider.credential(
        accessToken: authorization.accessToken,
        idToken: googleAuth.idToken,
      );

      final UserCredential userCredential = await _auth.signInWithCredential(credential);
      final User? user = userCredential.user;

      if (user != null) {
        // Explicitly sync with backend for Google Sign-in
        final idToken = await user.getIdToken();
        await DioClient().dio.post(
          ApiConstants.googleLogin,
          data: {'idToken': idToken},
        );
      }
    } catch (e) {
      // Log error internally if needed, suppressed for user
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
    } catch (_) {}
  }

  Future<void> fetchProfileData() async {
    try {
      final response = await DioClient().dio.get(ApiConstants.authProfile);
      final data = response.data;
      _email = data['email'] ?? "";
      _profession = data['profession'] ?? "";
      _skills = List<String>.from(data['skills'] ?? []);
      _voiceId = data['voiceId'] ?? "Tiffany";
      notifyListeners();
    } catch (e) {
      debugPrint("Fetch Profile Error: $e");
    }
  }

  Future<void> updateUserProfile({String? name, String? imageUrl, String? profession, List<String>? skills, String? voiceId}) async {
    if (_currentUser == null) return;
    try {
      // 1. Update Firebase if needed
      if (name != null) await _currentUser!.updateDisplayName(name);
      if (imageUrl != null) await _currentUser!.updatePhotoURL(imageUrl);
      
      // 2. Update Backend
      await DioClient().dio.put(
        ApiConstants.authProfile,
        data: {
          if (name != null) 'displayName': name,
          if (imageUrl != null) 'photoUrl': imageUrl,
          if (profession != null) 'profession': profession,
          if (skills != null) 'skills': skills,
          if (voiceId != null) 'voiceId': voiceId,
        },
      );

      // 3. Local state update
      if (profession != null) _profession = profession;
      if (skills != null) _skills = List.from(skills);
      if (voiceId != null) _voiceId = voiceId;

      await _currentUser!.reload();
      _currentUser = _auth.currentUser;
      notifyListeners();
    } catch (e) {
      debugPrint("Update Profile Error: $e");
    }
  }

  Future<void> updateFcmToken(String token) async {
    try {
      await DioClient().dio.post(ApiConstants.updateFcmToken, data: {'token': token});
    } catch (_) {}
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
