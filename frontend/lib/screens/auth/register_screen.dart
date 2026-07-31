import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:provider/provider.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../context/auth_provider.dart';
import '../../core/theme.dart';
import '../../components/glass_card.dart';
import '../../components/spectral_background.dart';
import '../../components/spectral_input.dart';

class ExactRegisterScreen extends StatefulWidget {
  const ExactRegisterScreen({super.key});
  @override
  State<ExactRegisterScreen> createState() => _ExactRegisterScreenState();
}

class _ExactRegisterScreenState extends State<ExactRegisterScreen> {
  String _name = '';
  String _email = '';
  String _password = '';
  bool _showPw = false;
  bool _agreed = false;
  bool _loading = false;
  bool _googleLoading = false;
  String _error = '';

  Future<void> _handleRegister() async {
    if (_name.trim().isEmpty || _email.trim().isEmpty || _password.isEmpty) {
      setState(() => _error = "Please fill in all fields");
      return;
    }
    if (_password.length < 8) {
      setState(() => _error = "Password must be at least 8 characters");
      return;
    }
    if (!_agreed) {
      setState(() => _error = "Please agree to the Terms of Service");
      return;
    }
    setState(() {
      _error = '';
      _loading = true;
    });
    try {
      await Provider.of<AuthProvider>(
        context,
        listen: false,
      ).register(_name.trim(), _email.trim(), _password);
      if (mounted) Navigator.of(context).pushReplacementNamed('/tabs');
    } catch (e) {
      if (mounted) setState(() => _error = "Registration failed. Try again.");
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handleGoogleSignIn() async {
    setState(() {
      _error = '';
      _googleLoading = true;
    });
    try {
      await Provider.of<AuthProvider>(
        context,
        listen: false,
      ).signInWithGoogle();
      if (mounted &&
          Provider.of<AuthProvider>(context, listen: false).isAuthenticated) {
        Navigator.of(context).pushReplacementNamed('/tabs');
      }
    } catch (e) {
      if (mounted) setState(() => _error = "Google Sign-In failed.");
    } finally {
      if (mounted) setState(() => _googleLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              children: [
                const SizedBox(height: 10),
                // Header with Back Button
                Row(
                  children: [
                    GestureDetector(
                      onTap: () => Navigator.of(context).pop(),
                      child: Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: t.bgSecondary.withOpacity(0.4),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: t.metallicBorder.withOpacity(0.3),
                            width: 1,
                          ),
                        ),
                        child: Icon(
                          FeatherIcons.chevronLeft,
                          size: 20,
                          color: t.text,
                        ),
                      ),
                    ),
                  ],
                ),

                // const Spacer(flex: 1),
                // Premium Typography Logo
                Center(
                  child: Column(
                    children: [
                      ShaderMask(
                        shaderCallback: (bounds) => LinearGradient(
                          colors: [Colors.white, Colors.white.withOpacity(0.7)],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        ).createShader(bounds),
                        child: const Text(
                          'Qlue',
                          style: TextStyle(
                            fontSize: 40,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -1.5,
                            fontFamily: 'Montserrat',
                            color: Colors.white,
                          ),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        "Join the AI Career Revolution",
                        style: TextStyle(
                          color: t.textSecondary,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 1.5,
                          fontFamily: 'Montserrat',
                        ),
                      ),
                    ],
                  ),
                ),

                // const Spacer(flex: 2),
                const SizedBox(height: 50),

                // Unified Register Card
                GlassCard(
                  borderRadius: 32,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 16,
                  ),
                  hasMetallicBorder: true,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        "Create Account",
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: t.text,
                          fontFamily: 'Montserrat',
                        ),
                      ),
                      const SizedBox(height: 16),

                      if (_error.isNotEmpty)
                        Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: t.error.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: t.error.withOpacity(0.2)),
                          ),
                          child: Text(
                            _error,
                            style: TextStyle(
                              color: t.error,
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),

                      SpectralInput(
                        label: "FULL NAME",
                        hint: "Enter your name",
                        icon: FeatherIcons.user,
                        onChanged: (v) => _name = v,
                      ),
                      const SizedBox(height: 12),
                      SpectralInput(
                        label: "EMAIL ADDRESS",
                        hint: "name@example.com",
                        icon: FeatherIcons.mail,
                        onChanged: (v) => _email = v,
                        keyboardType: TextInputType.emailAddress,
                      ),
                      const SizedBox(height: 12),
                      SpectralInput(
                        label: "PASSWORD",
                        hint: "At least 8 characters",
                        icon: FeatherIcons.lock,
                        obscureText: !_showPw,
                        onChanged: (v) => _password = v,
                        suffix: IconButton(
                          icon: Icon(
                            _showPw ? FeatherIcons.eye : FeatherIcons.eyeOff,
                            size: 18,
                            color: t.textSecondary,
                          ),
                          onPressed: () => setState(() => _showPw = !_showPw),
                        ),
                      ),

                      const SizedBox(height: 12),

                      // Terms Toggle
                      GestureDetector(
                        onTap: () => setState(() => _agreed = !_agreed),
                        child: Row(
                          children: [
                            Container(
                              width: 18,
                              height: 18,
                              decoration: BoxDecoration(
                                color: _agreed ? t.primary : Colors.transparent,
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(
                                  color: _agreed ? t.primary : t.textTertiary,
                                  width: 1.5,
                                ),
                              ),
                              child: _agreed
                                  ? const Icon(
                                      Icons.check,
                                      size: 12,
                                      color: Colors.white,
                                    )
                                  : null,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                "I agree to the Terms of Service and Privacy Policy",
                                style: TextStyle(
                                  color: t.textSecondary,
                                  fontSize: 10,
                                  fontFamily: 'Montserrat',
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 20),

                      // Metallic Create Button
                      GestureDetector(
                        onTap: _loading ? null : _handleRegister,
                        child: Container(
                          height: 52,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: _loading
                                  ? [
                                      t.primary.withOpacity(0.5),
                                      t.primary.withOpacity(0.3),
                                    ]
                                  : t.primaryGradient,
                            ),
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(
                              color: Colors.white.withOpacity(0.4),
                              width: 0.8,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: t.primary.withOpacity(0.3),
                                blurRadius: 15,
                                spreadRadius: 1,
                              ),
                            ],
                          ),
                          child: Center(
                            child: _loading
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      color: Colors.white,
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Text(
                                    "Create Account",
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 15,
                                      fontWeight: FontWeight.bold,
                                      letterSpacing: 0.5,
                                      fontFamily: 'Montserrat',
                                    ),
                                  ),
                          ),
                        ),
                      ),

                      const SizedBox(height: 16),

                      // Divider
                      Row(
                        children: [
                          Expanded(
                            child: Divider(
                              color: t.textTertiary.withOpacity(0.1),
                              thickness: 1,
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: Text(
                              "OR",
                              style: TextStyle(
                                color: t.textTertiary,
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 1,
                                fontFamily: 'Montserrat',
                              ),
                            ),
                          ),
                          Expanded(
                            child: Divider(
                              color: t.textTertiary.withOpacity(0.1),
                              thickness: 1,
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 12),

                      // Google Button
                      GlassCard(
                        onTap: _googleLoading ? null : _handleGoogleSignIn,
                        borderRadius: 18,
                        padding: EdgeInsets.zero,
                        child: SizedBox(
                          height: 52,
                          child: Center(
                            child: _googleLoading
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      color: Colors.white,
                                      strokeWidth: 2,
                                    ),
                                  )
                                : Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      SvgPicture.string(
                                        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>',
                                        width: 18,
                                        height: 18,
                                      ),
                                      const SizedBox(width: 10),
                                      Text(
                                        "Continue with Google",
                                        style: TextStyle(
                                          color: t.textSecondary,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                          fontFamily: 'Montserrat',
                                        ),
                                      ),
                                    ],
                                  ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 20),

                // Back to Login
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      "Already have an account? ",
                      style: TextStyle(
                        color: t.textSecondary,
                        fontSize: 13,
                        fontFamily: 'Montserrat',
                      ),
                    ),
                    GestureDetector(
                      onTap: () => Navigator.of(context).pop(),
                      child: Text(
                        "Sign In",
                        style: TextStyle(
                          color: t.primary,
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          fontFamily: 'Montserrat',
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
