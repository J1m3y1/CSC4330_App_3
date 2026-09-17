import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:share_plus/share_plus.dart';

import '../models/app_user.dart';
import '../theme/app_colors.dart';
import 'auth_screen.dart';
import 'edit_profile_screen.dart';

/// User's profile: account info, concert stats, and logout. Also serves
/// as the app's "home" tab.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.user});

  final AppUser user;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  // TODO: back with real counts once My Concerts persistence exists.
  static const _concertsAttended = 0;
  static const _artistsSeen = 0;

  late AppUser _user = widget.user;

  String _formatDate(DateTime date) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[date.month - 1]} ${date.year}';
  }

  Future<void> _editProfile() async {
    final updated = await Navigator.of(context).push<AppUser>(
      MaterialPageRoute(builder: (_) => EditProfileScreen(user: _user)),
    );
    if (updated != null && mounted) {
      setState(() => _user = updated);
    }
  }

  Future<void> _logOut() async {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const AuthScreen()),
      (route) => false,
    );
  }

  Future<void> _shareStats() async {
    final box = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        text: "${_user.name}'s concert stats on Encore 🎤\n"
            '🎫 $_concertsAttended concerts attended\n'
            '🎸 $_artistsSeen artists seen',
        subject: 'My concert stats',
        sharePositionOrigin:
            box != null ? box.localToGlobal(Offset.zero) & box.size : null,
      ),
    );
  }

  Future<void> _showAbout() async {
    final info = await PackageInfo.fromPlatform();
    if (!mounted) return;
    showAboutDialog(
      context: context,
      applicationName: 'Encore',
      applicationVersion: info.version,
      applicationIcon: const Icon(Icons.music_note, color: AppColors.darkBrown),
      children: const [
        SizedBox(height: 12),
        Text('Concert search results are provided by the Ticketmaster Discovery API.'),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.beigeLight,
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          IconButton(
            tooltip: 'Edit profile',
            icon: const Icon(Icons.edit_outlined),
            onPressed: _editProfile,
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Center(
              child: CircleAvatar(
                radius: 40,
                backgroundColor: AppColors.lightBrown,
                child: Text(
                  _user.name.isNotEmpty ? _user.name[0].toUpperCase() : '?',
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.bold,
                    color: AppColors.beigeLight,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              _user.name,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: AppColors.textOnBeige,
              ),
            ),
            Text(
              _user.email,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
            ),
            Text(
              'Member since ${_formatDate(_user.createdAt)}',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textOnBeige.withValues(alpha: 0.5),
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 24),
            const Row(
              children: [
                Expanded(
                  child: _StatCard(
                    label: 'Concerts Attended',
                    value: '$_concertsAttended',
                  ),
                ),
                SizedBox(width: 12),
                Expanded(
                  child: _StatCard(label: 'Artists Seen', value: '$_artistsSeen'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _shareStats,
              icon: const Icon(Icons.ios_share, color: AppColors.darkBrown),
              label: const Text(
                'Share Stats',
                style: TextStyle(color: AppColors.darkBrown),
              ),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                side: const BorderSide(color: AppColors.darkBrown),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: _logOut,
              icon: const Icon(Icons.logout, color: AppColors.darkBrown),
              label: const Text(
                'Log Out',
                style: TextStyle(color: AppColors.darkBrown),
              ),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                side: const BorderSide(color: AppColors.darkBrown),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
            const SizedBox(height: 20),
            Center(
              child: TextButton.icon(
                onPressed: _showAbout,
                icon: const Icon(Icons.info_outline, color: AppColors.lightBrown),
                label: const Text('About'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        color: AppColors.beige.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: AppColors.textOnBeige,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
          ),
        ],
      ),
    );
  }
}
