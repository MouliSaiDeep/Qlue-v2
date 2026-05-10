import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'dart:io';

class Avatar extends StatelessWidget {
  final String? imageUrl;
  final String? name; // Added to support letter avatars
  final double size;
  final double borderRadius;
  final bool isCircle;
  final Border? border;

  const Avatar({
    super.key,
    this.imageUrl,
    this.name,
    this.size = 80,
    this.borderRadius = 20,
    this.isCircle = false,
    this.border,
  });

  @override
  Widget build(BuildContext context) {
    Widget imageWidget;
    
    // Default widget to use when an image fails to load
    Widget errorWidget = Icon(Icons.sentiment_satisfied_alt, size: size * 0.6, color: Colors.white);

    if (imageUrl != null && imageUrl!.isNotEmpty) {
      if (imageUrl!.startsWith('http') || imageUrl!.startsWith('https')) {
        imageWidget = Image.network(
          imageUrl!,
          fit: BoxFit.cover,
          width: size,
          height: size,
          errorBuilder: (context, error, stackTrace) => Container(
            color: const Color(0xFF7C3AED),
            width: size,
            height: size,
            child: Center(child: errorWidget),
          ),
        );
      } else if (!kIsWeb && (imageUrl!.startsWith('/') || (imageUrl!.length > 1 && imageUrl![1] == ':'))) {
        imageWidget = Image.file(
          File(imageUrl!),
          fit: BoxFit.cover,
          width: size,
          height: size,
          errorBuilder: (context, error, stackTrace) => Container(
            color: const Color(0xFF7C3AED),
            width: size,
            height: size,
            child: Center(child: errorWidget),
          ),
        );
      } else if (!kIsWeb) {
        imageWidget = Image.file(
          File(imageUrl!),
          fit: BoxFit.cover,
          width: size,
          height: size,
          errorBuilder: (context, error, stackTrace) => Container(
            color: const Color(0xFF7C3AED),
            width: size,
            height: size,
            child: Center(child: errorWidget),
          ),
        );
      } else {
        // Web fallback
        imageWidget = Image.network(
          "https://ui-avatars.com/api/?name=${name ?? 'User'}&background=random&color=fff&size=256",
          fit: BoxFit.cover,
          width: size,
          height: size,
          errorBuilder: (context, error, stackTrace) => Container(
            color: const Color(0xFF7C3AED),
            width: size,
            height: size,
            child: Center(child: errorWidget),
          ),
        );
      }
    } else {
      // Default: Dynamic Letter Avatar
      imageWidget = Image.network(
        "https://ui-avatars.com/api/?name=${name ?? 'User'}&background=7C3AED&color=fff&size=256",
        fit: BoxFit.cover,
        width: size,
        height: size,
        errorBuilder: (context, error, stackTrace) => Container(
          color: const Color(0xFF7C3AED),
          width: size,
          height: size,
          child: Center(child: errorWidget),
        ),
      );
    }

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: isCircle ? BoxShape.circle : BoxShape.rectangle,
        borderRadius: isCircle ? null : BorderRadius.circular(borderRadius),
        border: border,
      ),
      clipBehavior: Clip.antiAlias,
      child: imageWidget,
    );
  }
}
