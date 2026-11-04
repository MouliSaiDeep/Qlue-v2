import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Static placeholders reserve the existing card geometry without animation,
/// network assets, or fabricated scores and interview content.
class DataLoadingSkeleton extends StatelessWidget {
  const DataLoadingSkeleton({
    super.key,
    required this.label,
    this.dashboard = false,
    this.rowHeight = 180,
  });

  final String label;
  final bool dashboard;
  final double rowHeight;

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    Widget block(double height) => Container(
      height: height,
      decoration: BoxDecoration(
        color: t.bgSecondary,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: t.border.withValues(alpha: 0.3)),
      ),
    );
    Widget pair(double height) => Row(
      children: [
        Expanded(child: block(height)),
        const SizedBox(width: 12),
        Expanded(child: block(height)),
      ],
    );

    return Semantics(
      label: label,
      liveRegion: true,
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 120),
          child: Column(
            children: dashboard
                ? [
                    pair(125),
                    const SizedBox(height: 28),
                    LayoutBuilder(
                      builder: (_, constraints) {
                        final height = (constraints.maxWidth - 12) / 2 / 1.6;
                        return Column(
                          children: [
                            pair(height),
                            const SizedBox(height: 12),
                            pair(height),
                          ],
                        );
                      },
                    ),
                    const SizedBox(height: 28),
                    block(220),
                  ]
                : [
                    for (var i = 0; i < 3; i++) ...[
                      block(rowHeight),
                      const SizedBox(height: 24),
                    ],
                  ],
          ),
        ),
      ),
    );
  }
}

class DataLoadError extends StatelessWidget {
  const DataLoadError({
    super.key,
    required this.message,
    required this.onRetry,
  });
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(color: t.textSecondary),
            ),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
