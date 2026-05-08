import 'package:flutter/material.dart';
import '../../core/theme.dart';

class InputField extends StatefulWidget {
  final IconData? icon;
  final String label;
  final String placeholder;
  final String value;
  final ValueChanged<String> onChangeText;
  final bool secure;
  final TextInputType keyboard;
  final Widget? right;
  final TextCapitalization capitalize;
  final double borderRadius;
  final Color? bgColor;
  final bool showBorder;

  const InputField({
    super.key,
    this.icon,
    required this.label,
    required this.placeholder,
    required this.value,
    required this.onChangeText,
    this.secure = false,
    this.keyboard = TextInputType.text,
    this.right,
    this.capitalize = TextCapitalization.none,
    this.borderRadius = 14,
    this.bgColor,
    this.showBorder = true,
  });

  @override
  State<InputField> createState() => _InputFieldState();
}

class _InputFieldState extends State<InputField> {
  bool _focused = false;
  late FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode();
    _focusNode.addListener(() {
      setState(() => _focused = _focusNode.hasFocus);
    });
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w600,
                color: t.textSecondary,
                letterSpacing: 0.3,
                fontSize: 12,
              ),
        ),
        const SizedBox(height: 8),
        Container(
          height: 52,
          decoration: BoxDecoration(
            color: widget.bgColor ?? (_focused ? t.inputFocusBg : t.inputBg),
            borderRadius: BorderRadius.circular(widget.borderRadius),
            border: widget.showBorder ? Border.all(
              color: _focused ? t.primary : t.border,
              width: 1.5,
            ) : null,
          ),
          child: Row(
            children: [
              if (widget.icon != null)
                Padding(
                  padding: const EdgeInsets.only(left: 14, right: 10),
                  child: Icon(widget.icon, size: 17, color: _focused ? t.primary : t.iconDefault),
                )
              else
                const SizedBox(width: 14),
              Expanded(
                child: TextField(
                  focusNode: _focusNode,
                  onChanged: widget.onChangeText,
                  obscureText: widget.secure,
                  keyboardType: widget.keyboard,
                  textCapitalization: widget.capitalize,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontSize: 15, color: t.text),
                  decoration: InputDecoration(
                    border: InputBorder.none,
                    hintText: widget.placeholder,
                    hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(fontSize: 15, color: t.placeholder),
                    contentPadding: const EdgeInsets.symmetric(vertical: 14),
                    isDense: true,
                  ),
                ),
              ),
              if (widget.right != null) widget.right!,
            ],
          ),
        ),
      ],
    );
  }
}
