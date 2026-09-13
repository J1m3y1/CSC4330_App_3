import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Shows the concerts the user has marked that they're going to.
/// Placeholder screen only - no list/data wiring yet.
class MyConcertsScreen extends StatelessWidget {
  const MyConcertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.beigeLight,
      appBar: AppBar(title: const Text('My Concerts')),
      body: Center(
        child: Text(
          'Concerts you\'re going to will show up here.',
          style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.6)),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
