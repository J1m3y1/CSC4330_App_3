import 'dart:convert';
import 'dart:io' show Platform;

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart' show databaseFactorySqflitePlugin;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';

/// Thrown when a signup or login request cannot be fulfilled.
class AuthException implements Exception {
  AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Singleton wrapper around a local SQLite `users` table used for
/// account creation and credential verification.
class DatabaseHelper {
  DatabaseHelper._internal();
  static final DatabaseHelper instance = DatabaseHelper._internal();

  static const _dbName = 'app_users.db';
  static const _dbVersion = 1;
  static const tableUsers = 'users';

  Database? _database;

  Future<Database> get database async {
    return _database ??= await _initDatabase();
  }

  DatabaseFactory _resolveFactory() {
    if (kIsWeb) {
      return databaseFactoryFfiWeb;
    }
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
          await db.execute('''
            CREATE TABLE $tableUsers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              email TEXT NOT NULL UNIQUE,
              passwordHash TEXT NOT NULL,
              createdAt TEXT NOT NULL
            )
          ''');
        },
      ),
    );
  }

  String _hashPassword(String password) {
    return sha256.convert(utf8.encode(password)).toString();
  }

  /// Creates a new account. Throws [AuthException] if the email is
  /// already registered.
  Future<void> signUp({
    required String name,
    required String email,
    required String password,
  }) async {
    final db = await database;
    final normalizedEmail = email.trim().toLowerCase();

    final existing = await db.query(
      tableUsers,
      where: 'email = ?',
      whereArgs: [normalizedEmail],
      limit: 1,
    );
    if (existing.isNotEmpty) {
      throw AuthException('An account with that email already exists.');
    }

    await db.insert(tableUsers, {
      'name': name.trim(),
      'email': normalizedEmail,
      'passwordHash': _hashPassword(password),
      'createdAt': DateTime.now().toIso8601String(),
    });
  }

  /// Validates credentials against the stored record. Throws
  /// [AuthException] when the email is unknown or the password is wrong.
  Future<Map<String, Object?>> logIn({
    required String email,
    required String password,
  }) async {
    final db = await database;
    final normalizedEmail = email.trim().toLowerCase();

    final results = await db.query(
      tableUsers,
      where: 'email = ?',
      whereArgs: [normalizedEmail],
      limit: 1,
    );

    if (results.isEmpty) {
      throw AuthException('No account found for that email.');
    }

    final user = results.first;
    if (user['passwordHash'] != _hashPassword(password)) {
      throw AuthException('Incorrect password.');
    }

    return user;
  }

  /// Updates a user's name and email. Throws [AuthException] if the new
  /// email is already taken by a different account.
  Future<Map<String, Object?>> updateProfile({
    required int id,
    required String name,
    required String email,
  }) async {
    final db = await database;
    final normalizedEmail = email.trim().toLowerCase();

    final existing = await db.query(
      tableUsers,
      where: 'email = ? AND id != ?',
      whereArgs: [normalizedEmail, id],
      limit: 1,
    );
    if (existing.isNotEmpty) {
      throw AuthException('An account with that email already exists.');
    }

    await db.update(
      tableUsers,
      {'name': name.trim(), 'email': normalizedEmail},
      where: 'id = ?',
      whereArgs: [id],
    );

    final updated = await db.query(tableUsers, where: 'id = ?', whereArgs: [id], limit: 1);
    return updated.first;
  }
}
