import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'glass_card.dart';
import '../core/theme.dart';

enum NotificationType { success, error, info }

class SpectralNotification extends StatefulWidget {
  final String message;
  final NotificationType type;
  final VoidCallback onDismiss;

  const SpectralNotification({
    super.key,
    required this.message,
    this.type = NotificationType.info,
    required this.onDismiss,
  });

  @override
  State<SpectralNotification> createState() => _SpectralNotificationState();
}

class _SpectralNotificationState extends State<SpectralNotification>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<Offset> _offsetAnimation;
  late Animation<double> _opacityAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );

    _offsetAnimation = Tween<Offset>(
      begin: const Offset(0, -1.5),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.elasticOut,
    ));

    _opacityAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.4, curve: Curves.easeIn),
    ));

    _controller.forward();

    // Auto-dismiss after 3 seconds
    Future.delayed(const Duration(seconds: 3), () {
      if (mounted) {
        _controller.reverse().then((_) => widget.onDismiss());
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    
    IconData icon;
    Color glowColor;
    
    switch (widget.type) {
      case NotificationType.success:
        icon = FeatherIcons.checkCircle;
        glowColor = t.success;
        break;
      case NotificationType.error:
        icon = FeatherIcons.alertCircle;
        glowColor = t.error;
        break;
      case NotificationType.info:
        icon = FeatherIcons.info;
        glowColor = t.primary;
        break;
    }

    return SlideTransition(
      position: _offsetAnimation,
      child: FadeTransition(
        opacity: _opacityAnimation,
        child: Padding(
          padding: EdgeInsets.only(
            top: MediaQuery.of(context).padding.top + 10,
            left: 20,
            right: 20,
          ),
          child: Material(
            color: Colors.transparent,
            child: GlassCard(
              borderRadius: 24,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
              hasMetallicBorder: true,
              glowColor: glowColor,
              glowRadius: 30,
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: glowColor.withOpacity(0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Icon(icon, color: glowColor, size: 18),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Text(
                      widget.message,
                      style: TextStyle(
                        color: t.text,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => _controller.reverse().then((_) => widget.onDismiss()),
                    child: Icon(
                      FeatherIcons.x,
                      color: t.textTertiary,
                      size: 16,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
