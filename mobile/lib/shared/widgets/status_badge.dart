import 'package:flutter/material.dart';
import '../../core/theme.dart';

class StatusBadgeConfig {
  final String label;
  final Color color;
  const StatusBadgeConfig(this.label, this.color);
}

StatusBadgeConfig statusBadgeConfig(String status) {
  switch (status) {
    case 'checked_out':
      return const StatusBadgeConfig('DONE', AppColors.success);
    case 'checked_in':
      return const StatusBadgeConfig('IN PROGRESS', AppColors.warning);
    case 'missed':
      return const StatusBadgeConfig('MISSED', AppColors.danger);
    default:
      return const StatusBadgeConfig('NOT STARTED', AppColors.info);
  }
}

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final config = statusBadgeConfig(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: config.color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: config.color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            config.label,
            style: TextStyle(
              color: config.color,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }
}
