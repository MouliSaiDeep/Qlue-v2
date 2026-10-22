import 'dart:async';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../core/network/dio_client.dart';
import 'package:dio/dio.dart';
import '../core/constants/api_constants.dart';
import '../core/voice_policy.dart';

class AuthProvider extends ChangeNotifier {
  User? _currentUser;
  bool _isLoading = false;
  bool _isInitializing = true;
  String? _error;
  bool _deletingAccount = false;
  String? _deletedUid;
  String? _accountDeletionNotice;
  String? get accountDeletionNotice => _accountDeletionNotice;
  Timer? _initializationTimer;
  StreamSubscription<User?>? _authSubscription;
  bool _disposed = false;

  String _email = "";
  String _profession = "";
  List<String> _skills = [];
  String _voiceId = "Ruth";
  // Voice mode: 'cost_saver' (neural, free-tier friendly) or 'premium'
  // (generative — the most natural voices, uses more credits).
  String _voiceMode = "cost_saver";
  String _photoUrl = "";
  String _displayName = "";

  Dio? _providedApi;
  Dio get _api => _providedApi ?? DioClient().dio;
  bool _verificationPendingRefresh = false;
  String? _otpChallengeId;
  DateTime? _otpResendAt;
  String? get otpChallengeId => _otpChallengeId;
  DateTime? get otpResendAt => _otpResendAt;
  bool get requiresEmailVerification =>
      _currentUser != null && !isAuthenticated;

  User? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  bool get isInitializing => _isInitializing;
  String? get error => _error;
  bool get isAuthenticated =>
      _currentUser?.emailVerified == true && !_verificationPendingRefresh;

  String get email => _email.isNotEmpty ? _email : (_currentUser?.email ?? "");
  String get profession => _profession;
  List<String> get skills => _skills;
  String get voiceId => _voiceId;
  String get voiceMode => _voiceMode;
  bool get isPremiumVoice => _voiceMode == 'premium';

  // Interface expected by screens
  String get profileImageUrl {
    if (_photoUrl.isNotEmpty) return _photoUrl;
    if (_currentUser?.photoURL != null && _currentUser!.photoURL!.isNotEmpty) {
      return _currentUser!.photoURL!;
    }
    return "";
  }

  String get displayName {
    if (_displayName.isNotEmpty) return _displayName;
    return _currentUser?.displayName ?? "User";
  }

  late final FirebaseAuth _auth;
  late final DateTime Function() _now;

  bool _passwordResetInFlight = false;
  DateTime? _passwordResetNextRequestAt;

  int get passwordResetRetryAfterSeconds {
    final remaining = _passwordResetNextRequestAt?.difference(_now());
    if (remaining == null || remaining <= Duration.zero) return 0;
    return (remaining.inMilliseconds / 1000).ceil();
  }

  /// Firebase owns the expiring, single-use reset action and its hosted page.
  /// Never look up sign-in methods or expose whether an address is registered.
  /// This cooldown is UI protection; Firebase enforces server-side abuse limits.
  Future<String?> requestPasswordReset(String email) async {
    final target = email.trim().toLowerCase();
    if (target.length > 254 ||
        !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(target)) {
      return 'Enter a valid email address.';
    }
    if (_passwordResetInFlight || passwordResetRetryAfterSeconds > 0) {
      return 'Please wait before requesting another reset email.';
    }
    _passwordResetInFlight = true;
    _passwordResetNextRequestAt = _now().add(const Duration(seconds: 60));
    try {
      // Use Firebase's configured hosted handler, without accepting a redirect
      // URL or reset token from the caller. No credentials are sent to our API.
      await _auth
          .sendPasswordResetEmail(email: target)
          .timeout(const Duration(seconds: 20));
      return null;
    } on FirebaseAuthException catch (e) {
      switch (e.code) {
        case 'user-not-found':
        case 'user-disabled':
        case 'invalid-credential':
        case 'invalid-login-credentials':
          return null; // Same visible result as an existing eligible account.
        case 'invalid-email':
          return 'Enter a valid email address.';
        case 'too-many-requests':
        case 'quota-exceeded':
          return 'Too many requests. Please try again later.';
        case 'network-request-failed':
          return 'Could not connect. Check your connection and try again.';
        default:
          return 'Password reset is temporarily unavailable. Please try again later.';
      }
    } on TimeoutException {
      return 'Could not confirm the request. Check your inbox before trying again.';
    } catch (_) {
      return 'Password reset is temporarily unavailable. Please try again later.';
    } finally {
      _passwordResetInFlight = false;
    }
  }

