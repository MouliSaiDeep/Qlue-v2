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
    ImageProvider image;
    
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      if (imageUrl!.startsWith('http') || imageUrl!.startsWith('https')) {
        image = NetworkImage(imageUrl!);
      } else if (!kIsWeb && (imageUrl!.startsWith('/') || (imageUrl!.length > 1 && imageUrl![1] == ':'))) {
        image = FileImage(File(imageUrl!));
      } else if (!kIsWeb) {
        image = FileImage(File(imageUrl!));
      } else {
        // Web fallback: Use letter avatar if URL detection fails or it's a local path string on web
        image = NetworkImage("https://ui-avatars.com/api/?name=${name ?? 'User'}&background=random&color=fff&size=256");
      }
    } else {
      // Default: Dynamic Letter Avatar
      image = NetworkImage("https://ui-avatars.com/api/?name=${name ?? 'User'}&background=7C3AED&color=fff&size=256");
    }

    // Optimization: Resize image before decoding to save memory
    final int cacheSize = (size * 3).toInt();
    image = ResizeImage.resizeIfNeeded(cacheSize, null, image);

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: isCircle ? BoxShape.circle : BoxShape.rectangle,
        borderRadius: isCircle ? null : BorderRadius.circular(borderRadius),
        border: border,
        image: DecorationImage(
          image: image,
          fit: BoxFit.cover,
        ),
      ),
    );
  }
}
