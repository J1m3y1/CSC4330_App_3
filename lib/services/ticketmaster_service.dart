import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_keys.dart';
import '../models/concert.dart';

class TicketmasterException implements Exception {
  TicketmasterException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Thin client around the Ticketmaster Discovery API's `/events` search,
/// scoped to music events.
class TicketmasterService {
  TicketmasterService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  static const _baseUrl = 'https://app.ticketmaster.com/discovery/v2/events.json';

  /// Searches for upcoming concerts. [keyword] can be an artist, band, or
  /// venue name; [city] narrows results to a location. At least one of the
  /// two should be provided by the caller for a meaningful result set.
  Future<List<Concert>> searchConcerts({String? keyword, String? city}) {
    return _fetchEvents({
      'sort': 'date,asc',
      if (keyword != null && keyword.trim().isNotEmpty) 'keyword': keyword.trim(),
      if (city != null && city.trim().isNotEmpty) 'city': city.trim(),
    });
  }

  /// Concerts that have already happened, most recent first. No city or
  /// keyword filter is applied, so results naturally span many different
  /// cities rather than being limited to one market.
  ///
  /// Ticketmaster's date filters match on multi-date series (residencies)
  /// whose overall range overlaps the window, even if the specific date
  /// returned is a future show in that series - so results are also
  /// filtered client-side to guarantee every concert's date is truly past.
  Future<List<Concert>> searchPastConcerts({int size = 20}) async {
    final startOfToday = DateTime.now().toUtc();
    final todayMidnight = DateTime.utc(startOfToday.year, startOfToday.month, startOfToday.day);
    final windowStart = todayMidnight.subtract(const Duration(days: 90));

    final events = await _fetchEvents({
      'sort': 'date,desc',
      'startDateTime': '${windowStart.toIso8601String().split('.').first}Z',
      'endDateTime': '${todayMidnight.toIso8601String().split('.').first}Z',
      'size': '${size * 2}',
    });

    final past = events.where((c) => c.date != null && c.date!.isBefore(todayMidnight)).toList();
    return past.take(size).toList();
  }

  Future<List<Concert>> _fetchEvents(Map<String, String> extraParams) async {
    if (ticketmasterApiKey.isEmpty) {
      throw TicketmasterException(
        'Missing Ticketmaster API key. See lib/config/api_keys.dart for setup.',
      );
    }

    final uri = Uri.parse(_baseUrl).replace(queryParameters: {
      'apikey': ticketmasterApiKey,
      'classificationName': 'music',
      'size': '20',
      ...extraParams,
    });

    final http.Response response;
    try {
      response = await _client.get(uri);
    } catch (_) {
      throw TicketmasterException('Could not reach Ticketmaster. Check your connection.');
    }

    if (response.statusCode == 401 || response.statusCode == 403) {
      throw TicketmasterException('Ticketmaster rejected the API key.');
    }
    if (response.statusCode != 200) {
      throw TicketmasterException('Ticketmaster error (${response.statusCode}).');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final events = (body['_embedded']?['events'] as List?) ?? const [];
    return events
        .cast<Map<String, dynamic>>()
        .map(Concert.fromJson)
        .toList(growable: false);
  }

  void dispose() => _client.close();
}
