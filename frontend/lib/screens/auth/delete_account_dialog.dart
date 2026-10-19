import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../context/auth_provider.dart';
import '../../core/theme.dart';

Future<void> showDeleteAccountDialog(BuildContext context) async {
  final auth = context.read<AuthProvider>();
  final user = auth.currentUser;
  if (user == null) return;
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: DeleteAccountDialog(
        expectedUid: user.uid,
        email: user.email ?? '',
        usesPassword: user.providerData.any((p) => p.providerId == 'password'),
      ),
    ),
  );
}

class DeleteAccountDialog extends StatefulWidget {
  const DeleteAccountDialog({
    super.key,
    required this.expectedUid,
    required this.email,
    required this.usesPassword,
  });
  final String expectedUid;
  final String email;
  final bool usesPassword;
  @override
  State<DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<DeleteAccountDialog> {
  final _confirmation = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  @override
  void dispose() {
    _confirmation.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    if (_busy) return;
    if (_confirmation.text.trim() != 'DELETE') {
      setState(() => _error = 'Type DELETE to confirm.');
      return;
    }
    if (widget.usesPassword && _password.text.isEmpty) {
      setState(
        () => _error = 'Enter your current password to confirm deletion.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await context.read<AuthProvider>().deleteAccount(
      expectedUid: widget.expectedUid,
      password: widget.usesPassword ? _password.text : null,
    );
    if (!mounted) return;
    if (error == null) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _busy = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        backgroundColor: t.bgSecondary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Text(
          'Delete account permanently?',
          style: TextStyle(color: t.error),
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.email,
                style: TextStyle(color: t.text, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              Text(
                'Your sign-in account will be removed. Your resumes, interview history, feedback and recordings will be permanently erased. Stored-data cleanup continues after existing upload links expire (about 20 minutes). This cannot be undone.',
                style: TextStyle(color: t.textSecondary),
              ),
              const SizedBox(height: 16),
              if (widget.usesPassword) ...[
                TextField(
                  key: const Key('delete-account-password'),
                  controller: _password,
                  enabled: !_busy,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: const InputDecoration(
                    labelText: 'Current password',
                    border: OutlineInputBorder(),
                  ),
                  style: TextStyle(color: t.text),
                ),
                const SizedBox(height: 12),
              ] else ...[
                Text(
                  'Confirm with the same Google account on the next screen.',
                  style: TextStyle(color: t.textSecondary),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                key: const Key('delete-account-confirmation'),
                controller: _confirmation,
                enabled: !_busy,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: 'Type DELETE',
                  border: OutlineInputBorder(),
                ),
                style: TextStyle(color: t.text),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Semantics(
                    liveRegion: true,
                    child: Text(_error!, style: TextStyle(color: t.error)),
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            key: const Key('delete-account-submit'),
            onPressed: _busy ? null : _delete,
            style: TextButton.styleFrom(foregroundColor: t.error),
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(
                    widget.usesPassword
                        ? 'Delete account'
                        : 'Confirm with Google',
                  ),
          ),
        ],
      ),
    );
  }
}
