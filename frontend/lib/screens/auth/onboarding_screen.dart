import 'package:flutter/material.dart';

class ExactOnboardingScreen extends StatefulWidget {
  const ExactOnboardingScreen({super.key});

  @override
  State<ExactOnboardingScreen> createState() => _ExactOnboardingScreenState();
}

class _ExactOnboardingScreenState extends State<ExactOnboardingScreen> with SingleTickerProviderStateMixin {
  late AnimationController _btnAnimController;
  late Animation<double> _btnScaleAnim;

  @override
  void initState() {
    super.initState();
    _btnAnimController = AnimationController(vsync: this, duration: const Duration(milliseconds: 100));
    _btnScaleAnim = Tween<double>(begin: 1.0, end: 0.95).animate(CurvedAnimation(parent: _btnAnimController, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _btnAnimController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const Color darkBg = Color(0xFF1C202B);
    const Color darkPill = Color(0xFF393E4D);

    return Scaffold(
      backgroundColor: darkBg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 20),
            // Header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                'Qlue',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Colors.white.withOpacity(0.9)),
              ),
            ),
            const SizedBox(height: 40),
            
            // Big Heading
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                'Control\nEverything in\nOne Place',
                style: TextStyle(fontSize: 42, fontWeight: FontWeight.w500, height: 1.15, letterSpacing: -1, color: Colors.white),
              ),
            ),
            
            // Image Placeholder (to match the vacuum cleaner space in design)
            Expanded(
              child: Center(
                child: Icon(Icons.blur_on_sharp, size: 120, color: Colors.white.withOpacity(0.05)),
              ),
            ),
            
            // Start Slider Button
            Padding(
              padding: const EdgeInsets.only(bottom: 40, left: 24, right: 24),
              child: GestureDetector(
                onTapDown: (_) => _btnAnimController.forward(),
                onTapUp: (_) {
                  _btnAnimController.reverse();
                  Navigator.of(context).pushReplacementNamed('/login');
                },
                onTapCancel: () => _btnAnimController.reverse(),
                child: AnimatedBuilder(
                  animation: _btnScaleAnim,
                  builder: (context, child) => Transform.scale(scale: _btnScaleAnim.value, child: child),
                  child: Container(
                    height: 64,
                    decoration: BoxDecoration(color: darkPill, borderRadius: BorderRadius.circular(32)),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const SizedBox(width: 24, child: Center(child: Icon(Icons.arrow_back, color: Colors.white54, size: 18))),
                        
                        Container(
                          width: 48,
                          height: 48,
                          decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                          child: const Icon(Icons.play_arrow_rounded, color: darkBg, size: 28),
                        ),
                        
                        RichText(
                          text: const TextSpan(
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.white),
                            children: [
                              TextSpan(text: 'Start   '),
                              TextSpan(text: '>>>', style: TextStyle(color: Colors.white54, fontSize: 14)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 24), // Balance spacing
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
