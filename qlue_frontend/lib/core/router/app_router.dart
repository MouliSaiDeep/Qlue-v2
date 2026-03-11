import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

final router = GoRouter(
  initialLocation: '/splash',
  routes: [
    GoRoute(
      path: '/splash',
      builder: (context, state) =>
          const Scaffold(body: Center(child: Text("Splash"))),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) =>
          const Scaffold(body: Center(child: Text("Login"))),
    ),
    GoRoute(
      path: '/register',
      builder: (context, state) =>
          const Scaffold(body: Center(child: Text("Register"))),
    ),
    GoRoute(
      path: '/home',
      builder: (context, state) =>
          const Scaffold(body: Center(child: Text("Home"))),
    ),
    GoRoute(
      path: '/interview',
      builder: (context, state) =>
          const Scaffold(body: Center(child: Text("Interview"))),
    ),
    GoRoute(
      path: '/analytics',
      builder: (context, state) =>
          const Scaffold(body: Center(child: Text("analytics"))),
    ),
  ],
);
