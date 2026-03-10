import 'package:go_router/go_router.dart';

final router= GoRouter(
  initialLocation:'/splash',
  routes:[
    GoRoute(path:'/splash'),
    GoRoute(path:'/login'),
    GoRoute(path:'/register'),
    GoRoute(path:'/home'),
    GoRoute(path:'/interview'),
    GoRoute(path:'/analytics'),
  ],
);