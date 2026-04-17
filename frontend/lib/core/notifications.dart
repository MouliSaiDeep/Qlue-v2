import 'package:flutter/material.dart';
import '../components/spectral_notification.dart';

class Notify {
  static void success(BuildContext context, String message) {
    _show(context, message, NotificationType.success);
  }

  static void error(BuildContext context, String message) {
    _show(context, message, NotificationType.error);
  }

  static void info(BuildContext context, String message) {
    _show(context, message, NotificationType.info);
  }

  static void _show(BuildContext context, String message, NotificationType type) {
    late OverlayEntry overlayEntry;
    
    overlayEntry = OverlayEntry(
      builder: (context) => Positioned(
        top: 0,
        left: 0,
        right: 0,
        child: SpectralNotification(
          message: message,
          type: type,
          onDismiss: () {
            overlayEntry.remove();
          },
        ),
      ),
    );

    Overlay.of(context).insert(overlayEntry);
  }
}
