import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter/widgets.dart';

/// Static color palette – these never change regardless of theme.
class AppColors {
  static const Color primary50 = Color(0xFFF1F5F3);
  static const Color primary100 = Color(0xFFE2EBE7);
  static const Color primary200 = Color(0xFFBDD0C9);
  static const Color primary300 = Color(0xFF8BA99E);
  static const Color primary400 = Color(0xFF5D7F72);
  static const Color primary500 = Color(0xFF305148);
  static const Color primary600 = Color(0xFF294A41);
  static const Color primary700 = Color(0xFF233E37);
  static const Color primary800 = Color(0xFF1E342F);
  static const Color primary900 = Color(0xFF192A26);

  static const Color secondary400 = Color(0xFF35BC82);
  static const Color secondary500 = Color(0xFF1A9D66);
  static const Color secondary600 = Color(0xFF128050);

  static const Color tertiary400 = Color(0xFFFFB04D);
  static const Color tertiary500 = Color(0xFFFF9326);

  static const Color neutral50 = Color(0xFFF7F8FA);
  static const Color neutral100 = Color(0xFFEDF0F5);
  static const Color neutral200 = Color(0xFFD8DDE8);
  static const Color neutral300 = Color(0xFFB3BCCD);
  static const Color neutral400 = Color(0xFF7D8A9F);
  static const Color neutral500 = Color(0xFF5C6B82);
  static const Color neutral600 = Color(0xFF455266);
  static const Color neutral700 = Color(0xFF343F50);
  static const Color neutral800 = Color(0xFF242D3A);
  static const Color neutral900 = Color(0xFF151B24);

  static const Color semanticSuccess = Color(0xFF1D9D54);
  static const Color semanticError = Color(0xFFE84343);
  static const Color semanticWarning = Color(0xFFF5AC00);
  static const Color semanticInfo = Color(0xFF0095E8);

  static const Color moduleResume = Color(0xFF2668E8);
  static const Color moduleHr = Color(0xFFF53D6E);
  static const Color moduleWebsite = Color(0xFF00D9B8);

  static const Color white = Color(0xFFFFFFFF);
  static const Color black = Color(0xFF000000);
}

/// Dynamic theme colors – change based on dark/light mode.
/// Access via `AppThemeColors.of(context)`.
class AppThemeColors {
  final bool isDark;
  final Color bg;
  final Color bgSecondary;
  final Color bgTertiary;
  final Color card;
  final Color cardElevated;
  final Color border;
  final Color borderSubtle;
  final Color text;
  final Color textSecondary;
  final Color textTertiary;
  final Color textInverse;
  final Color primary;
  final Color primaryLight;
  final Color primaryMuted;
  final Color primaryDark;
  final Color secondary;
  final Color secondaryMuted;
  final Color success;
  final Color successMuted;
  final Color error;
  final Color errorMuted;
  final Color warning;
  final Color warningMuted;
  final Color moduleResume;
  final Color moduleResumeLight;
  final Color moduleHR;
  final Color moduleHRLight;
  final Color moduleWeb;
  final Color moduleWebLight;
  final Color tabBar;
  final Color tabBarBorder;
  final Color inputBg;
  final Color inputFocusBg;
  final Color placeholder;
  final Color iconDefault;
  final Color shadow;
  final Color metallicBorder;
  final Color accentGreen;

  const AppThemeColors({
    required this.isDark,
    required this.bg,
    required this.bgSecondary,
    required this.bgTertiary,
    required this.card,
    required this.cardElevated,
    required this.border,
    required this.borderSubtle,
    required this.text,
    required this.textSecondary,
    required this.textTertiary,
    required this.textInverse,
    required this.primary,
    required this.primaryLight,
    required this.primaryMuted,
    required this.primaryDark,
    required this.secondary,
    required this.secondaryMuted,
    required this.success,
    required this.successMuted,
    required this.error,
    required this.errorMuted,
    required this.warning,
    required this.warningMuted,
    required this.moduleResume,
    required this.moduleResumeLight,
    required this.moduleHR,
    required this.moduleHRLight,
    required this.moduleWeb,
    required this.moduleWebLight,
    required this.tabBar,
    required this.tabBarBorder,
    required this.inputBg,
    required this.inputFocusBg,
    required this.placeholder,
    required this.iconDefault,
    required this.shadow,
    required this.metallicBorder,
    required this.accentGreen,
  });

