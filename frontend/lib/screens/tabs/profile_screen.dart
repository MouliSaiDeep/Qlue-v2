import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'package:just_audio/just_audio.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme.dart';
import '../../context/auth_provider.dart';
import '../../context/dashboard_provider.dart';
import '../../context/resume_provider.dart';
import '../../components/input_field.dart';
import '../../core/notifications.dart';
import '../profile/help_support_screen.dart';
import '../../components/glass_card.dart';
import '../../components/avatar.dart';
import '../../components/spectral_background.dart';


class SettingRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color iconColor;
  final Color iconBg;
  final Widget? right;
  final VoidCallback? onPress;
  final bool destructive;

  const SettingRow({
    super.key,
    required this.icon,
    required this.label,
    required this.iconColor,
    required this.iconBg,
    this.right,
    this.onPress,
    this.destructive = false,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPress,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Center(
                  child: Icon(icon, size: 15, color: iconColor),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                label,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: destructive ? t.error : t.text,
                ),
              ),
              const Spacer(),
              if (right != null)
                right!
              else if (onPress != null && !destructive)
                Icon(FeatherIcons.chevronRight, size: 16, color: t.textTertiary),
            ],
          ),
        ),
      ),
    );
  }
}

class ProfileSection extends StatelessWidget {
  final String title;
  final Widget child;

  const ProfileSection({super.key, required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4.0, bottom: 8.0),
            child: Text(
              title,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.8,
                color: t.textTertiary,
              ),
            ),
          ),
          GlassCard(
            borderRadius: 18,
            padding: EdgeInsets.zero,
            hasMetallicBorder: true,
            child: child,
          ),
        ],
      ),
    );
  }
}

class ProfileDiv extends StatelessWidget {
  const ProfileDiv({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Container(
      height: 1,
      margin: const EdgeInsets.only(left: 62),
      color: t.borderSubtle,
    );
  }
}

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool notifs = true;
  bool voice = true;

