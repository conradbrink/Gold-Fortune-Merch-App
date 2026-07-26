class FormFieldDef {
  final String id;
  final String label;
  final String fieldType; // text|number|photo|multiple_choice|boolean|date
  final List<String> options;
  final bool required;
  final int sortOrder;

  const FormFieldDef({
    required this.id,
    required this.label,
    required this.fieldType,
    required this.options,
    required this.required,
    required this.sortOrder,
  });

  factory FormFieldDef.fromMap(Map<String, dynamic> map) {
    final rawOptions = map['options'];
    return FormFieldDef(
      id: map['id'] as String,
      label: map['label'] as String,
      fieldType: map['field_type'] as String,
      options: rawOptions is List
          ? rawOptions.map((e) => e.toString()).toList()
          : const [],
      required: map['required'] as bool? ?? false,
      sortOrder: (map['sort_order'] as num?)?.toInt() ?? 0,
    );
  }
}

class FormTemplate {
  final String id;
  final String name;
  final String? description;
  final List<FormFieldDef> fields;

  const FormTemplate({
    required this.id,
    required this.name,
    this.description,
    required this.fields,
  });

  factory FormTemplate.fromMap(Map<String, dynamic> map) {
    final rawFields = (map['form_fields'] as List?) ?? const [];
    final fields = rawFields
        .map((f) => FormFieldDef.fromMap(f as Map<String, dynamic>))
        .toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    return FormTemplate(
      id: map['id'] as String,
      name: map['name'] as String,
      description: map['description'] as String?,
      fields: fields,
    );
  }
}
