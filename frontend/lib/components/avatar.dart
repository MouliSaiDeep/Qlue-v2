import 'package:flutter/material.dart';

class Avatar extends StatelessWidget {
  final String? imageUrl;
  final double size;
  final double borderRadius;
  final bool isCircle;
  final Border? border;

  const Avatar({
    super.key,
    this.imageUrl,
    this.size = 80,
    this.borderRadius = 20,
    this.isCircle = false,
    this.border,
  });

  @override
  Widget build(BuildContext context) {
    ImageProvider image;
    
    if (imageUrl != null && (imageUrl!.startsWith('http') || imageUrl!.startsWith('https'))) {
      image = NetworkImage(imageUrl!);
    } else {
      // Placeholder or default image (avoid FileImage on web as dart:io is unsupported)
      image = const NetworkImage("https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=200&h=200&auto=format&fit=crop");
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
