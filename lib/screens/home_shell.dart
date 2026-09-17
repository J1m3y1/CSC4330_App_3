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
  // Bumped every time the My Concerts or Profile tab is opened, forcing it
  // to remount and reload - both are kept alive by IndexedStack, so they
  // won't otherwise notice concerts added/removed from other tabs.
  int _myConcertsRefreshKey = 0;
  int _profileRefreshKey = 0;

  late AppUser _currentUser = widget.user;

  @override
  Widget build(BuildContext context) {
    final screens = [
      ConcertsScreen(user: _currentUser),
      MyConcertsScreen(key: ValueKey(_myConcertsRefreshKey), user: _currentUser),
      ProfileScreen(
        key: ValueKey(_profileRefreshKey),
        user: _currentUser,
        onUserUpdated: (user) => setState(() => _currentUser = user),
      ),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: screens),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (index) => setState(() {
          if (index == 1) _myConcertsRefreshKey++;
          if (index == 2) _profileRefreshKey++;
          _index = index;
        }),
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
