import 'package:flutter/material.dart';
import '../../features/interview/providers/interview_provider.dart';
import '../../shared/services/screen_awake_service.dart';

final interviewRouteObserver = RouteObserver<PageRoute<dynamic>>();

/// The lease is confined to this visible foreground interview route.
class InterviewScreenAwake extends StatefulWidget {
  const InterviewScreenAwake({
    super.key,
    required this.provider,
    required this.child,
    this.service,
  });
  final InterviewProvider provider;
  final Widget child;
  final ScreenAwakeService? service;
  @override
  State<InterviewScreenAwake> createState() => _InterviewScreenAwakeState();
}

class _InterviewScreenAwakeState extends State<InterviewScreenAwake>
    with WidgetsBindingObserver, RouteAware {
  final _owner = Object();
  late final ScreenAwakeService _service;
  late final int _generation;
  PageRoute<dynamic>? _route;
  bool _visible = true;
  bool _foreground = true;
  bool get _valid => widget.provider.sessionGeneration == _generation;
  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ScreenAwakeService.shared;
    _generation = widget.provider.sessionGeneration;
    _foreground =
        WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
    widget.provider.addListener(_sync);
    _service.addListener(_onPlatformChange);
    _sync();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route is PageRoute && !identical(route, _route)) {
      interviewRouteObserver.unsubscribe(this);
      _route = route;
      _visible = route.isCurrent;
      interviewRouteObserver.subscribe(this, route);
      _sync();
    }
  }

  void _sync({bool force = false}) => _service.update(
    _owner,
    _valid && _visible && _foreground && widget.provider.needsScreenAwake,
    force: force,
  );
  void _onPlatformChange() {
    if (mounted) setState(() {});
  }

  @override
  void didPushNext() {
    _visible = false;
    if (_valid) widget.provider.handleLifecycleState(AppLifecycleState.hidden);
    _sync();
  }

  @override
  void didPopNext() {
    _visible = true;
    if (_valid && _foreground) {
      widget.provider.handleLifecycleState(AppLifecycleState.resumed);
    }
    _sync(force: true);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_valid) {
      widget.provider.handleLifecycleState(
        _foreground && !_visible ? AppLifecycleState.hidden : state,
      );
    }
    _sync(force: _foreground);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    interviewRouteObserver.unsubscribe(this);
    widget.provider.removeListener(_sync);
    _service.removeListener(_onPlatformChange);
    _service.release(_owner);
    if (_valid) widget.provider.leaveRoute();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      widget.child,
      if (_valid &&
          _visible &&
          _foreground &&
          widget.provider.needsScreenAwake &&
          _service.error != null)
        Positioned(
          top: 48,
          left: 16,
          right: 16,
          child: Material(
            color: Colors.black87,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                _service.error!,
                key: const Key('screen-awake-error'),
                style: const TextStyle(color: Colors.orangeAccent),
              ),
            ),
          ),
        ),
    ],
  );
}
