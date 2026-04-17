import 'package:flutter/material.dart';
import 'dart:math';

class PremiumFlipCard extends StatefulWidget {
  final Widget front;
  final Widget back;
  final Duration duration;
  final bool enableScale;
  final Function(bool isFront)? onFlip;

  const PremiumFlipCard({
    super.key,
    required this.front,
    required this.back,
    this.duration = const Duration(milliseconds: 600),
    this.enableScale = true,
    this.onFlip,
  });

  @override
  State<PremiumFlipCard> createState() => _PremiumFlipCardState();
}

class _PremiumFlipCardState extends State<PremiumFlipCard> with TickerProviderStateMixin {
  late AnimationController _flipCtrl;
  late Animation<double> _flipAnim;
  
  late AnimationController _scaleCtrl;
  late Animation<double> _scaleAnim;
  
  bool _isFront = true;

  @override
  void initState() {
    super.initState();
    _flipCtrl = AnimationController(vsync: this, duration: widget.duration);
    _flipAnim = Tween<double>(begin: 0, end: 1).animate(CurvedAnimation(parent: _flipCtrl, curve: Curves.easeOutBack));

    _scaleCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 150));
    _scaleAnim = Tween<double>(begin: 1.0, end: 0.95).animate(CurvedAnimation(parent: _scaleCtrl, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _flipCtrl.dispose();
    _scaleCtrl.dispose();
    super.dispose();
  }

  void _onTapDown(TapDownDetails details) {
    if (widget.enableScale && !_flipCtrl.isAnimating) _scaleCtrl.forward();
  }

  void _onTapUp(TapUpDetails details) {
    if (widget.enableScale) _scaleCtrl.reverse();
    if (_flipCtrl.isAnimating) return;
    if (_isFront) {
      _flipCtrl.forward();
    } else {
      _flipCtrl.reverse();
    }
    _isFront = !_isFront;
    if (widget.onFlip != null) widget.onFlip!(_isFront);
  }

  void _onTapCancel() {
    if (widget.enableScale) _scaleCtrl.reverse();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: _onTapDown,
      onTapUp: _onTapUp,
      onTapCancel: _onTapCancel,
      behavior: HitTestBehavior.opaque,
      child: AnimatedBuilder(
        animation: Listenable.merge([_flipAnim, _scaleAnim]),
        builder: (context, child) {
          final angle = _flipAnim.value * pi;
          final zDepth = sin(angle) * -40.0;
          
          final transform = Matrix4.identity()
            ..setEntry(3, 2, 0.0015)
            ..translate(0.0, 0.0, zDepth)
            ..rotateY(angle);

          bool showBack = angle > pi / 2;
          
          double shadowSpread = sin(angle) * 12;
          double shadowBlur = 10 + (sin(angle) * 20);
          double shadowOpacity = 0.05 + (sin(angle) * 0.1);

          return Transform.scale(
            scale: _scaleAnim.value,
            alignment: Alignment.center,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(shadowOpacity),
                    blurRadius: shadowBlur,
                    spreadRadius: shadowSpread,
                    offset: Offset(0, 4 + (sin(angle)*10)),
                  ),
                ],
              ),
              child: Transform(
                transform: transform,
                alignment: FractionalOffset.center,
                child: showBack
                    ? Transform(
                        transform: Matrix4.identity()..rotateY(pi),
                        alignment: FractionalOffset.center,
                        child: widget.back,
                      )
                    : widget.front,
              ),
            ),
          );
        },
      ),
    );
  }
}
