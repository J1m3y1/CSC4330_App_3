import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../database/database_helper.dart';
import '../models/app_user.dart';
import '../models/concert.dart';
import '../theme/app_colors.dart';

/// Shows the concerts the user has marked that they're going to.
class MyConcertsScreen extends StatefulWidget {
  const MyConcertsScreen({super.key, required this.user});

  final AppUser user;

  @override
  State<MyConcertsScreen> createState() => _MyConcertsScreenState();
}

class _MyConcertsScreenState extends State<MyConcertsScreen> {
  List<Concert> _concerts = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final concerts = await DatabaseHelper.instance.getSavedConcerts(userId: widget.user.id);
    if (!mounted) return;
    setState(() {
      _concerts = concerts;
      _isLoading = false;
    });
  }

  Future<void> _remove(Concert concert) async {
    await DatabaseHelper.instance.removeConcert(userId: widget.user.id, concertId: concert.id);
    if (!mounted) return;
    setState(() => _concerts = _concerts.where((c) => c.id != concert.id).toList());
  }

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

  String _formatDate(DateTime? date) {
    if (date == null) return 'Date TBA';
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.beigeLight,
      appBar: AppBar(title: const Text('My Concerts')),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _concerts.isEmpty
                ? Center(
                    child: Text(
                      "Concerts you're going to will show up here.",
                      style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.6)),
                      textAlign: TextAlign.center,
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _concerts.length,
                    itemBuilder: (context, index) {
                      final concert = _concerts[index];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 12),
                        color: AppColors.beige.withValues(alpha: 0.5),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: () => _openTickets(concert.ticketUrl),
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Row(
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(10),
                                  child: concert.imageUrl != null
                                      ? Image.network(
                                          concert.imageUrl!,
                                          width: 64,
                                          height: 64,
                                          fit: BoxFit.cover,
                                          errorBuilder: (context, error, stackTrace) =>
                                              _placeholderImage(),
                                        )
                                      : _placeholderImage(),
                                ),
                                const SizedBox(width: 14),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        concert.name,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          color: AppColors.textOnBeige,
                                        ),
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        _formatDate(concert.date),
                                        style: TextStyle(
                                          color: AppColors.textOnBeige.withValues(alpha: 0.7),
                                        ),
                                      ),
                                      Text(
                                        [concert.venueName, concert.city]
                                            .where((s) => s.isNotEmpty)
                                            .join(' - '),
                                        style: TextStyle(
                                          color: AppColors.textOnBeige.withValues(alpha: 0.7),
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ],
                                  ),
                                ),
                                IconButton(
                                  tooltip: 'Remove from My Concerts',
                                  icon: const Icon(Icons.delete_outline, color: AppColors.darkBrown),
                                  onPressed: () => _remove(concert),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
      ),
    );
  }

  Widget _placeholderImage() {
    return Container(
      width: 64,
      height: 64,
      color: AppColors.lightBrown,
      child: const Icon(Icons.music_note, color: AppColors.beigeLight),
    );
  }
}