  List<Color> get primaryGradient => isDark
      ? const [Color(0xFF294A41), Color(0xFF305148)]
      : const [Color(0xFF305148), Color(0xFF39534D)];

  List<Color> get metallicGradient => const [
    Color(0xFFFFFFFF),
    Color(0xFFA3A3A3),
    Color(0xFFE5E5E5),
    Color(0xFF737373),
    Color(0xFFFFFFFF),
  ];

  List<Color> get chromeGradient => const [
    Color(0xFFFFFFFF),
    Color(0xFFD1D1D1),
    Color(0xFFFFFFFF),
    Color(0xFF8E8E8E),
    Color(0xFFFFFFFF),
  ];

  static const AppThemeColors light = AppThemeColors(
    isDark: false,
    bg: Color(0xFFFFFFFF), // Pure White
    bgSecondary: Color(0xFFFAFAFA), // Stark light gray
    bgTertiary: Color(0xFFF4F4F5),
    card: Color(0xFFFFFFFF),
    cardElevated: Color(0xFFFFFFFF),
    border: Color(0xFFE5E5E5), // Very light clean border
    borderSubtle: Color(0xFFF4F4F5),
    text: Color(0xFF000000), // Pure Black for absolute contrast
    textSecondary: Color(0xFF525252),
    textTertiary: Color(0xFFA1A1AA),
    textInverse: Color(0xFFFFFFFF),
    primary: Color(0xFF305148),
    primaryLight: Color(0x1F305148),
    primaryMuted: Color(0x19305148),
    primaryDark: Color(0xFF294A41),
    secondary: Color(0xFF34C759),
    secondaryMuted: Color(0x1934C759),
    success: Color(0xFF34C759),
    successMuted: Color(0x1934C759),
    error: Color(0xFFFF3B30),
    errorMuted: Color(0x19FF3B30),
    warning: Color(0xFFFF9500),
    warningMuted: Color(0x19FF9500),
    moduleResume: Color(0xFF007AFF),
    moduleResumeLight: Color(0x1A007AFF),
    moduleHR: Color(0xFFFF2D55),
    moduleHRLight: Color(0x1AFF2D55),
    moduleWeb: Color.fromARGB(255, 44, 40, 247),
    moduleWebLight: Color.fromARGB(255, 8, 4, 251),
    tabBar: Color(0xFFFFFFFF),
    tabBarBorder: Color(0xFFE5E5E5),
    inputBg: Color(0xFFFAFAFA),
    inputFocusBg: Color(0xFFF4F4F5),
    placeholder: Color(0xFFA1A1AA),
    iconDefault: Color(0xFF000000),
    shadow: Color(0x1A000000),
    metallicBorder: Color(0xFFD1D5DB),
    accentGreen: Color(0xFF10B981),
  );

