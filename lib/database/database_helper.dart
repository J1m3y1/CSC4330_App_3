import 'dart:convert';
import 'dart:io' show Platform;

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart' show ConflictAlgorithm, databaseFactorySqflitePlugin;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';

import '../models/concert.dart';

class AuthException implements Exception {
  AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}

class DatabaseHelper {
  DatabaseHelper._internal();
  static final DatabaseHelper instance = DatabaseHelper._internal();

  static const _dbName = 'app_users.db';
  static const _dbVersion = 4;
  static const tableUsers = 'users';
  static const tableSavedConcerts = 'saved_concerts';

  Database? _database;

  Future<Database> get database async => _database ??= await _initDatabase();

  DatabaseFactory _resolveFactory() {
    if (kIsWeb) return databaseFactoryFfiWeb;
    if (Platform.isWindows || Platform.isLinux || Platform.isMacOS) {
      sqfliteFfiInit();
      return databaseFactoryFfi;
    }
    return databaseFactorySqflitePlugin;
  }

  Future<Database> _initDatabase() async {
    final factory = _resolveFactory();
    final path = kIsWeb ? _dbName : join(await factory.getDatabasesPath(), _dbName);
    return factory.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: _dbVersion,
        onCreate: (db, version) async {
          await db.execute('''CREATE TABLE $tableUsers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            passwordHash TEXT NOT NULL,
            createdAt TEXT NOT NULL
          )''');
          await db.execute(_createSavedConcertsTableSql);
        },
        onUpgrade: (db, oldVersion, newVersion) async {
          if (oldVersion < 2) await db.execute(_createSavedConcertsTableSql);
          if (oldVersion < 3) {
            await db.execute(
              'ALTER TABLE $tableSavedConcerts ADD COLUMN attended INTEGER NOT NULL DEFAULT 0',
            );
          }
          if (oldVersion < 4) {
            await db.execute('ALTER TABLE $tableSavedConcerts ADD COLUMN artist TEXT');
          }
        },
      ),
    );
  }

  static const _createSavedConcertsTableSql = '''CREATE TABLE $tableSavedConcerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    concertId TEXT NOT NULL,
    name TEXT NOT NULL,
    date TEXT,
    venueName TEXT NOT NULL,
    city TEXT NOT NULL,
    imageUrl TEXT,
    ticketUrl TEXT NOT NULL,
    attended INTEGER NOT NULL DEFAULT 0,
    artist TEXT,
    UNIQUE(userId, concertId)
  )''';

  String _hashPassword(String password) => sha256.convert(utf8.encode(password)).toString();

  Future<void> signUp({required String name, required String email, required String password}) async {
    final db = await database;
    final normalizedEmail = email.trim().toLowerCase();
    final existing = await db.query(tableUsers, where: 'email = ?', whereArgs: [normalizedEmail], limit: 1);
    if (existing.isNotEmpty) throw AuthException('An account with that email already exists.');
    await db.insert(tableUsers, {
      'name': name.trim(),
      'email': normalizedEmail,
      'passwordHash': _hashPassword(password),
      'createdAt': DateTime.now().toIso8601String(),
    });
  }

  Future<Map<String, Object?>> logIn({required String email, required String password}) async {
    final db = await database;
    final results = await db.query(tableUsers, where: 'email = ?', whereArgs: [email.trim().toLowerCase()], limit: 1);
    if (results.isEmpty) throw AuthException('No account found for that email.');
    final user = results.first;
    if (user['passwordHash'] != _hashPassword(password)) throw AuthException('Incorrect password.');
    return user;
  }

  Future<Map<String, Object?>> updateProfile({required int id, required String name, required String email}) async {
    final db = await database;
    final normalizedEmail = email.trim().toLowerCase();
    final existing = await db.query(tableUsers, where: 'email = ? AND id != ?', whereArgs: [normalizedEmail, id], limit: 1);
    if (existing.isNotEmpty) throw AuthException('An account with that email already exists.');
    await db.update(tableUsers, {'name': name.trim(), 'email': normalizedEmail}, where: 'id = ?', whereArgs: [id]);
    final updated = await db.query(tableUsers, where: 'id = ?', whereArgs: [id], limit: 1);
    return updated.first;
  }

  Future<void> saveConcert({required int userId, required Concert concert}) async {
    final db = await database;
    await db.insert(tableSavedConcerts, {
      'userId': userId,
      'concertId': concert.id,
      'name': concert.name,
      'date': concert.date?.toIso8601String(),
      'venueName': concert.venueName,
      'city': concert.city,
      'imageUrl': concert.imageUrl,
      'ticketUrl': concert.ticketUrl,
      'artist': concert.artist,
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<void> removeConcert({required int userId, required String concertId}) async {
    final db = await database;
    await db.delete(tableSavedConcerts, where: 'userId = ? AND concertId = ?', whereArgs: [userId, concertId]);
  }

  Future<Set<String>> getSavedConcertIds({required int userId}) async {
    final db = await database;
    final rows = await db.query(tableSavedConcerts, columns: ['concertId'], where: 'userId = ?', whereArgs: [userId]);
    return rows.map((row) => row['concertId'] as String).toSet();
  }

  Future<void> setAttended({
    required int userId,
    required String concertId,
    required bool attended,
  }) async {
    final db = await database;
    await db.update(
      tableSavedConcerts,
      {'attended': attended ? 1 : 0},
      where: 'userId = ? AND concertId = ?',
      whereArgs: [userId, concertId],
    );
  }

  Future<List<Concert>> getSavedConcerts({required int userId}) async {
    final db = await database;
    final rows = await db.query(tableSavedConcerts, where: 'userId = ?', whereArgs: [userId], orderBy: 'date ASC');
    return rows.map(Concert.fromSavedRow).toList(growable: false);
  }
}
