import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import '../../context/auth_provider.dart';
import '../../core/theme.dart';
import '../../components/glass_card.dart';
import '../../components/glass_controls.dart';
import '../../components/spectral_background.dart';
import 'delete_account_dialog.dart';

class VerifyEmailScreen extends StatefulWidget {
  const VerifyEmailScreen({super.key});
  @override
  State<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends State<VerifyEmailScreen> {
  final _code = TextEditingController();
  Timer? _timer;
  String? _message;
  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && context.read<AuthProvider>().otpChallengeId == null) {
        _send();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final auth = context.read<AuthProvider>();
    final sent = await auth.requestEmailOtp();
    if (!mounted) return;
    setState(
      () => _message = sent
          ? 'Code sent. Check your inbox and spam folder.'
          : auth.error,
    );
  }

  Future<void> _verify() async {
    final auth = context.read<AuthProvider>();
    final verified = await auth.verifyEmailOtp(_code.text.trim());
    if (!mounted) return;
    if (verified) {
      context.go('/dashboard');
    } else {
      setState(() => _message = auth.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final theme = AppThemeColors.of(context);
    final remaining =
        (auth.otpResendAt?.difference(DateTime.now()).inSeconds ?? 0).clamp(
          0,
          60,
        );
    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: GlassCard(
                borderRadius: 28,
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(
                      Icons.mark_email_unread_outlined,
                      color: theme.primary,
                      size: 44,
                    ),
                    const SizedBox(height: 20),
                    Text(
                      'Verify your email',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: theme.text,
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Enter the six-digit code sent to ${auth.currentUser?.email ?? ''}. Codes expire after 5 minutes.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: theme.textSecondary, height: 1.5),
                    ),
                    TextButton(
                      onPressed: auth.isLoading
                          ? null
                          : () => showDeleteAccountDialog(context),
                      child: const Text('Delete account instead'),
                    ),
                    const SizedBox(height: 24),
                    TextField(
                      key: const Key('email-otp-input'),
                      controller: _code,
                      enabled: !auth.isLoading,
                      keyboardType: TextInputType.number,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(6),
                      ],
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: theme.text,
                        fontSize: 28,
                        letterSpacing: 10,
                      ),
                      decoration: InputDecoration(
                        labelText: 'Verification code',
                        hintText: '000000',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      onSubmitted: (_) {
                        if (!auth.isLoading) _verify();
                      },
                    ),
                    if (_message != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          _message!,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: auth.error != null
                                ? theme.error
                                : theme.textSecondary,
                          ),
                        ),
                      ),
                    const SizedBox(height: 20),
                    AppButton(
                      onTap: auth.isLoading || auth.otpChallengeId == null
                          ? null
                          : _verify,
                      height: 52,
                      borderRadius: 16,
                      child: auth.isLoading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Verify and continue'),
                    ),
                    TextButton(
                      key: const Key('email-otp-resend'),
                      onPressed: auth.isLoading || remaining > 0 ? null : _send,
                      child: Text(
                        remaining > 0
                            ? 'Resend in ${remaining}s'
                            : 'Send a new code',
                      ),
                    ),
                    TextButton(
                      onPressed: auth.isLoading
                          ? null
                          : () async {
                              await auth.logout();
                              if (context.mounted) context.go('/login');
                            },
                      child: const Text('Use another account'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
