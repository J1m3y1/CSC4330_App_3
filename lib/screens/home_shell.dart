import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../theme/app_colors.dart';
import 'concerts_screen.dart';
import 'my_concerts_screen.dart';
import 'profile_screen.dart';

/// Post-login shell: bottom navigation between browsing concerts, the
/// user's own "going to" list, and their profile/stats.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.user});

  final AppUser user;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final screens = [
      ConcertsScreen(user: widget.user),
      MyConcertsScreen(user: widget.user),
      ProfileScreen(user: widget.user),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: screens),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (index) => setState(() => _index = index),
        backgroundColor: AppColors.beige,
        selectedItemColor: AppColors.darkBrown,
        unselectedItemColor: AppColors.textOnBeige.withValues(alpha: 0.5),
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.search),
            label: 'Concerts',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.event_available_outlined),
            label: 'My Concerts',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.person_outline),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
