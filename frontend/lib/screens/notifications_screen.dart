import 'dart:async';

import 'package:feather_icons/feather_icons.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../components/app_update_dialogs.dart';
import '../components/data_loading.dart';
import '../components/glass_card.dart';
import '../components/spectral_background.dart';
import '../context/notification_inbox_provider.dart';
import '../core/models/session_model.dart';
import '../core/theme.dart';
import '../core/update_service.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late final AppLifecycleListener _lifecycleListener;
  bool _installing = false;

  @override
  void initState() {
    super.initState();
    _lifecycleListener = AppLifecycleListener(onResume: _refresh);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _refresh();
    });
  }

  void _refresh() =>
      unawaited(context.read<NotificationInboxProvider>().refresh());

  @override
  void dispose() {
    _lifecycleListener.dispose();
    super.dispose();
  }

  Future<void> _open(
    InboxNotification item,
    NotificationInboxProvider inbox,
  ) async {
    inbox.markRead(item);
    switch (item) {
      case FeedbackNotification(:final session):
        await context.push(
          '/feedback/${Uri.encodeComponent(session.sessionId)}',
          extra: session,
        );
        if (mounted) _refresh();
      case AppUpdateNotification(:final update):
        final confirmed = await showUpdateDetails(context, update);
        if (!mounted || !confirmed || _installing) return;
        setState(() => _installing = true);
        try {
          await downloadAndInstallUpdate(context, UpdateService.shared, update);
        } finally {
          if (mounted) setState(() => _installing = false);
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    final inbox = context.watch<NotificationInboxProvider>();
    final colors = AppThemeColors.of(context);
    final items = inbox.items;
    final error = inbox.error;
    final showInitialLoading =
        items.isEmpty && !inbox.hasLoadedFeedback && error == null;

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          foregroundColor: colors.text,
          title: const Text('Notifications'),
          leading: BackButton(
            onPressed: () {
              if (context.canPop()) {
                context.pop();
              } else {
                context.go('/dashboard');
              }
            },
          ),
        ),
        body: SafeArea(
          top: false,
          child: RefreshIndicator(
            onRefresh: inbox.refresh,
            child: ListView.builder(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: items.length + 1,
              itemBuilder: (context, index) {
                if (index < items.length) {
                  final item = items[index];
                  return _NotificationTile(
                    key: ValueKey(item.id),
                    item: item,
                    unread: inbox.isUnread(item),
                    onTap: _installing ? null : () => _open(item, inbox),
                  );
                }
                if (showInitialLoading) {
                  return const DataLoadingSkeleton(
                    label: 'Loading notifications',
                    rowHeight: 80,
                  );
                }
                if (error != null) {
                  return DataLoadError(message: error, onRetry: inbox.retry);
                }
                if (inbox.isLoading) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: LinearProgressIndicator(
                      semanticsLabel: 'Loading notifications',
                    ),
                  );
                }
                if (inbox.canLoadOlder) {
                  return Center(
                    child: TextButton(
                      onPressed: inbox.loadOlder,
                      child: const Text('Load older'),
                    ),
                  );
                }
                if (items.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.fromLTRB(24, 64, 24, 24),
                    child: Column(
                      children: [
                        Icon(
                          FeatherIcons.bell,
                          color: colors.textSecondary,
                          size: 32,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'No notifications yet',
                          style: Theme.of(
                            context,
                          ).textTheme.titleMedium?.copyWith(color: colors.text),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Feedback activity and app updates will appear here.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: colors.textSecondary),
                        ),
                      ],
                    ),
                  );
                }
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    super.key,
    required this.item,
    required this.unread,
    required this.onTap,
  });

  final InboxNotification item;
  final bool unread;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = AppThemeColors.of(context);
    final (title, detail, icon) = switch (item) {
      FeedbackNotification(
        :final session,
        status: SessionFeedbackStatus.generating,
      ) =>
        ('Generating feedback', session.topic, FeatherIcons.clock),
      FeedbackNotification(
        :final session,
        status: SessionFeedbackStatus.ready,
      ) =>
        ('Feedback ready', session.topic, FeatherIcons.fileText),
      FeedbackNotification(
        :final session,
        status: SessionFeedbackStatus.unavailable,
      ) =>
        ('Feedback unavailable', session.topic, FeatherIcons.alertCircle),
      AppUpdateNotification(:final update) => (
        'App update available',
        update.versionLabel,
        FeatherIcons.download,
      ),
    };
    final date = item.date;

    return GlassCard(
      margin: const EdgeInsets.only(bottom: 8),
      padding: EdgeInsets.zero,
      child: ListTile(
        onTap: onTap,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Icon(icon, color: colors.textSecondary, size: 20),
        title: Semantics(
          label: unread ? 'Unread' : null,
          child: Text(
            title,
            style: TextStyle(
              color: colors.text,
              fontWeight: unread ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
        subtitle: Text(
          date == null
              ? detail
              : '$detail\n${DateFormat.yMMMd().format(date.toLocal())}',
          style: TextStyle(color: colors.textSecondary),
        ),
        isThreeLine: date != null,
        trailing: Badge(
          isLabelVisible: unread,
          backgroundColor: AppColors.moduleResume,
          child: Icon(
            FeatherIcons.chevronRight,
            color: colors.textSecondary,
            size: 20,
          ),
        ),
      ),
    );
  }
}
