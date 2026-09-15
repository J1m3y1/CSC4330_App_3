import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../database/database_helper.dart';
import '../models/app_user.dart';
import '../models/concert.dart';
import '../services/ticketmaster_service.dart';
import '../theme/app_colors.dart';

class ConcertsScreen extends StatefulWidget {
  const ConcertsScreen({super.key, required this.user});

  final AppUser user;

  @override
  State<ConcertsScreen> createState() => _ConcertsScreenState();
}

class _ConcertsScreenState extends State<ConcertsScreen> {
  final _service = TicketmasterService();
  final _keywordController = TextEditingController();
  final _cityController = TextEditingController();

  List<Concert> _concerts = [];
  Set<String> _savedConcertIds = {};
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadSavedIds();
  }

  Future<void> _loadSavedIds() async {
    final ids = await DatabaseHelper.instance.getSavedConcertIds(userId: widget.user.id);
    if (!mounted) return;
    setState(() => _savedConcertIds = ids);
  }

  Future<void> _addToMyConcerts(Concert concert) async {
    await DatabaseHelper.instance.saveConcert(userId: widget.user.id, concert: concert);
    if (!mounted) return;
    setState(() => _savedConcertIds = {..._savedConcertIds, concert.id});
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Added "${concert.name}" to My Concerts.')),
    );
  }

  @override
  void dispose() {
    _service.dispose();
    _keywordController.dispose();
    _cityController.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final results = await _service.searchConcerts(
        keyword: _keywordController.text,
        city: _cityController.text,
      );
      if (!mounted) return;
      setState(() => _concerts = results);
      if (results.isEmpty) {
        setState(() => _errorMessage = 'No concerts found. Try a different search.');
      }
    } on TicketmasterException catch (e) {
      if (!mounted) return;
      setState(() => _errorMessage = e.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
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
    return Scaffold(
      backgroundColor: AppColors.beigeLight,
      appBar: AppBar(title: const Text('Concerts')),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Column(
                children: [
                  TextField(
                    controller: _keywordController,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Artist or venue',
                      prefixIcon: Icon(Icons.search),
                    ),
                    onSubmitted: (_) => _search(),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _cityController,
                    textInputAction: TextInputAction.search,
                    decoration: const InputDecoration(
                      labelText: 'City',
                      prefixIcon: Icon(Icons.location_on_outlined),
                    ),
                    onSubmitted: (_) => _search(),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _isLoading ? null : _search,
                      child: _isLoading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                valueColor: AlwaysStoppedAnimation(AppColors.beigeLight),
                              ),
                            )
                          : const Text('Search'),
                    ),
                  ),
                ],
              ),
            ),
            if (_errorMessage != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text(
                  _errorMessage!,
                  style: const TextStyle(color: Colors.redAccent),
                  textAlign: TextAlign.center,
                ),
              ),
            Expanded(
              child: _concerts.isEmpty && !_isLoading
                  ? Center(
                      child: Text(
                        'Search for an artist or city to find concerts.',
                        style: TextStyle(
                          color: AppColors.textOnBeige.withValues(alpha: 0.6),
                        ),
                        textAlign: TextAlign.center,
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      itemCount: _concerts.length,
                      itemBuilder: (context, index) {
                        final concert = _concerts[index];
                        final isSaved = _savedConcertIds.contains(concert.id);
                        return _ConcertCard(
                          concert: concert,
                          isSaved: isSaved,
                          onTap: () => _openTickets(concert.ticketUrl),
                          onAdd: isSaved ? null : () => _addToMyConcerts(concert),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConcertCard extends StatelessWidget {
  const _ConcertCard({
    required this.concert,
    required this.onTap,
    required this.isSaved,
    required this.onAdd,
  });

  final Concert concert;
  final VoidCallback onTap;
  final bool isSaved;
  final VoidCallback? onAdd;

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
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: AppColors.beige.withValues(alpha: 0.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
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
                        errorBuilder: (context, error, stackTrace) => _placeholderImage(),
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
                      style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
                    ),
                    Text(
                      [concert.venueName, concert.city]
                          .where((s) => s.isNotEmpty)
                          .join(' - '),
                      style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: isSaved ? 'Already in My Concerts' : 'Add to My Concerts',
                icon: Icon(
                  isSaved ? Icons.check_circle : Icons.add_circle_outline,
                  color: AppColors.darkBrown,
                ),
                onPressed: onAdd,
              ),
            ],
          ),
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