  static const AppThemeColors dark = AppThemeColors(
    isDark: true,
    bg: Color(0xFF000000), // Pure OLED Black
    bgSecondary: Color(0xFF101010), // Extremely dark gray
    bgTertiary: Color(0xFF1A1A1A),
    card: Color(0xFF000000), // Flat cards, let borders define bounds
    cardElevated: Color(0xFF121212),
    border: Color(0xFF262626), // Very dark distinct border
    borderSubtle: Color(0xFF1A1A1A),
    text: Color(0xFFFFFFFF), // Pure White
    textSecondary: Color(0xFFA3A3A3),
    textTertiary: Color(0xFF525252),
    textInverse: Color(0xFF000000),
    primary: Color(0xFF2F4C44),
    primaryLight: Color(0x1F2F4C44),
    primaryMuted: Color(0x262F4C44),
    primaryDark: Color(0xFF294A41),
    secondary: Color(0xFF30D158),
    secondaryMuted: Color(0x1F30D158),
    success: Color(0xFF30D158),
    successMuted: Color(0x1F30D158),
    error: Color(0xFFFF453A),
    errorMuted: Color(0x1FFF453A),
    warning: Color(0xFFFF9F0A),
    warningMuted: Color(0x1FFF9F0A),
    moduleResume: Color(0xFF0A84FF),
    moduleResumeLight: Color(0x1F0A84FF),
    moduleHR: Color(0xFFFF375F),
    moduleHRLight: Color(0x1FFF375F),
    moduleWeb: Color(0xFF5E5CE6),
    moduleWebLight: Color(0x1F5E5CE6),
    tabBar: Color(0xFF000000),
    tabBarBorder: Color(0xFF262626),
    inputBg: Color(0xFF121212),
    inputFocusBg: Color(0x1A0A84FF),
    placeholder: Color(0xFF525252),
    iconDefault: Color(0xFFFFFFFF),
    shadow: Color(0x66000000),
    metallicBorder: Color(0xFF4B5563),
    accentGreen: Color(0xFF10B981),
  );

  /// Get theme colors from the nearest ancestor context.
  static AppThemeColors of(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<AppThemeColorsProvider>()!
        .colors;
  }
}

/// InheritedWidget to provide theme colors down the tree.
class AppThemeColorsProvider extends InheritedWidget {
  final AppThemeColors colors;

  const AppThemeColorsProvider({
    super.key,
    required this.colors,
    required super.child,
  });

  @override
  bool updateShouldNotify(AppThemeColorsProvider oldWidget) {
    return colors.isDark != oldWidget.colors.isDark;
  }
}

/// Theme notifier that toggles dark/light mode.
class ThemeNotifier extends ChangeNotifier {
  bool _isDark = false;

  ThemeNotifier() {
    _isDark =
        WidgetsBinding.instance.window.platformBrightness == Brightness.dark;
  }

  bool get isDark => _isDark;

  ThemeMode get themeMode => _isDark ? ThemeMode.dark : ThemeMode.light;

  AppThemeColors get colors =>
      _isDark ? AppThemeColors.dark : AppThemeColors.light;

  void toggle() {
    _isDark = !_isDark;
    notifyListeners();
  }

  void setDark(bool value) {
    if (_isDark != value) {
      _isDark = value;
      notifyListeners();
    }
  }
}

class AppTheme {
  static ThemeData get lightTheme {
    return ThemeData(
      brightness: Brightness.light,
      primaryColor: const Color(0xFF007AFF),
      scaffoldBackgroundColor: const Color(0xFFFFFFFF), // Pure White
      colorScheme: const ColorScheme.light(
        primary: Color(0xFF007AFF),
        secondary: Color(0xFF34C759),
        surface: Color(0xFFFFFFFF),
        error: Color(0xFFFF3B30),
        onPrimary: Color(0xFFFFFFFF),
        onSecondary: Color(0xFFFFFFFF),
        onSurface: Color(0xFF000000),
        onError: Color(0xFFFFFFFF),
      ),
      textTheme: GoogleFonts.montserratTextTheme(),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFFFFFFFF),
        foregroundColor: Color(0xFF000000),
        elevation: 0,
        centerTitle: true,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF007AFF),
          foregroundColor: Color(0xFFFFFFFF),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: GoogleFonts.montserrat(fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  static ThemeData get darkTheme {
    return ThemeData(
      brightness: Brightness.dark,
      primaryColor: const Color(0xFF0A84FF),
      scaffoldBackgroundColor: const Color(0xFF000000), // Pure Black
      colorScheme: const ColorScheme.dark(
        primary: Color(0xFF0A84FF),
        secondary: Color(0xFF30D158),
        surface: Color(0xFF000000),
        error: Color(0xFFFF453A),
        onPrimary: Colors.white,
        onSecondary: Colors.white,
        onSurface: Colors.white,
        onError: Colors.white,
      ),
      textTheme: GoogleFonts.montserratTextTheme(ThemeData.dark().textTheme),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF000000), // Pure Black
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF3B82F6),
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: GoogleFonts.montserrat(fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
