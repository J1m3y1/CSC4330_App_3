import 'package:flutter/material.dart';

import '../database/database_helper.dart';
import '../models/app_user.dart';
import '../theme/app_colors.dart';
import 'home_shell.dart';

enum _AuthMode { login, signUp }

/// Combined login / signup screen with a staggered "drop in" entrance
/// animation for each field, backed by a local SQLite users table.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen>
    with SingleTickerProviderStateMixin {
  _AuthMode _mode = _AuthMode.login;

  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  late final AnimationController _controller;

  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  bool _isSubmitting = false;
  String? _errorMessage;

  // Each step starts _stepDelay after the previous one and takes
  // _itemDuration to finish, so steps visibly cascade one after another
  // instead of fading in all at once.
  static const _stepDelay = Duration(milliseconds: 120);
  static const _itemDuration = Duration(milliseconds: 500);

  Duration _totalDuration(int totalSteps) =>
      _stepDelay * (totalSteps - 1) + _itemDuration;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: _totalDuration(_stepCount(_mode)),
    )..forward();
  }

  int _stepCount(_AuthMode mode) =>
      mode == _AuthMode.signUp ? 9 : 7;

  @override
  void dispose() {
    _controller.dispose();
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _switchMode(_AuthMode mode) {
    if (_mode == mode) return;
    setState(() {
      _mode = mode;
      _errorMessage = null;
      _formKey.currentState?.reset();
    });
    _controller.duration = _totalDuration(_stepCount(mode));
    _controller
      ..reset()
      ..forward();
  }

  Animation<double> _dropAnimation(int index, int totalSteps) {
    final totalMs = _totalDuration(totalSteps).inMilliseconds;
    final startMs = _stepDelay.inMilliseconds * index;
    final endMs = startMs + _itemDuration.inMilliseconds;
    final start = (startMs / totalMs).clamp(0.0, 1.0);
    final end = (endMs / totalMs).clamp(0.0, 1.0);
    return CurvedAnimation(
      parent: _controller,
      curve: Interval(start, end, curve: Curves.easeOutBack),
    );
  }

  Widget _animatedField(int index, int totalFields, Widget child) {
    final animation = _dropAnimation(index, totalFields);
    return AnimatedBuilder(
      animation: animation,
      builder: (context, _) {
        final dy = (1 - animation.value).clamp(0.0, 1.0) * -40;
        return Opacity(
          opacity: animation.value.clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, dy),
            child: child,
          ),
        );
      },
    );
  }

  Future<void> _submit() async {
    setState(() => _errorMessage = null);
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _isSubmitting = true);
    try {
      if (_mode == _AuthMode.signUp) {
        await DatabaseHelper.instance.signUp(
          name: _nameController.text,
          email: _emailController.text,
          password: _passwordController.text,
        );
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Account created. You can log in now.')),
        );
        _switchMode(_AuthMode.login);
      } else {
        final userMap = await DatabaseHelper.instance.logIn(
          email: _emailController.text,
          password: _passwordController.text,
        );
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => HomeShell(user: AppUser.fromMap(userMap)),
          ),
        );
      }
    } on AuthException catch (e) {
      setState(() => _errorMessage = e.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isSignUp = _mode == _AuthMode.signUp;
    // avatar, title, subtitle, [name], email, password, [confirm], button, switch-link
    final totalSteps = _stepCount(_mode);
    var step = 0;
    Widget anim(Widget child) => _animatedField(step++, totalSteps, child);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    anim(
                      Center(
                        child: CircleAvatar(
                          radius: 36,
                          backgroundColor: AppColors.lightBrown,
                          child: Icon(
                            isSignUp ? Icons.person_add_alt_1 : Icons.lock_outline,
                            color: AppColors.beigeLight,
                            size: 36,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    anim(
                      Text(
                        isSignUp ? 'Create an account' : 'Welcome back',
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                              color: AppColors.textOnBeige,
                              fontWeight: FontWeight.bold,
                            ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 4),
                    anim(
                      Text(
                        isSignUp ? 'Sign up to get started' : 'Log in to continue',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: AppColors.textOnBeige.withValues(alpha: 0.7),
                            ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 28),
                    if (isSignUp) ...[
                      anim(
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16),
                          child: TextFormField(
                            controller: _nameController,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Full name',
                              prefixIcon: Icon(Icons.person_outline),
                            ),
                            validator: (value) {
                              if (value == null || value.trim().isEmpty) {
                                return 'Please enter your name';
                              }
                              return null;
                            },
                          ),
                        ),
                      ),
                    ],
                    anim(
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: TextFormField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(
                            labelText: 'Email',
                            prefixIcon: Icon(Icons.email_outlined),
                          ),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return 'Please enter your email';
                            }
                            if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                                .hasMatch(value.trim())) {
                              return 'Please enter a valid email';
                            }
                            return null;
                          },
                        ),
                      ),
                    ),
                    anim(
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          textInputAction:
                              isSignUp ? TextInputAction.next : TextInputAction.done,
                          onFieldSubmitted: isSignUp ? null : (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: 'Password',
                            prefixIcon: const Icon(Icons.lock_outline),
                            suffixIcon: IconButton(
                              icon: Icon(_obscurePassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined),
                              onPressed: () => setState(
                                  () => _obscurePassword = !_obscurePassword),
                            ),
                          ),
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return 'Please enter a password';
                            }
                            if (isSignUp && value.length < 6) {
                              return 'Password must be at least 6 characters';
                            }
                            return null;
                          },
                        ),
                      ),
                    ),
                    if (isSignUp)
                      anim(
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16),
                          child: TextFormField(
                            controller: _confirmPasswordController,
                            obscureText: _obscureConfirmPassword,
                            textInputAction: TextInputAction.done,
                            onFieldSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              labelText: 'Confirm password',
                              prefixIcon: const Icon(Icons.lock_outline),
                              suffixIcon: IconButton(
                                icon: Icon(_obscureConfirmPassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined),
                                onPressed: () => setState(() =>
                                    _obscureConfirmPassword = !_obscureConfirmPassword),
                              ),
                            ),
                            validator: (value) {
                              if (value != _passwordController.text) {
                                return 'Passwords do not match';
                              }
                              return null;
                            },
                          ),
                        ),
                      ),
                    if (_errorMessage != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          _errorMessage!,
                          style: const TextStyle(color: Colors.redAccent),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    anim(
                      ElevatedButton(
                        onPressed: _isSubmitting ? null : _submit,
                        child: _isSubmitting
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  valueColor:
                                      AlwaysStoppedAnimation(AppColors.beigeLight),
                                ),
                              )
                            : Text(isSignUp ? 'Sign Up' : 'Log In'),
                      ),
                    ),
                    const SizedBox(height: 20),
                    anim(_buildSwitchModeLink(isSignUp)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
      backgroundColor: AppColors.beigeLight,
    );
  }

  Widget _buildSwitchModeLink(bool isSignUp) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          isSignUp ? 'Already have an account?' : "Don't have an account?",
          style: TextStyle(color: AppColors.textOnBeige.withValues(alpha: 0.7)),
        ),
        TextButton(
          onPressed: () =>
              _switchMode(isSignUp ? _AuthMode.login : _AuthMode.signUp),
          child: Text(
            isSignUp ? 'Log In' : 'Sign Up',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
      ],
    );
  }
}
