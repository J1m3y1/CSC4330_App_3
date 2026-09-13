import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import 'concerts_screen.dart';
import 'my_concerts_screen.dart';

/// Post-login shell: bottom navigation between browsing concerts and the
/// user's own "going to" list.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _screens = [
    ConcertsScreen(),
    MyConcertsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: _screens),
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
        ],
      ),
    );
  }
}
