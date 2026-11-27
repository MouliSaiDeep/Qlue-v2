import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/core/update_service.dart';
import 'package:frontend/screens/tabs/dashboard_update_notice.dart';
import 'package:mocktail/mocktail.dart';
import 'package:package_info_plus/package_info_plus.dart';

class _MockUpdateService extends Mock implements UpdateService {}

const _update = UpdateInfo(
  version: '1.0.11',
  downloadUrl: 'https://example.test/Qlue.apk',
  releaseNotes: '# Qlue 1.0.11\n\n- Clearer feedback.\n- Faster dashboard.',
  sizeBytes: 10 * 1024 * 1024,
);

Widget _buildNotice(UpdateService service) => AppThemeColorsProvider(
  colors: AppThemeColors.dark,
  child: MaterialApp(
    home: Scaffold(body: DashboardUpdateNotice(updateService: service)),
  ),
);

void main() {
  testWidgets(
    'shows release details and starts the Android update',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final service = _MockUpdateService();
      final available = ValueNotifier<UpdateInfo?>(null);
      addTearDown(available.dispose);
      final download = Completer<String>();
      when(() => service.availableUpdate).thenReturn(available);
      when(() => service.checkForUpdate()).thenAnswer((_) async => null);
      when(
        () => service.downloadApk(
          _update.downloadUrl,
          onProgress: any(named: 'onProgress'),
        ),
      ).thenAnswer((call) {
        final progress = call.namedArguments[#onProgress] as ProgressCallback;
        progress(1, 2);
        return download.future;
      });
      when(
        () => service.installApk('Qlue.apk'),
      ).thenAnswer((_) async => InstallOutcome.launched);

      await tester.pumpWidget(_buildNotice(service));
      await tester.pumpAndSettle();
      expect(find.text('Update available'), findsNothing);
      available.value = _update;
      await tester.pumpAndSettle();
      expect(find.text('Update available'), findsOneWidget);
      expect(find.text('Version 1.0.11 (10.0 MB)'), findsOneWidget);
      expect(find.textContaining('Clearer feedback.'), findsOneWidget);

      await tester.tap(find.text('Release notes'));
      await tester.pumpAndSettle();
      expect(find.text(_update.releaseNotes), findsOneWidget);
      await tester.tap(find.text('Later'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Update'));
      await tester.pumpAndSettle();
      expect(find.text('Downloading update'), findsOneWidget);
      expect(find.text('50%'), findsOneWidget);
      verifyNever(() => service.installApk(any()));

      download.complete('Qlue.apk');
      await tester.pumpAndSettle();
      expect(find.text('Downloading update'), findsNothing);
      verify(() => service.installApk('Qlue.apk')).called(1);
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
    },
    variant: const TargetPlatformVariant({TargetPlatform.android}),
  );

  testWidgets(
    'stays hidden after a failed check and retries on resume',
    (tester) async {
      final service = _MockUpdateService();
      final available = ValueNotifier<UpdateInfo?>(null);
      addTearDown(available.dispose);
      when(() => service.availableUpdate).thenReturn(available);
      when(() => service.checkForUpdate()).thenThrow(StateError('Offline'));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpWidget(_buildNotice(service));
      await tester.pumpAndSettle();
      expect(find.text('Update available'), findsNothing);
      expect(tester.takeException(), isNull);

      when(() => service.checkForUpdate()).thenAnswer((_) async {
        available.value = _update;
        return _update;
      });
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Update available'), findsOneWidget);
    },
    variant: const TargetPlatformVariant({TargetPlatform.android}),
  );

  testWidgets(
    'skips update checks on unsupported platforms',
    (tester) async {
      final service = _MockUpdateService();

      await tester.pumpWidget(_buildNotice(service));
      await tester.pumpAndSettle();

      expect(find.text('Update available'), findsNothing);
      verifyZeroInteractions(service);
    },
    variant: const TargetPlatformVariant({TargetPlatform.iOS}),
  );

  test(
    'automatic checks share a cached result and manual checks refresh it',
    () async {
      PackageInfo.setMockInitialValues(
        appName: 'Qlue',
        packageName: 'com.qlue.sloths1',
        version: '1.0.10',
        buildNumber: '10010',
        buildSignature: '',
      );
      final dio = Dio();
      addTearDown(dio.close);
      var requests = 0;
      var releaseTag = 'v1.0.10';
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            requests++;
            handler.resolve(
              Response<dynamic>(
                requestOptions: options,
                data: {
                  'tag_name': releaseTag,
                  'body': _update.releaseNotes,
                  'assets': [
                    {
                      'name': 'Qlue.apk',
                      'browser_download_url': _update.downloadUrl,
                      'size': _update.sizeBytes,
                    },
                  ],
                },
              ),
            );
          },
        ),
      );
      final service = UpdateService(dio);

      final firstCheck = service.checkForUpdate();
      expect(service.checkForUpdate(), same(firstCheck));
      expect(await firstCheck, isNull);
      expect(await service.checkForUpdate(), isNull);
      expect(requests, 1);

      releaseTag = 'v1.0.11';
      final refreshed = await service.checkForUpdate(force: true);
      expect(refreshed?.version, _update.version);
      expect(refreshed?.releaseNotes, _update.releaseNotes);
      expect(await service.checkForUpdate(), same(refreshed));
      expect(requests, 2);
    },
  );
}
