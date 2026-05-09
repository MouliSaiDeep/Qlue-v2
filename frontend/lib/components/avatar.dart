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
    
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      if (imageUrl!.startsWith('http') || imageUrl!.startsWith('https')) {
        imageWidget = Image.network(
          imageUrl!,
          fit: BoxFit.cover,
          width: size,
          height: size,
          errorBuilder: (context, error, stackTrace) => Icon(Icons.person, size: size * 0.6, color: Colors.white),
        );
      } else if (!kIsWeb && (imageUrl!.startsWith('/') || (imageUrl!.length > 1 && imageUrl![1] == ':'))) {
        imageWidget = Image.file(File(imageUrl!), fit: BoxFit.cover, width: size, height: size);
      } else if (!kIsWeb) {
        imageWidget = Image.file(File(imageUrl!), fit: BoxFit.cover, width: size, height: size);
      } else {
        // Web fallback
        imageWidget = Container(
          color: const Color(0xFF7C3AED),
          child: Icon(Icons.person, size: size * 0.6, color: Colors.white),
        );
      }
    } else {
      // Default Generic Avatar (Local to avoid network issues or X marks)
      imageWidget = Container(
        color: const Color(0xFF7C3AED),
        child: Icon(Icons.person, size: size * 0.6, color: Colors.white),
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