  /// Profile recovery is always bound to the Firebase identity captured when
  /// the dialog opened, even if the account changes while that dialog is open.
  Future<String?> requestCurrentUserPasswordReset(String expectedUid) async {
    final user = _auth.currentUser;
    if (user == null || user.uid != expectedUid || user.email == null) {
      return 'Your account changed. Close this window and sign in again.';
    }
    if (!user.providerData.any((p) => p.providerId == 'password')) {
      return 'This account uses Google sign-in. Manage your password in your Google Account.';
    }
    return requestPasswordReset(user.email!);
  }

  /// SECURITY FIX: Change Password previously showed a toast and did nothing.
  /// Firebase requires a recent login before updatePassword, so we
  /// reauthenticate with the CURRENT password first — which also means nobody
  /// with a stolen unlocked phone can silently change the password.
  /// Returns null on success, or a user-friendly error message.
  Future<String?> changePassword(
    String currentPassword,
    String newPassword,
  ) async {
    if (!isStrongPassword(newPassword)) return passwordRequirements;
    if (newPassword == currentPassword) {
      return 'New password must differ from the current one.';
    }
    try {
      final user = _auth.currentUser;
      if (user == null || user.email == null) {
        return 'No signed-in account found. Please log in again.';
      }
      final hasPasswordProvider = user.providerData.any(
        (p) => p.providerId == 'password',
      );
      if (!hasPasswordProvider) {
        return 'This account signs in with Google and has no password to change.';
      }
      final credential = EmailAuthProvider.credential(
        email: user.email!,
        password: currentPassword,
      );
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(newPassword);
      return null;
    } on FirebaseAuthException catch (e) {
      if (e.code == 'wrong-password' || e.code == 'invalid-credential') {
        return 'Current password is incorrect.';
      }
      if (e.code == 'weak-password' ||
          e.code == 'password-does-not-meet-requirements') {
        return passwordRequirements;
      }
      if (e.code == 'too-many-requests') {
        return 'Too many attempts. Please try again in a few minutes.';
      }
      if (e.code == 'requires-recent-login') {
        return 'For security, please log out and log back in, then retry.';
      }
      return 'Password change failed: ${e.message ?? e.code}';
    } catch (e) {
      return 'Password change failed. Please try again.';
    }
  }

  static const passwordRequirements =
      'Use at least 8 characters with uppercase and lowercase letters, a number, and a special character.';

  static bool isStrongPassword(String value) =>
      value.length >= 8 &&
      RegExp(r'[A-Z]').hasMatch(value) &&
      RegExp(r'[a-z]').hasMatch(value) &&
      RegExp(r'[0-9]').hasMatch(value) &&
      RegExp(r'[^A-Za-z0-9\s]').hasMatch(value);

  // google_sign_in 7.x uses singleton instance
  late final GoogleSignIn _googleSignIn;

  /// [auth] and [googleSignIn] are injectable for tests; production uses the
  /// default singletons.
  AuthProvider({
    FirebaseAuth? auth,
    GoogleSignIn? googleSignIn,
    Dio? api,
    DateTime Function()? now,
  }) {
    _now = now ?? DateTime.now;
    _providedApi = api;
    _auth = auth ?? FirebaseAuth.instance;
    _googleSignIn = googleSignIn ?? GoogleSignIn.instance;
    final startTime = DateTime.now();
    // Safety net: if authStateChanges never emits (e.g. Firebase auth wedged
    // or offline), don't strand the app on the splash screen forever. Clear
    // the init gate after a hard cap so the router can route to /login.
    _initializationTimer = Timer(const Duration(seconds: 6), () {
      if (_isInitializing) {
        _isInitializing = false;
        notifyListeners();
      }
    });
    _authSubscription = _auth.authStateChanges().listen(
      (User? user) async {
        if (user?.uid == _deletedUid) user = null;
        final ownerChanged = _currentUser?.uid != user?.uid;
        if (ownerChanged) {
          _clearProfileCache();
          _otpChallengeId = null;
          _otpResendAt = null;
        }
        _currentUser = user;

        if (user != null && user.emailVerified) {
          _syncWithBackend();
          if (ownerChanged) fetchProfileData();
        }

        if (_isInitializing) {
          final elapsed = DateTime.now().difference(startTime);
          final remaining = const Duration(milliseconds: 2000) - elapsed;
          if (remaining > Duration.zero) {
            await Future.delayed(remaining);
          }
          if (_disposed) return;
          _isInitializing = false;
          notifyListeners();
        } else {
          notifyListeners();
        }
      },
      onError: (_) {
        // If the auth stream errors (e.g. platform channel unavailable), don't
        // leave the app stuck initializing — fall through to the unauthenticated
        // state so the router can route to /login.
        if (_isInitializing) {
          _isInitializing = false;
          notifyListeners();
        }
      },
    );
  }

