import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'context/auth_provider.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
import 'screens/tabs/tabs_screen.dart';
import 'screens/tabs/dashboard_screen.dart';
import 'screens/tabs/ai_modules_screen.dart';
import 'screens/tabs/history_screen.dart';
import 'screens/tabs/profile_screen.dart';
import 'screens/interview/interview_session_screen.dart';
import 'screens/resume/resume_upload_screen.dart';
import 'screens/resume/resume_detail_screen.dart';
import 'screens/feedback/feedback_report_screen.dart';
import 'context/dashboard_provider.dart';
import 'core/models/session_model.dart';

CustomTransitionPage _buildSlideTransitionPage({
  required GoRouterState state,
  required Widget child,
  required int targetIndex,
}) {
  return CustomTransitionPage(
    key: state.pageKey,
    child: RepaintBoundary(child: child),
    transitionDuration: const Duration(milliseconds: 280),
    reverseTransitionDuration: const Duration(milliseconds: 280),
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      // Determine direction based on the current active index and this page's index
      // But for secondary animation (exiting), we need to know the NEXT index
      final targetIsHigher = TabsScreen.currentIndex > targetIndex;

      // 1. INCOMING SLIDE (from animation)
      // If this page is the one being navigated TO
      final lastIndex = TabsScreen.lastIndex;
      final slideInFromRight = targetIndex > lastIndex;
      final beginIncoming = slideInFromRight ? const Offset(1.0, 0.0) : const Offset(-1.0, 0.0);
      
      final incomingTransition = animation.drive(
        Tween(begin: beginIncoming, end: Offset.zero).chain(CurveTween(curve: Curves.easeOutQuart))
      );

      // 2. OUTGOING SLIDE (from secondaryAnimation)
      // If this page is the one being navigated AWAY FROM
      // If we are moving to a higher index, slide this page to the left
      final beginOutgoing = Offset.zero;
      final endOutgoing = targetIsHigher ? const Offset(-1.0, 0.0) : const Offset(1.0, 0.0);
      
      final outgoingTransition = secondaryAnimation.drive(
        Tween(begin: beginOutgoing, end: endOutgoing).chain(CurveTween(curve: Curves.easeOutQuart))
      );

      return SlideTransition(
        position: incomingTransition,
        child: SlideTransition(
          position: outgoingTransition,
          child: child,
        ),
      );
    },

  );
}

GoRouter buildAppRouter(AuthProvider authProvider) {
  return GoRouter(
    initialLocation: '/login',
    refreshListenable: authProvider,
    redirect: (context, state) {
      final isAuthenticated = authProvider.isAuthenticated;
      final isAuthPage = state.matchedLocation == '/login' || 
                         state.matchedLocation == '/register';

      if (!isAuthenticated && !isAuthPage) {
        return '/login';
      }
      
      if (isAuthenticated && isAuthPage) {
        return '/dashboard';
      }

      return null;
    },
    routes: [

      GoRoute(
        path: '/login',
        builder: (context, state) => const ExactLoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const ExactRegisterScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => TabsScreen(child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            pageBuilder: (context, state) => _buildSlideTransitionPage(
              state: state,
              child: const DashboardScreen(),
              targetIndex: 0,
            ),
          ),
          GoRoute(
            path: '/practice',
            pageBuilder: (context, state) => _buildSlideTransitionPage(
              state: state,
              child: const AIModulesScreen(),
              targetIndex: 1,
            ),
          ),
          GoRoute(
            path: '/history',
            pageBuilder: (context, state) => _buildSlideTransitionPage(
              state: state,
              child: const HistoryScreen(),
              targetIndex: 2,
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/profile',
        builder: (context, state) => const ProfileScreen(),
      ),
      GoRoute(
        path: '/interview/session/:sessionId',
        builder: (context, state) {
          final sessionId = state.pathParameters['sessionId']!;
          final resumeId = state.uri.queryParameters['resumeId'];
          final websiteUrl = state.uri.queryParameters['websiteUrl'];
          
          return InterviewSessionScreen(
            interviewId: sessionId,
            resumeId: resumeId,
            websiteUrl: websiteUrl,
          );
        },
      ),
      GoRoute(
        path: '/resume/upload',
        builder: (context, state) => const ResumeUploadScreen(),
      ),
      GoRoute(
        path: '/resume/:resumeId',
        builder: (context, state) {
          final resumeId = state.pathParameters['resumeId']!;
          return ResumeDetailScreen(resumeId: resumeId);
        },
      ),
      GoRoute(
        path: '/feedback/:sessionId',
        builder: (context, state) {
          final sessionId = state.pathParameters['sessionId']!;
          final session = state.extra as SessionModel?;
          return FeedbackReportScreen(session: session);
        },
      ),
    ],
  );
}
