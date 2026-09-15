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
  Future<List<Concert>> searchConcerts({String? keyword, String? city}) async {
    if (ticketmasterApiKey.isEmpty) {
      throw TicketmasterException(
        'Missing Ticketmaster API key. See lib/config/api_keys.dart for setup.',
      );
    }

    final uri = Uri.parse(_baseUrl).replace(queryParameters: {
      'apikey': ticketmasterApiKey,
      'classificationName': 'music',
      'sort': 'date,asc',
      'size': '20',
      if (keyword != null && keyword.trim().isNotEmpty) 'keyword': keyword.trim(),
      if (city != null && city.trim().isNotEmpty) 'city': city.trim(),
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
