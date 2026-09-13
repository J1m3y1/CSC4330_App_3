/// A single concert/event returned by the Ticketmaster Discovery API.
class Concert {
  const Concert({
    required this.id,
    required this.name,
    required this.date,
    required this.venueName,
    required this.city,
    required this.imageUrl,
    required this.ticketUrl,
  });

  final String id;
  final String name;
  final DateTime? date;
  final String venueName;
  final String city;
  final String? imageUrl;
  final String ticketUrl;

  factory Concert.fromJson(Map<String, dynamic> json) {
    final venues = (json['_embedded']?['venues'] as List?) ?? const [];
    final venue = venues.isNotEmpty ? venues.first as Map<String, dynamic> : null;

    final images = (json['images'] as List?) ?? const [];
    final image = images.isNotEmpty ? images.first as Map<String, dynamic> : null;

    final localDate = json['dates']?['start']?['localDate'] as String?;
    final localTime = json['dates']?['start']?['localTime'] as String?;
    DateTime? parsedDate;
    if (localDate != null) {
      parsedDate = DateTime.tryParse(
        localTime != null ? '${localDate}T$localTime' : localDate,
      );
    }

    return Concert(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? 'Untitled event',
      date: parsedDate,
      venueName: venue?['name'] as String? ?? 'Venue TBA',
      city: venue?['city']?['name'] as String? ?? '',
      imageUrl: image?['url'] as String?,
      ticketUrl: json['url'] as String? ?? '',
    );
  }
}
