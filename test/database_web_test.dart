// Exercises the sqflite_common_ffi_web insert path used by sign-up.
// Run with: flutter test --platform chrome test/database_web_test.dart
@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:_csc4330_app3/database/database_helper.dart';

void main() {
  test('signUp then logIn succeeds on the web sqlite backend', () async {
    final email = 'web-test-${DateTime.now().microsecondsSinceEpoch}@example.com';

    await DatabaseHelper.instance.signUp(
      name: 'Web Test',
      email: email,
      password: 'password123',
    );

    final user = await DatabaseHelper.instance.logIn(
      email: email,
      password: 'password123',
    );

    expect(user['email'], email);
  });
}
