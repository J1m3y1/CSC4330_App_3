import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../models/app_user.dart';
import '../theme/app_colors.dart';
import 'auth_screen.dart';

/// User's profile: account info, concert stats, and logout. Also serves
/// as the app's "home" tab.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.user});

  final AppUser user;

  // TODO: back with real counts once My Concerts persistence exists.
  static const _concertsAttended = 0;
  static const _artistsSeen = 0;

  String _formatDate(DateTime date) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[date.month - 1]} ${date.year}';
  }

  Future<void> _logOut(BuildContext context) async {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const AuthScreen()),
      (route) => false,
    );
  }

  Future<void> _shareStats(BuildContext context) async {
    final box = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        text: "${user.name}'s concert stats on One Button 🎤\n"
            '🎫 $_concertsAttended concerts attended\n'
            '🎸 $_artistsSeen artists seen',
        subject: 'My concert stats',
        sharePositionOrigin:
            box != null ? box.localToGlobal(Offset.zero) & box.size : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.beigeLight,
      appBar: AppBar(title: const Text('Profile')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Center(
              child: CircleAvatar(
                radius: 40,
                backgroundColor: AppColors.lightBrown,
                child: Text(
                  user.name.isNotEmpty ? user.name[0].toUpperCase() : '?',
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
              user.name,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: AppColors.textOnBeige,
              ),
            ),
            Text(
              user.email,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
            ),
            Text(
              'Member since ${_formatDate(user.createdAt)}',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textOnBeige.withValues(alpha: 0.5),
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: _StatCard(
                    label: 'Concerts Attended',
                    value: '$_concertsAttended',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _StatCard(label: 'Artists Seen', value: '$_artistsSeen'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => _shareStats(context),
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
              onPressed: () => _logOut(context),
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
