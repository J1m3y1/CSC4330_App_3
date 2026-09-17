import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../database/database_helper.dart';
import '../models/app_user.dart';
import '../models/concert.dart';
import '../services/ticketmaster_service.dart';
import '../theme/app_colors.dart';
import '../widgets/concert_card.dart';

/// Shows the concerts the user has marked that they're going to ("Upcoming")
/// and the ones they've attended ("Attended"). Recent past shows fetched
/// live from Ticketmaster are auto-imported into Attended on load.
class MyConcertsScreen extends StatefulWidget {
  const MyConcertsScreen({super.key, required this.user});

  final AppUser user;

  @override
  State<MyConcertsScreen> createState() => _MyConcertsScreenState();
}

class _MyConcertsScreenState extends State<MyConcertsScreen> {
  final _service = TicketmasterService();

  List<Concert> _upcoming = [];
  List<Concert> _attended = [];
  bool _isLoading = true;
  String? _pastErrorMessage;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);

    var saved = await DatabaseHelper.instance.getSavedConcerts(userId: widget.user.id);
    final savedIds = saved.map((c) => c.id).toSet();

    String? pastError;
    try {
      final past = await _service.searchPastConcerts();
      final newOnes = past.where((c) => !savedIds.contains(c.id));
      for (final concert in newOnes) {
        await DatabaseHelper.instance.saveConcert(userId: widget.user.id, concert: concert);
        await DatabaseHelper.instance.setAttended(
          userId: widget.user.id,
          concertId: concert.id,
          attended: true,
        );
      }
      if (past.isNotEmpty) {
        saved = await DatabaseHelper.instance.getSavedConcerts(userId: widget.user.id);
      }
    } on TicketmasterException catch (e) {
      pastError = e.message;
    }

    if (!mounted) return;
    setState(() {
      _upcoming = saved.where((c) => !c.attended).toList();
      _attended = saved.where((c) => c.attended).toList();
      _pastErrorMessage = pastError;
      _isLoading = false;
    });
  }

  Future<void> _remove(Concert concert) async {
    await DatabaseHelper.instance.removeConcert(userId: widget.user.id, concertId: concert.id);
    if (!mounted) return;
    setState(() {
      _upcoming = _upcoming.where((c) => c.id != concert.id).toList();
      _attended = _attended.where((c) => c.id != concert.id).toList();
    });
  }

  Future<void> _setAttended(Concert concert, bool attended) async {
    await DatabaseHelper.instance.setAttended(
      userId: widget.user.id,
      concertId: concert.id,
      attended: attended,
    );
    if (!mounted) return;
    setState(() {
      _upcoming = _upcoming.where((c) => c.id != concert.id).toList();
      _attended = _attended.where((c) => c.id != concert.id).toList();
      final updated = concert.copyWith(attended: attended);
      if (attended) {
        _attended = [..._attended, updated];
      } else {
        _upcoming = [..._upcoming, updated];
      }
    });
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

  @override
  Widget build(BuildContext context) {
    final hasNothing = _upcoming.isEmpty && _attended.isEmpty && _pastErrorMessage == null;

    return Scaffold(
      backgroundColor: AppColors.beigeLight,
      appBar: AppBar(title: const Text('My Concerts')),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : hasNothing
                ? Center(
                    child: Text(
                      "Concerts you're going to will show up here.",
                      style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.6)),
                      textAlign: TextAlign.center,
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        if (_upcoming.isNotEmpty) ...[
                          const _SectionHeader('Upcoming'),
                          ..._upcoming.map(
                            (concert) => ConcertCard(
                              concert: concert,
                              onTap: () => _openTickets(concert.ticketUrl),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  IconButton(
                                    tooltip: 'Mark as attended',
                                    icon: const Icon(
                                      Icons.check_circle_outline,
                                      color: AppColors.darkBrown,
                                    ),
                                    onPressed: () => _setAttended(concert, true),
                                  ),
                                  IconButton(
                                    tooltip: 'Remove from My Concerts',
                                    icon: const Icon(
                                      Icons.delete_outline,
                                      color: AppColors.darkBrown,
                                    ),
                                    onPressed: () => _remove(concert),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 8),
                        ],
                        if (_attended.isNotEmpty || _pastErrorMessage != null) ...[
                          const _SectionHeader('Attended'),
                          ..._attended.map(
                            (concert) => ConcertCard(
                              concert: concert,
                              onTap: () => _openTickets(concert.ticketUrl),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  IconButton(
                                    tooltip: 'Unmark as attended',
                                    icon: const Icon(Icons.check_circle, color: AppColors.darkBrown),
                                    onPressed: () => _setAttended(concert, false),
                                  ),
                                  IconButton(
                                    tooltip: 'Remove from My Concerts',
                                    icon: const Icon(
                                      Icons.delete_outline,
                                      color: AppColors.darkBrown,
                                    ),
                                    onPressed: () => _remove(concert),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          if (_pastErrorMessage != null)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                _pastErrorMessage!,
                                style: const TextStyle(color: Colors.redAccent),
                                textAlign: TextAlign.center,
                              ),
                            ),
                        ],
                      ],
                    ),
                  ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, top: 4),
      child: Text(
        title,
        style: const TextStyle(
          fontWeight: FontWeight.bold,
          fontSize: 16,
          color: AppColors.textOnBeige,
        ),
      ),
    );
  }
}
