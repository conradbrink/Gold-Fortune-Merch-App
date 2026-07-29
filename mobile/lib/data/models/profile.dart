class Profile {
  final String id;
  final String orgId;
  final String role; // 'manager' | 'rep'
  final String? fullName;
  final String? email;

  const Profile({
    required this.id,
    required this.orgId,
    required this.role,
    this.fullName,
    this.email,
  });

  bool get isRep => role == 'rep';

  factory Profile.fromMap(Map<String, dynamic> map) {
    return Profile(
      id: map['id'] as String,
      orgId: map['org_id'] as String,
      role: map['role'] as String,
      fullName: map['full_name'] as String?,
      email: map['email'] as String?,
    );
  }
}
