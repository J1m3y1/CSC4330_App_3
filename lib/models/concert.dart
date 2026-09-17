/// A concert returned by the Ticketmaster Discovery API.
class Concert {
  const Concert({
    required this.id,
    required this.name,
    required this.artist,
    required this.date,
    required this.venueName,
    required this.city,
    required this.imageUrl,
    required this.ticketUrl,
    this.attended = false,
  });

  final String id;
  final String name;
  final String? artist;
  final DateTime? date;
  final String venueName;
  final String city;
  final String? imageUrl;
  final String ticketUrl;
  final bool attended;

  /// The performer's name when Ticketmaster provided one, falling back to
  /// the event's own title (e.g. a festival or tour package) otherwise.
  String get displayArtist => (artist != null && artist!.isNotEmpty) ? artist! : name;

  factory Concert.fromJson(Map<String, dynamic> json) {
    final venues = (json['_embedded']?['venues'] as List?) ?? const [];
    final venue = venues.isNotEmpty ? venues.first as Map<String, dynamic> : null;
    final images = (json['images'] as List?) ?? const [];
    final image = images.isNotEmpty ? images.first as Map<String, dynamic> : null;
    final localDate = json['dates']?['start']?['localDate'] as String?;
    final localTime = json['dates']?['start']?['localTime'] as String?;
    final parsedDate = localDate == null
        ? null
        : DateTime.tryParse(localTime == null ? localDate : '${localDate}T$localTime');

    final attractions = (json['_embedded']?['attractions'] as List?) ?? const [];
    final artistNames = attractions
        .cast<Map<String, dynamic>>()
        .map((a) => a['name'] as String?)
        .whereType<String>()
        .toList();

    return Concert(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? 'Untitled event',
      artist: artistNames.isEmpty ? null : artistNames.join(', '),
      date: parsedDate,
      venueName: venue?['name'] as String? ?? 'Venue TBA',
      city: venue?['city']?['name'] as String? ?? '',
      imageUrl: image?['url'] as String?,
      ticketUrl: json['url'] as String? ?? '',
    );
  }

  factory Concert.fromSavedRow(Map<String, Object?> row) {
    final date = row['date'] as String?;
    return Concert(
      id: row['concertId'] as String,
      name: row['name'] as String,
      artist: row['artist'] as String?,
      date: date == null ? null : DateTime.tryParse(date),
      venueName: row['venueName'] as String,
      city: row['city'] as String,
      imageUrl: row['imageUrl'] as String?,
      ticketUrl: row['ticketUrl'] as String,
      attended: (row['attended'] as int?) == 1,
    );
  }

  Concert copyWith({bool? attended}) {
    return Concert(
      id: id,
      name: name,
      artist: artist,
      date: date,
      venueName: venueName,
      city: city,
      imageUrl: imageUrl,
      ticketUrl: ticketUrl,
      attended: attended ?? this.attended,
    );
  }

  static String formatDate(DateTime? date) {
    if (date == null) return 'Date TBA';
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }
}