  final AudioPlayer _audioPlayer = AudioPlayer();
  final TextEditingController _detailController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardProvider>().fetchDashboardData();
      context.read<ResumeProvider>().fetchResumes();
    });
  }

  void _showAvatarPicker() {
    final t = AppThemeColors.of(context);
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => GlassCard(
        borderRadius: 32,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text("Profile Identity", style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: t.text)),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _identityOption(FeatherIcons.image, "Upload Photo", t.primary, _pickImage),
                _identityOption(FeatherIcons.smile, "Avatar Library", t.accentGreen, _showAvatarLibrary),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _identityOption(IconData icon, String label, Color color, VoidCallback onTap) {
    final t = AppThemeColors.of(context);
    return GestureDetector(
      onTap: () {
        Navigator.pop(context);
        onTap();
      },
      child: Column(
        children: [
          Container(
            width: 64, height: 64,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
            child: Icon(icon, color: color, size: 28),
          ),
          const SizedBox(height: 12),
          Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: t.textSecondary)),
        ],
      ),
    );
  }

  void _showAvatarLibrary() {
    final t = AppThemeColors.of(context);
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final avatars = [
      "https://api.dicebear.com/7.x/avataaars/png?seed=Felix&backgroundColor=b6e3f4",
      "https://api.dicebear.com/7.x/avataaars/png?seed=Aneka&backgroundColor=ffdfbf",
      "https://api.dicebear.com/7.x/avataaars/png?seed=Charlie&backgroundColor=c0aede",
      "https://api.dicebear.com/7.x/avataaars/png?seed=George&backgroundColor=d1d4f9",
      "https://api.dicebear.com/7.x/avataaars/png?seed=Sophie&backgroundColor=ffd5dc",
      "https://api.dicebear.com/7.x/avataaars/png?seed=Oliver&backgroundColor=c1f4c1",
    ];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => GlassCard(
        borderRadius: 32,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text("Avatar Library", style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: t.text)),
            const SizedBox(height: 20),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3, crossAxisSpacing: 16, mainAxisSpacing: 16,
              ),
              itemCount: avatars.length,
              itemBuilder: (ctx, idx) => GestureDetector(
                onTap: () {
                  auth.updateUserProfile(imageUrl: avatars[idx]);
                  Navigator.pop(context);
                  Notify.success(context, "Avatar updated!");
                },
                child: Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: auth.profileImageUrl == avatars[idx] ? t.primary : t.border, width: 2),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: Image.network(avatars[idx]),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Future<void> _pickImage() async {
    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      
      FilePickerResult? result = await FilePicker.pickFiles(
        type: FileType.image,
        allowMultiple: false,
        withData: kIsWeb,
      );

      if (result != null && result.files.isNotEmpty) {
        final file = result.files.single;
        
        if (kIsWeb && file.bytes != null) {
          if (context.mounted) {
            Notify.info(context, "Cloud profile sync is being prioritized. Using local preview.");
          }
          auth.updateUserProfile(
            imageUrl: "https://ui-avatars.com/api/?name=${auth.displayName}&background=random",
          );
        } else if (file.path != null) {
          await auth.updateUserProfile(
            imageUrl: file.path,
          );
          if (context.mounted) Notify.success(context, "Profile picture updated!");
        }
      }
    } catch (e) {
      debugPrint("Image selection error: $e");
      if (mounted) Notify.error(context, "Could not update profile picture.");
    }
  }

  @override
  void dispose() {
    _detailController.dispose();
    _audioPlayer.dispose();
    super.dispose();
  }

  Future<void> _playPreview(String modelName) async {
    try {
      final fileName = '${modelName.toLowerCase()}.mp3';
      await _audioPlayer.stop();
      await _audioPlayer.setAsset('assets/audios/$fileName');
      await _audioPlayer.play();
    } catch (e) {
      debugPrint("Error playing preview: $e");
    }
  }

  void _showVoiceSelectionSheet() {
    final t = AppThemeColors.of(context);
    final voices = [
      {'name': 'Tiffany', 'desc': 'Warm & Professional', 'gender': 'Female'},
      {'name': 'Ruth', 'desc': 'Sophisticated & Clear', 'gender': 'Female'},
      {'name': 'Joanna', 'desc': 'Calm & Articulate', 'gender': 'Female'},
      {'name': 'Matthew', 'desc': 'Clear & Authoritative', 'gender': 'Male'},
      {'name': 'Stephen', 'desc': 'Friendly & Natural', 'gender': 'Male'},
    ];

    showModalBottomSheet(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => Consumer<AuthProvider>(
          builder: (context, auth, _) => GlassCard(
            borderRadius: 32,
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Select Voice Model', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: t.text)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: t.primary.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text('Generative', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: t.primary, letterSpacing: 0.5)),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text('Powered by Amazon Polly Generative AI', style: TextStyle(fontSize: 11, color: t.textTertiary)),
                const SizedBox(height: 20),
                
                // Scrollable list of voices
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(context).size.height * 0.5,
                  ),
                  child: SingleChildScrollView(
                    child: Column(
                      children: voices.map((v) {
                        final isSelected = auth.voiceId == v['name'];
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12.0),
                          child: GlassCard(
                            borderRadius: 16,
                            padding: const EdgeInsets.all(16),
                            tintColor: isSelected ? t.primary.withValues(alpha: 0.1) : null,
                            hasMetallicBorder: isSelected,
                            onTap: () async {
                              try {
                                final selectedVoice = v['name']!;
                                await auth.updateUserProfile(voiceId: selectedVoice);
                                if (context.mounted) {
                                  Notify.success(context, "Voice model updated to $selectedVoice");
                                }
                              } catch (e) {
                                if (context.mounted) {
                                  Notify.error(context, "Failed to update voice model");
                                }
                              }
                              if (mounted) setModalState(() {});
                            },
                            child: Row(
                              children: [
                                Container(
                                  width: 40, height: 40,
                                  decoration: BoxDecoration(
                                    color: isSelected ? t.primary : t.bgSecondary,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Icon(
                                    isSelected ? FeatherIcons.check : FeatherIcons.user,
                                    size: 18,
                                    color: isSelected ? Colors.white : t.textSecondary,
                                  ),
                                ),
                                const SizedBox(width: 16),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(v['name']!, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: t.text)),
                                      Text(v['desc']!, style: TextStyle(fontSize: 12, color: t.textTertiary)),
                                    ],
                                  ),
                                ),
                                IconButton(
                                  onPressed: () => _playPreview(v['name']!),
                                  icon: Icon(FeatherIcons.playCircle, color: t.primary),
                                  tooltip: 'Preview Voice',
                                ),
                              ],
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _handleLogout() {
    final t = AppThemeColors.of(context);
    showDialog(
      context: context,
      useRootNavigator: true,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        elevation: 0,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
        child: GlassCard(
          borderRadius: 24,
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text("Sign Out", style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: t.text)),
              const SizedBox(height: 12),
              Text("Are you sure you want to sign out?", style: TextStyle(color: t.textSecondary)),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    child: Text("Cancel", style: TextStyle(color: t.textSecondary)),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    style: TextButton.styleFrom(foregroundColor: t.error),
                    child: const Text("Sign Out"),
                    onPressed: () {
                      context.pop();
                      Provider.of<AuthProvider>(context, listen: false).logout();
                      context.go('/login');
                    },
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
  void _showSkillManagementSheet() {
    final t = AppThemeColors.of(context);
    final auth = Provider.of<AuthProvider>(context, listen: false);
    String newSkill = "";
    // Work on a local copy so we can batch-save on close
    List<String> localSkills = List.from(auth.skills);

    showModalBottomSheet(
      context: context,
      useRootNavigator: true,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
          child: GlassCard(
            borderRadius: 32,
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Manage Skills', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: t.text)),
                    Text('${localSkills.length} Total', style: TextStyle(fontSize: 12, color: t.primary, fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 20),
                
                // Add Skill Input
                InputField(
                  icon: FeatherIcons.plusCircle,
                  label: "Add New Skill",
                  placeholder: "e.g. System Design",
                  value: newSkill,
                  onChangeText: (v) => newSkill = v,
                ),
                const SizedBox(height: 12),
                ElevatedButton(
                  onPressed: () {
                    if (newSkill.trim().isNotEmpty && !localSkills.contains(newSkill.trim())) {
                      setModalState(() {
                        localSkills.add(newSkill.trim());
                        newSkill = "";
                      });
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: t.primary, foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Add to Profile'),
                ),
                
                const SizedBox(height: 24),
                Text('CURRENT SKILLS', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: t.textTertiary, letterSpacing: 1)),
                const SizedBox(height: 12),
                
                // Skills List
                ConstrainedBox(
                  constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.3),
                  child: SingleChildScrollView(
                    child: localSkills.isEmpty
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(16.0),
                              child: Text(
                                "No skills added yet. Add your first skill above!",
                                textAlign: TextAlign.center,
                                style: TextStyle(color: t.textTertiary, fontSize: 13),
                              ),
                            ),
                          )
                        : Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: localSkills.map((s) => Container(
                              padding: const EdgeInsets.only(left: 12, right: 4, top: 6, bottom: 6),
                              decoration: BoxDecoration(
                                color: t.bgSecondary,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: t.metallicBorder.withValues(alpha: 0.1)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(s, style: TextStyle(fontSize: 13, color: t.textSecondary)),
                                  const SizedBox(width: 4),
                                  GestureDetector(
                                    onTap: () => setModalState(() => localSkills.remove(s)),
                                    child: Padding(
                                      padding: const EdgeInsets.all(4.0),
                                      child: Icon(FeatherIcons.x, size: 14, color: t.error.withValues(alpha: 0.7)),
                                    ),
                                  ),
                                ],
                              ),
                            )).toList(),
                          ),
                  ),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () {
                    auth.updateUserProfile(skills: localSkills);
                    Navigator.pop(ctx);
                    Notify.success(context, 'Skills saved!');
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: t.accentGreen,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Save Skills'),
                ),
                const SizedBox(height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }


  void _showEditDetailSheet(String title, String currentVal, Function(String) onSave) {
    final t = AppThemeColors.of(context);
    _detailController.text = currentVal;
    
    showModalBottomSheet(
      context: context,
      useRootNavigator: true,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: GlassCard(
          borderRadius: 32,
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Edit $title', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: t.text)),
              const SizedBox(height: 20),
              InputField(
                icon: FeatherIcons.edit2,
                label: title,
                placeholder: "Enter $title",
                value: _detailController.text,
                onChangeText: (v) => _detailController.text = v,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: () {
                  onSave(_detailController.text.trim());
                  Navigator.pop(ctx);
                  Notify.success(context, '$title updated!');
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: t.primary, foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Save Changes', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showRatingDialog() {
    final t = AppThemeColors.of(context);
    int rating = 0;
    showDialog(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) {
          return Dialog(
            backgroundColor: Colors.transparent,
            elevation: 0,
            insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            child: GlassCard(
              borderRadius: 24,
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                Container(
                  width: 64, height: 64, margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(color: const Color(0xFFFCD34D).withValues(alpha: 0.15), shape: BoxShape.circle),
                  child: const Center(child: Icon(FeatherIcons.star, size: 32, color: Color(0xFFF59E0B))),
                ),
                Text("Rate your experience", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: t.text, letterSpacing: -0.5)),
                const SizedBox(height: 8),
                Text("How are you liking Qlue so far?", textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: t.textSecondary, height: 1.5)),
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(5, (index) {
                    return GestureDetector(
                      onTap: () => setDialogState(() => rating = index + 1),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4.0),
                        child: Icon(
                          index < rating ? Icons.star_rounded : Icons.star_border_rounded,
                          size: 40,
                          color: index < rating ? const Color(0xFFF59E0B) : t.border,
                        ),
                      ),
                    );
                  }),
                ),
                const SizedBox(height: 24),
                TextField(
                  onChanged: (v) {},
                  maxLines: 3,
                  style: TextStyle(fontSize: 14, color: t.text),
                  decoration: InputDecoration(
                    hintText: "Tell us what you think (optional)",
                    hintStyle: TextStyle(fontSize: 14, color: t.textTertiary),
                    filled: true,
                    fillColor: t.bgSecondary,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    contentPadding: const EdgeInsets.all(16),
                  ),
                ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: rating > 0 ? () {
                      Navigator.pop(ctx);
                      Notify.success(context, 'Thank you for your feedback!');
                    } : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB), foregroundColor: Colors.white,
                      disabledBackgroundColor: t.border, disabledForegroundColor: t.textTertiary,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 0,
                    ),
                    child: const Text('Submit', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: TextButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    style: TextButton.styleFrom(foregroundColor: t.textSecondary),
                    child: const Text('Not right now'),
                  ),
                ),
              ],
            ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildHeaderButton(IconData icon, AppThemeColors t, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: 44,
        height: 44,
        child: GlassCard(
          borderRadius: 12,
          padding: EdgeInsets.zero,
          hasMetallicBorder: true,
          child: Center(child: Icon(icon, size: 20, color: t.text)),
        ),
      ),
    );
  }

  Widget _buildColumnStat(String val, String label, AppThemeColors t) {
    return Column(
      children: [
        Text(val, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: t.text, letterSpacing: -0.5)),
        const SizedBox(height: 2),
        Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: t.textSecondary)),
      ],
    );
  }

  Widget _buildDivider(AppThemeColors t) {
    return Container(
      height: 24,
      width: 1,
      color: t.metallicBorder.withValues(alpha: 0.2),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final t = AppThemeColors.of(context);
    final topPadding = MediaQuery.of(context).padding.top;
    final bottomPadding = MediaQuery.of(context).padding.bottom;

    final dashboard = Provider.of<DashboardProvider>(context);
    final resumes = Provider.of<ResumeProvider>(context);

    final sessionsCount = dashboard.summary.totalSessions;
    final resumesCount = resumes.resumes.length;
    final avgScore = dashboard.summary.averageScore;

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SingleChildScrollView(
          padding: EdgeInsets.only(bottom: bottomPadding + 100),
          child: Column(
            children: [
              // HEADER ROW (Profile Title + Actions)
              Padding(
                padding: EdgeInsets.only(top: topPadding + 10, left: 24, right: 24, bottom: 20),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _buildHeaderButton(FeatherIcons.chevronLeft, t, () => context.pop()),
                    Text("Profile", style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: t.text, letterSpacing: -0.5)),
                      const SizedBox(width: 44), // Spacer to keep title centered
                    ],
                ),
              ),

              // INFO SECTION (Avatar Left, Info Right)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    GestureDetector(
                      onTap: _showAvatarPicker,
                      child: Stack(
                        children: [
                          Avatar(imageUrl: auth.profileImageUrl, name: auth.displayName, size: 88, borderRadius: 20),
                          Positioned(
                            bottom: 4, right: 4,
                            child: Container(
                              padding: const EdgeInsets.all(4),
                              decoration: BoxDecoration(color: t.primary, shape: BoxShape.circle, border: Border.all(color: Colors.black, width: 2)),
                              child: const Icon(FeatherIcons.camera, size: 12, color: Colors.white),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 20),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          GestureDetector(
                            onTap: () => _showEditDetailSheet("Name", auth.displayName, (v) {
                              auth.updateUserProfile(name: v);
                            }),
                            child: Row(
                              children: [
                                Text(auth.displayName, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: t.text, letterSpacing: -0.5)),
                                const SizedBox(width: 8),
                                Icon(FeatherIcons.edit3, size: 14, color: t.primary.withValues(alpha: 0.5)),
                              ],
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            auth.profession.isNotEmpty ? auth.profession : "Tap to add profession",
                            style: TextStyle(
                              fontSize: 14,
                              color: auth.profession.isNotEmpty ? t.primary : t.textTertiary,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.2,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text("Interview Ready", style: TextStyle(fontSize: 13, color: t.textSecondary, fontWeight: FontWeight.w500)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 32),

              // STATS ROW (Cinematic Glow)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: GlassCard(
                  borderRadius: 24,
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  hasMetallicBorder: true,
                  glowColor: t.primary,
                  glowRadius: 25,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      _buildColumnStat(sessionsCount.toString(), "Sessions", t),
                      _buildDivider(t),
                      _buildColumnStat(resumesCount.toString(), "Resumes", t),
                      _buildDivider(t),
                      _buildColumnStat(avgScore > 0 ? "$avgScore%" : "—", "Avg Score", t),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Career Profile Section
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ProfileSection(
                  title: "Career Profile",
                  child: Column(
                    children: [
                      SettingRow(
                        icon: FeatherIcons.briefcase,
                        label: "Profession",
                        iconColor: t.primary,
                        iconBg: t.primary.withValues(alpha: 0.1),
                        right: Text(
                          auth.profession.isNotEmpty ? auth.profession : "Not set",
                          style: TextStyle(fontSize: 13, color: t.textSecondary),
                        ),
                        onPress: () => _showEditDetailSheet(
                          "Profession",
                          auth.profession,
                          (v) => auth.updateUserProfile(profession: v),
                        ),
                      ),
                      SettingRow(
                        icon: FeatherIcons.code,
                        label: "Skills",
                        iconColor: t.accentGreen,
                        iconBg: t.accentGreen.withValues(alpha: 0.1),
                        right: Text(
                          auth.skills.isEmpty
                              ? "Add skills"
                              : auth.skills.length > 2
                                  ? "${auth.skills.take(2).join(', ')}..."
                                  : auth.skills.join(', '),
                          style: TextStyle(fontSize: 13, color: t.textSecondary),
                        ),
                        onPress: _showSkillManagementSheet,
                      ),
                    ],
                  ),
                ),
              ),

              // App Preferences Section
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ProfileSection(
                  title: "App Preferences",
                  child: Column(
                    children: [
                      SettingRow(
                        icon: FeatherIcons.mic,
                        label: "Voice Model",
                        iconColor: t.primary,
                        iconBg: t.primary.withValues(alpha: 0.1),
                        right: Text(auth.voiceId, style: TextStyle(fontSize: 13, color: t.textSecondary)),
                        onPress: _showVoiceSelectionSheet,
                      ),
                    ],
                  ),
                ),
              ),

              // ACCOUNT Section
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: ProfileSection(
                  title: "Account",
                  child: Column(
                    children: [
                      SettingRow(
                        icon: FeatherIcons.mail,
                        label: 'Email Address',
                        iconColor: t.success,
                        iconBg: t.success.withValues(alpha: 0.15),
                        right: Text(
                          auth.email.isNotEmpty ? auth.email : "—",
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: t.textSecondary),
                        ),
                        onPress: () => Notify.info(context, 'Email cannot be changed directly.'),
                      ),
                      const ProfileDiv(),
                      SettingRow(
                        icon: FeatherIcons.lock,
                        label: 'Change Password',
                        iconColor: t.warning,
                        iconBg: t.warning.withValues(alpha: 0.15),
                        onPress: () => Notify.info(context, 'Opening secure password session...'),
                      ),
                    ],
                  ),
                ),
              ),

              // SUPPORT Section
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ProfileSection(
                  title: "Support",
                  child: Column(
                    children: [
                      SettingRow(
                        icon: FeatherIcons.helpCircle,
                        label: "Help & Support",
                        iconColor: t.moduleResume,
                        iconBg: t.moduleResume.withValues(alpha: 0.15),
                        onPress: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const HelpSupportScreen())),
                      ),
                      const ProfileDiv(),
                      SettingRow(
                        icon: FeatherIcons.star,
                        label: "Rate Qlue",
                        iconColor: t.warning,
                        iconBg: t.warning.withValues(alpha: 0.15),
                        onPress: _showRatingDialog,
                      ),
                      const ProfileDiv(),
                      SettingRow(
                        icon: FeatherIcons.info,
                        label: "Version 1.0.0",
                        iconColor: t.textTertiary,
                        iconBg: t.bgSecondary.withValues(alpha: 0.1),
                        right: Text("Latest", style: TextStyle(fontSize: 13, color: t.textTertiary)),
                      ),
                    ],
                  ),
                ),
              ),

              // Logout
              Padding(
                padding: const EdgeInsets.all(24.0),
                child: GlassCard(
                  tintColor: t.error,
                  padding: EdgeInsets.zero,
                  borderRadius: 20,
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: _handleLogout,
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        height: 56,
                        alignment: Alignment.center,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(FeatherIcons.logOut, size: 18, color: t.error),
                            const SizedBox(width: 12),
                            Text("Sign Out", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: t.error, letterSpacing: 0.5)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
