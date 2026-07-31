import 'package:flutter/material.dart';
import '../core/theme.dart';

class SpectralBackground extends StatelessWidget {
  final Widget child;
  final bool showGlow;
  final double opacity;

  const SpectralBackground({
    super.key,
    required this.child,
    this.showGlow = true,
    this.opacity = 0.12,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    
    return Container(
      color: Colors.black, // Root OLED black
      child: Stack(
        children: [
          if (showGlow) ...[
            // --- TOP-RIGHT ATMOSPHERE ---
            // LAYER 1: TOP-HORIZONTAL ATMOSPHERIC WASH
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: MediaQuery.of(context).size.height * 0.3,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      t.accentGreen.withOpacity(opacity * 0.5), // Reduced intensity
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
            
            // LAYER 2: WIDE MIST (TOP-RIGHT)
            Positioned(
              top: -150,
              right: -150,
              child: Container(
                width: MediaQuery.of(context).size.width,
                height: 400,
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment.center,
                    radius: 1.2,
                    colors: [
                      t.accentGreen.withOpacity(opacity * 0.4),
                      Colors.transparent,
                    ],
                    stops: const [0.0, 0.9],
                  ),
                ),
              ),
            ),

            // --- BOTTOM-LEFT ATMOSPHERE ---
            // LAYER 3: BOTTOM-LEFT MIST WASH
            // Restricted width to avoid "bottom center" feel
            Positioned(
              bottom: -150,
              left: -150,
              child: Container(
                width: MediaQuery.of(context).size.width,
                height: 400,
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment.center,
                    radius: 1.2,
                    colors: [
                      t.accentGreen.withOpacity(opacity * 0.4),
                      Colors.transparent,
                    ],
                    stops: const [0.0, 0.9],
                  ),
                ),
              ),
            ),
            
            // LAYER 4: BOTTOM-LEFT LINEAR WASH (ANGLED)
            Positioned(
              bottom: 0,
              left: 0,
              width: MediaQuery.of(context).size.width * 0.6,
              height: MediaQuery.of(context).size.height * 0.25,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.bottomLeft,
                    end: Alignment.topRight,
                    colors: [
                      t.accentGreen.withOpacity(opacity * 0.3),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ],
          
          // THE CONTENT LAYER
          child,
        ],
      ),
    );
  }
}
