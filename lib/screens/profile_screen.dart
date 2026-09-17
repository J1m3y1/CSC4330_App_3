import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../database/database_helper.dart';
import '../models/app_user.dart';
import '../models/concert.dart';
import '../theme/app_colors.dart';
import '../utils/stats_html.dart';
import '../widgets/concert_card.dart';
import 'auth_screen.dart';
import 'edit_profile_screen.dart';

/// User's profile: account info, concert stats, and logout. Also serves
/// as the app's "home" tab.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.user, required this.onUserUpdated});

  final AppUser user;

  /// Called with the new [AppUser] after a successful profile edit, so the
  /// parent can keep the rest of the app in sync.
  final ValueChanged<AppUser> onUserUpdated;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  List<Concert> _attendedConcerts = [];

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    final saved = await DatabaseHelper.instance.getSavedConcerts(userId: widget.user.id);
    if (!mounted) return;
    setState(() => _attendedConcerts = saved.where((c) => c.attended).toList());
  }

  int get _concertsAttended => _attendedConcerts.length;

  List<String> get _distinctArtists =>
      _attendedConcerts.map((c) => c.displayArtist).toSet().toList();

  int get _artistsSeen => _distinctArtists.length;

  Future<void> _openTickets(String url) async {
    if (url.isEmpty) return;
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open ticket link.')),
      );
    }
  }

  void _showConcertsAttended() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.beigeLight,
      isScrollControlled: true,
      builder: (context) => _StatListSheet(
        title: 'Concerts Attended',
        child: _attendedConcerts.isEmpty
            ? const _EmptyStatMessage('No concerts marked as attended yet.')
            : ListView(
                shrinkWrap: true,
                children: _attendedConcerts
                    .map((concert) => ConcertCard(
                          concert: concert,
                          onTap: () => _openTickets(concert.ticketUrl),
                        ))
                    .toList(),
              ),
      ),
    );
  }

  void _showArtistsSeen() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.beigeLight,
      isScrollControlled: true,
      builder: (context) => _StatListSheet(
        title: 'Artists Seen',
        child: _distinctArtists.isEmpty
            ? const _EmptyStatMessage('No artists seen yet.')
            : ListView(
                shrinkWrap: true,
                children: _distinctArtists
                    .map((name) => ListTile(
                          leading: const Icon(Icons.music_note, color: AppColors.darkBrown),
                          title: Text(name, style: const TextStyle(color: AppColors.textOnBeige)),
                        ))
                    .toList(),
              ),
      ),
    );
  }

  String _formatDate(DateTime date) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[date.month - 1]} ${date.year}';
  }

  Future<void> _editProfile() async {
    final updated = await Navigator.of(context).push<AppUser>(
      MaterialPageRoute(builder: (_) => EditProfileScreen(user: widget.user)),
    );
    if (updated != null && mounted) {
      widget.onUserUpdated(updated);
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
    final html = buildStatsHtml(user: widget.user, attendedConcerts: _attendedConcerts);
    final file = XFile.fromData(
      Uint8List.fromList(utf8.encode(html)),
      mimeType: 'text/html',
      name: 'concert-stats.html',
      path: 'concert-stats.html',
    );
    await SharePlus.instance.share(
      ShareParams(
        files: [file],
        text: "${widget.user.name}'s concert stats on Encore 🎤\n"
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
                  widget.user.name.isNotEmpty ? widget.user.name[0].toUpperCase() : '?',
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
              widget.user.name,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: AppColors.textOnBeige,
              ),
            ),
            Text(
              widget.user.email,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
            ),
            Text(
              'Member since ${_formatDate(widget.user.createdAt)}',
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
                    onTap: _showConcertsAttended,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _StatCard(
                    label: 'Artists Seen',
                    value: '$_artistsSeen',
                    onTap: _showArtistsSeen,
                  ),
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
  const _StatCard({required this.label, required this.value, required this.onTap});

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.beige.withValues(alpha: 0.5),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
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
        ),
      ),
    );
  }
}

class _StatListSheet extends StatelessWidget {
  const _StatListSheet({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: AppColors.textOnBeige,
              ),
            ),
            const SizedBox(height: 12),
            Flexible(child: child),
          ],
        ),
      ),
    );
  }
}

class _EmptyStatMessage extends StatelessWidget {
  const _EmptyStatMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.6)),
      ),
    );
  }
}
