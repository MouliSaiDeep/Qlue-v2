import 'dart:async';

import 'package:feather_icons/feather_icons.dart';
import 'package:flutter/material.dart';

import '../../components/app_update_dialogs.dart';
import '../../components/glass_card.dart';
import '../../core/theme.dart';
import '../../core/update_service.dart';

class DashboardUpdateNotice extends StatefulWidget {
  const DashboardUpdateNotice({super.key, this.updateService});

  final UpdateService? updateService;

  @override
  State<DashboardUpdateNotice> createState() => _DashboardUpdateNoticeState();
}

class _DashboardUpdateNoticeState extends State<DashboardUpdateNotice> {
  AppLifecycleListener? _lifecycleListener;
  bool _checking = false;
  bool _updating = false;

  UpdateService get _service => widget.updateService ?? UpdateService.shared;

  @override
  void initState() {
    super.initState();
    if (!UpdateService.isSupported) return;
    _lifecycleListener = AppLifecycleListener(onResume: _checkForUpdate);
    unawaited(_checkForUpdate());
  }

  @override
  void dispose() {
    _lifecycleListener?.dispose();
    super.dispose();
  }

  Future<void> _checkForUpdate() async {
    if (_checking) return;
    _checking = true;
    try {
      await _service.checkForUpdate();
    } catch (_) {
      // A failed background check should never interrupt the dashboard.
    } finally {
      _checking = false;
    }
  }

  Future<void> _startUpdate(UpdateInfo update) async {
    if (_updating) return;
    setState(() => _updating = true);
    try {
      await downloadAndInstallUpdate(context, _service, update);
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!UpdateService.isSupported) return const SizedBox.shrink();
    return ValueListenableBuilder<UpdateInfo?>(
      valueListenable: _service.availableUpdate,
      builder: (context, update, _) => update == null
          ? const SizedBox.shrink()
          : _buildNotice(context, update),
    );
  }

  Widget _buildNotice(BuildContext context, UpdateInfo update) {
    final t = AppThemeColors.of(context);
    final notes = update.releaseNotes.replaceFirst(
      RegExp(r'^#{1,6} .+\r?\n\s*'),
      '',
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
      child: GlassCard(
        hasMetallicBorder: true,
        child: Semantics(
          container: true,
          liveRegion: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(FeatherIcons.download, color: t.text, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Update available',
                      style: TextStyle(
                        color: t.text,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                update.versionLabel,
                style: TextStyle(color: t.textSecondary),
              ),
              if (notes.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  notes,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: t.textSecondary),
                ),
              ],
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.moduleResume,
                      foregroundColor: Colors.white,
                    ),
                    onPressed: _updating ? null : () => _startUpdate(update),
                    child: const Text('Update'),
                  ),
                  if (notes.isNotEmpty)
                    TextButton(
                      onPressed: _updating
                          ? null
                          : () async {
                              final confirmed = await showUpdateDetails(
                                context,
                                update,
                              );
                              if (confirmed && mounted) {
                                await _startUpdate(update);
                              }
                            },
                      child: const Text('Release notes'),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