  Future<void> login(String email, String password) async {
    _setLoading(true);
    _clearError();
    try {
      // 1. Call backend to check verification and get sync status
      final response = await _api.post(
        ApiConstants.login,
        data: {'email': email, 'password': password},
      );

      if (response.statusCode == 200) {
        // 2. If backend is happy, sign in locally to maintain Firebase state
        final credential = await _auth.signInWithEmailAndPassword(
          email: email,
          password: password,
        );
        _currentUser = credential.user;
        _verificationPendingRefresh = false;
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 403) {
        if (e.response?.data?['error'] == 'EMAIL_NOT_VERIFIED') {
          try {
            final credential = await _auth.signInWithEmailAndPassword(
              email: email,
              password: password,
            );
            _currentUser = credential.user;
            _verificationPendingRefresh = false;
          } on FirebaseAuthException catch (error) {
            _error = _mapFirebaseError(error.code);
          }
        } else {
          _error = 'Login is unavailable. Please try again.';
        }
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

  @override
  void dispose() {
    _disposed = true;
    _initializationTimer?.cancel();
    _authSubscription?.cancel();
    super.dispose();
  }

  Future<void> register(
    String email,
    String password,
    String displayName,
  ) async {
    _setLoading(true);
    _clearError();
    try {
      // Call backend to handle registration and verification email
      await _api.post(
        ApiConstants.register,
        data: {
          'email': email,
          'password': password,
          'displayName': displayName,
        },
      );
      final credential = await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      _currentUser = credential.user;
      _verificationPendingRefresh = false;
      _otpChallengeId = null;
      _otpResendAt = null;
    } on DioException catch (e) {
      _error = e.response?.data?['error'] ?? "Registration failed.";
    } catch (e) {
      _error = "An unexpected error occurred.";
    } finally {
      _setLoading(false);
    }
  }

  Future<bool> requestEmailOtp() async {
    _setLoading(true);
    _clearError();
    try {
      if (!requiresEmailVerification) throw StateError('Sign in again.');
      final response = await _api.post(ApiConstants.sendEmailOtp);
      final data = response.data as Map<String, dynamic>;
      if (data['verified'] == true) {
        _verificationPendingRefresh = true;
        await _refreshVerifiedUser(_currentUser!);
        await _syncWithBackend();
        await fetchProfileData();
        return true;
      }
      _otpChallengeId = data['challengeId'] as String?;
      _otpResendAt = DateTime.now().add(
        Duration(seconds: (data['resendAfterSeconds'] as num?)?.toInt() ?? 60),
      );
      return _otpChallengeId != null;
    } on DioException catch (e) {
      _error =
          e.response?.data?['error'] ??
          'Could not send the code. Please try again.';
      return false;
    } catch (_) {
      _error = 'Please sign in again to verify your email.';
      return false;
    } finally {
      _setLoading(false);
    }
  }

  Future<void> _refreshVerifiedUser(User user) async {
    await user.reload();
    final refreshed = _auth.currentUser;
    if (refreshed?.uid != user.uid || refreshed?.emailVerified != true) {
      throw StateError('Email verification has not refreshed.');
    }
    await refreshed!.getIdToken(true);
    _currentUser = refreshed;
    _verificationPendingRefresh = false;
  }

  Future<bool> verifyEmailOtp(String code) async {
    _setLoading(true);
    _clearError();
    try {
      if (_otpChallengeId == null || !RegExp(r'^\d{6}$').hasMatch(code)) {
        _error = 'Enter the six-digit code from your email.';
        return false;
      }
      final user = _currentUser;
      if (user == null) throw StateError('Sign in again.');
      await _api.post(
        ApiConstants.verifyEmailOtp,
        data: {'challengeId': _otpChallengeId, 'code': code},
      );
      _verificationPendingRefresh = true;
      await _refreshVerifiedUser(user);
      _otpChallengeId = null;
      _otpResendAt = null;
      await _syncWithBackend();
      await fetchProfileData();
      return true;
    } on DioException catch (e) {
      _error =
          e.response?.data?['error'] ??
          'Could not verify the code. Please try again.';
      return false;
    } catch (_) {
      _error = 'Could not refresh verification. Please sign in again.';
      return false;
    } finally {
      _setLoading(false);
    }
  }

  Future<void> signInWithGoogle() async {
    _setLoading(true);
    _clearError();
    try {
      // 1. Authenticate (Replacement for signIn() in 7.x)
      final GoogleSignInAccount googleUser = await _googleSignIn.authenticate();

      // 2. Authentication result (No longer a Future in 7.x)
      final GoogleSignInAuthentication googleAuth = googleUser.authentication;

      // 3. Request Access Token (Authorization is separate in 7.x)
      final authorization = await googleUser.authorizationClient
          .authorizeScopes(['email', 'profile', 'openid']);

      final AuthCredential credential = GoogleAuthProvider.credential(
        accessToken: authorization.accessToken,
        idToken: googleAuth.idToken,
      );

      final UserCredential userCredential = await _auth.signInWithCredential(
        credential,
      );
      final User? user = userCredential.user;

      if (user != null) {
        // Explicitly sync with backend for Google Sign-in
        final idToken = await user.getIdToken();
        await _api.post(ApiConstants.googleLogin, data: {'idToken': idToken});
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
    _currentUser = null;
    _verificationPendingRefresh = false;
    _otpChallengeId = null;
    _otpResendAt = null;
    _clearProfileCache();
    notifyListeners();
  }

  void _clearProfileCache() {
    _email = '';
    _profession = '';
    _skills = [];
    _photoUrl = '';
    _displayName = '';
    _voiceId = 'Ruth';
    _voiceMode = 'cost_saver';
  }

  /// Reauthenticate on the captured account, then let the backend create its
  /// durable cleanup job BEFORE removing Firebase. Never call User.delete()
  /// here: that would strand data cleanup without an authenticated request.
  Future<String?> deleteAccount({
    required String expectedUid,
    String? password,
  }) async {
    if (_deletingAccount) return 'Account deletion is already in progress.';
    final user = _auth.currentUser;
    if (user == null || user.uid != expectedUid) {
      return 'Your account changed. Please sign in again.';
    }
    _deletingAccount = true;
    try {
      final usesPassword = user.providerData.any(
        (p) => p.providerId == 'password',
      );
      AuthCredential credential;
      if (usesPassword) {
        if (password == null || password.isEmpty) {
          return 'Enter your current password to confirm deletion.';
        }
        credential = EmailAuthProvider.credential(
          email: user.email!,
          password: password,
        );
      } else if (user.providerData.any((p) => p.providerId == 'google.com')) {
        final google = await _googleSignIn.authenticate();
        final token = google.authentication.idToken;
        if (token == null) {
          return 'Could not confirm Google sign-in. Please retry.';
        }
        credential = GoogleAuthProvider.credential(idToken: token);
      } else {
        return 'Please sign in again with your account provider before deleting your account.';
      }
      await user.reauthenticateWithCredential(credential);
      final token = await user.getIdToken(true);
      if (_auth.currentUser?.uid != expectedUid || token == null) {
        return 'Your account changed. Please sign in again.';
      }
      final response = await _api.delete(
        ApiConstants.deleteAccount,
        data: {'confirmation': 'DELETE'},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if ((response.statusCode != 200 && response.statusCode != 202) ||
          response.data is! Map ||
          response.data['deletionAccepted'] != true) {
        return 'Deletion could not be confirmed. Please retry.';
      }
      // Do not sign out or clear a different account if a switch raced the API.
      if (_auth.currentUser?.uid != expectedUid) {
        return 'Deletion was requested for the previous account. Your current account was not changed.';
      }
      _deletedUid = expectedUid;
      _accountDeletionNotice = response.data['status'] == 'COMPLETE'
          ? 'Your account and stored app data have been deleted.'
          : response.data['identityDeleted'] == true
          ? 'Your Firebase account has been removed. Stored-data cleanup continues after outstanding upload links expire (about 20 minutes).'
          : 'Deletion was requested. Account removal is retrying automatically; please wait before signing up again.';
      if (_providedApi == null) DioClient().invalidateLogin(uid: expectedUid);
      _currentUser = null;
      _verificationPendingRefresh = false;
      _otpChallengeId = null;
      _otpResendAt = null;
      _clearProfileCache();
      // Remote acceptance is authoritative even if local provider sign-out fails.
      try {
        await _auth.signOut();
      } catch (_) {}
      try {
        await _googleSignIn.signOut();
      } catch (_) {}
      if (!_disposed) notifyListeners();
      return null;
    } on FirebaseAuthException catch (e) {
      if ([
        'wrong-password',
        'invalid-credential',
        'invalid-login-credentials',
      ].contains(e.code)) {
        return 'The current password is incorrect.';
      }
      if (e.code == 'user-mismatch') {
        return 'Choose the Google account you are deleting.';
      }
      if (e.code == 'too-many-requests') {
        return 'Too many attempts. Please try again later.';
      }
      return 'Could not confirm your identity. Please sign in again and retry.';
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        return 'Please confirm your password or Google sign-in again.';
      }
      return 'Could not confirm deletion. Please retry. If the request was accepted, cleanup will continue automatically.';
    } catch (_) {
      return 'Could not confirm deletion. Please retry.';
    } finally {
      _deletingAccount = false;
    }
  }

  Future<void> _syncWithBackend() async {
    try {
      await _api.post(ApiConstants.authSync);
    } catch (_) {}
  }

  Future<void> fetchProfileData() async {
    final owner = _currentUser?.uid;
    if (owner == null) return;
    try {
      final response = await _api.get(ApiConstants.authProfile);
      if (_currentUser?.uid != owner) return;
      final data = response.data;
      _email = data['email'] ?? "";
      _profession = data['profession'] ?? "";
      _skills = List<String>.from(data['skills'] ?? []);
      _voiceId = VoicePolicy.resolve(data['voiceId'] as String?);
      _voiceMode = 'cost_saver';
      _photoUrl = data['photoUrl'] ?? "";
      _displayName = data['displayName'] ?? "";
      notifyListeners();
    } catch (e) {
      debugPrint("Fetch Profile Error: $e");
    }
  }

  Future<void> updateUserProfile({
    String? name,
    String? imageUrl,
    String? profession,
    List<String>? skills,
    String? voiceId,
    String? voiceMode,
  }) async {
    if (voiceMode == 'premium' || voiceId == 'Tiffany') {
      throw StateError('Premium voices are currently locked.');
    }
    final user = _currentUser;
    if (user == null) return;
    final owner = user.uid;

    // Store old values for potential rollback
    final oldProfession = _profession;
    final oldSkills = List<String>.from(_skills);
    final oldVoiceId = _voiceId;
    final oldVoiceMode = _voiceMode;
    final oldPhotoUrl = _photoUrl;
    final oldDisplayName = _displayName;

    try {
      // 1. Optimistic Local Update
      if (profession != null) _profession = profession;
      if (skills != null) _skills = List.from(skills);
      if (voiceId != null) _voiceId = voiceId;
      if (voiceMode != null) _voiceMode = voiceMode;
      if (imageUrl != null) _photoUrl = imageUrl;
      if (name != null) _displayName = name;
      notifyListeners();

      // 2. Update Firebase if needed
      if (name != null) await user.updateDisplayName(name);
      if (imageUrl != null &&
          (imageUrl.startsWith('http') || imageUrl.startsWith('https'))) {
        await user.updatePhotoURL(imageUrl);
      }

      // 3. Update Backend
      final Map<String, dynamic> updateData = {};
      if (name != null) updateData['displayName'] = name;
      if (imageUrl != null) updateData['photoUrl'] = imageUrl;
      if (profession != null) updateData['profession'] = profession;
      if (skills != null) updateData['skills'] = skills;
      if (voiceId != null) updateData['voiceId'] = voiceId;
      if (voiceMode != null) updateData['voiceMode'] = voiceMode;

      if (_currentUser?.uid != owner || _auth.currentUser?.uid != owner) return;
      await _api.put(ApiConstants.authProfile, data: updateData);
      if (_currentUser?.uid != owner || _auth.currentUser?.uid != owner) return;

      await user.reload();
      if (_currentUser?.uid != owner || _auth.currentUser?.uid != owner) return;
      _currentUser = _auth.currentUser;
      notifyListeners();
    } catch (e) {
      if (_currentUser?.uid != owner) return;
      debugPrint("Update Profile Error: $e");
      // Revert on error
      _profession = oldProfession;
      _skills = oldSkills;
      _voiceId = oldVoiceId;
      _voiceMode = oldVoiceMode;
      _photoUrl = oldPhotoUrl;
      _displayName = oldDisplayName;
      notifyListeners();
      rethrow; // Pass error back to UI if needed
    }
  }

  Future<void> updateFcmToken(String token) async {
    try {
      await _api.post(ApiConstants.updateFcmToken, data: {'token': token});
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
      case 'user-not-found':
        return 'No user found for that email.';
      case 'wrong-password':
        return 'Wrong password provided.';
      case 'email-already-in-use':
        return 'The account already exists for that email.';
      case 'invalid-email':
        return 'The email address is not valid.';
      case 'weak-password':
        return 'The password is too weak.';
      default:
        return 'Authentication failed.';
    }
  }
}
