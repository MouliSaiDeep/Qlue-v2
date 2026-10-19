import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../context/auth_provider.dart';
import '../../core/theme.dart';

Future<void> showPasswordResetDialog(
  BuildContext context, {
  String initialEmail = '',
  bool currentAccountOnly = false,
}) async {
  final auth = context.read<AuthProvider>();
  final user = auth.currentUser;
  // Pass the captured identity, never a cached profile email or editable UID.
  await showDialog<void>(
    context: context,
    builder: (_) => ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: PasswordResetDialog(
        initialEmail: currentAccountOnly ? user?.email ?? '' : initialEmail,
        currentAccountOnly: currentAccountOnly,
        expectedUid: currentAccountOnly ? user?.uid : null,
      ),
    ),
  );
}

class PasswordResetDialog extends StatefulWidget {
  const PasswordResetDialog({
    super.key,
    this.initialEmail = '',
    this.currentAccountOnly = false,
    this.expectedUid,
  });

  final String initialEmail;
  final bool currentAccountOnly;
  final String? expectedUid;

  @override
  State<PasswordResetDialog> createState() => _PasswordResetDialogState();
}

class _PasswordResetDialogState extends State<PasswordResetDialog> {
  late final TextEditingController _email;
  Timer? _timer;
  bool _busy = false;
  bool _accepted = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(text: widget.initialEmail);
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_busy) return;
    final auth = context.read<AuthProvider>();
    setState(() {
      _busy = true;
      _error = null;
      _accepted = false;
    });
    String? error;
    if (widget.currentAccountOnly) {
      error = widget.expectedUid == null
          ? 'Please sign in again before resetting your password.'
          : await auth.requestCurrentUserPasswordReset(widget.expectedUid!);
    } else {
      error = await auth.requestPasswordReset(_email.text);
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = error;
      _accepted = error == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = AppThemeColors.of(context);
    final retryAfter = context
        .read<AuthProvider>()
        .passwordResetRetryAfterSeconds;
    return AlertDialog(
      backgroundColor: theme.bgSecondary,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      title: Text('Reset password', style: TextStyle(color: theme.text)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.currentAccountOnly
                  ? 'Send a password-reset email to your account address.'
                  : 'Enter your account email to request a password reset.',
              style: TextStyle(color: theme.textSecondary),
            ),
            const SizedBox(height: 16),
            TextField(
              key: const Key('password-reset-email'),
              controller: _email,
              readOnly: widget.currentAccountOnly,
              enabled: !_busy,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              autocorrect: false,
              enableSuggestions: false,
              textCapitalization: TextCapitalization.none,
              maxLength: 254,
              style: TextStyle(color: theme.text),
              decoration: const InputDecoration(
                labelText: 'Email address',
                border: OutlineInputBorder(),
                counterText: '',
              ),
              onSubmitted: (_) {
                if (retryAfter == 0) _send();
              },
            ),
            if (_accepted) ...[
              const SizedBox(height: 16),
              Semantics(
                liveRegion: true,
                child: Text(
                  'If this address has an eligible account, a reset email has been requested. Check your inbox and spam folder. Open the email to choose a new password, then sign in again. If you use Google, continue with Google instead.',
                  key: const Key('password-reset-confirmation'),
                  style: TextStyle(color: theme.textSecondary),
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              Semantics(
                liveRegion: true,
                child: Text(_error!, style: TextStyle(color: theme.error)),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(_accepted ? 'Done' : 'Cancel'),
        ),
        TextButton(
          key: const Key('password-reset-send'),
          onPressed: _busy || retryAfter > 0 ? null : _send,
          child: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(
                  retryAfter > 0
                      ? 'Try again in ${retryAfter}s'
                      : 'Send reset email',
                ),
        ),
      ],
    );
  }
}
