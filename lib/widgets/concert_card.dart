import 'package:flutter/material.dart';

import '../models/concert.dart';
import '../theme/app_colors.dart';

/// Card layout shared by the Concerts search results and the My Concerts
/// list. [trailing] is whatever action (add, remove, none) fits the caller.
class ConcertCard extends StatelessWidget {
  const ConcertCard({
    super.key,
    required this.concert,
    required this.onTap,
    this.trailing,
  });

  final Concert concert;
  final VoidCallback onTap;
  final Widget? trailing;

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
                      concert.displayArtist,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: AppColors.textOnBeige,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (concert.displayArtist != concert.name)
                      Text(
                        concert.name,
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.textOnBeige.withValues(alpha: 0.6),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    const SizedBox(height: 4),
                    Text(
                      Concert.formatDate(concert.date),
                      style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
                    ),
                    Text(
                      [concert.venueName, concert.city].where((s) => s.isNotEmpty).join(' - '),
                      style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (trailing != null) trailing!,
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
