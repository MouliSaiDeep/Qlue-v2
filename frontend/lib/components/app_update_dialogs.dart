import 'dart:async';

import 'package:flutter/material.dart';

import '../core/notifications.dart';
import '../core/theme.dart';
import '../core/update_service.dart';

Future<bool> showUpdateDetails(BuildContext context, UpdateInfo update) async {
  return await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Update available'),
          scrollable: true,
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(update.versionLabel),
              if (update.releaseNotes.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text(update.releaseNotes),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Later'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.moduleResume,
                foregroundColor: Colors.white,
              ),
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Update now'),
            ),
          ],
        ),
      ) ??
      false;
}

Future<void> downloadAndInstallUpdate(
  BuildContext context,
  UpdateService service,
  UpdateInfo update,
) async {
  final navigator = Navigator.of(context, rootNavigator: true);
  final progress = ValueNotifier<double?>(null);
  final route = DialogRoute<void>(
    context: context,
    themes: InheritedTheme.capture(from: context, to: navigator.context),
    barrierDismissible: false,
    builder: (context) => PopScope(
      canPop: false,
      child: AlertDialog(
        title: const Text('Downloading update'),
        content: ValueListenableBuilder<double?>(
          valueListenable: progress,
          builder: (context, value, _) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              LinearProgressIndicator(value: value),
              const SizedBox(height: 12),
              Text(
                value == null ? 'Downloading…' : '${(value * 100).round()}%',
                style: TextStyle(
                  color: AppThemeColors.of(context).textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  unawaited(navigator.push(route));
  unawaited(route.completed.then((_) => progress.dispose()));

  String? path;
  try {
    path = await service.downloadApk(
      update.downloadUrl,
      onProgress: (received, total) {
        if (total > 0 && route.isActive) {
          progress.value = (received / total).clamp(0.0, 1.0);
        }
      },
    );
  } catch (_) {
    if (context.mounted) {
      Notify.error(
        context,
        'Download failed. Check your connection and try again.',
      );
    }
  } finally {
    if (route.isCurrent) {
      navigator.pop();
    } else if (route.isActive) {
      navigator.removeRoute(route);
    }
  }

  if (path == null || !context.mounted) return;
  InstallOutcome outcome;
  try {
    outcome = await service.installApk(path);
  } catch (_) {
    outcome = InstallOutcome.failed;
  }
  if (!context.mounted) return;
  switch (outcome) {
    case InstallOutcome.launched:
      Notify.info(context, 'Opening installer…');
    case InstallOutcome.permissionDenied:
      Notify.error(
        context,
        'Allow "Install unknown apps" for Qlue, then tap Update again.',
      );
    case InstallOutcome.failed:
      Notify.error(context, "Couldn't open the installer.");
  }
}
