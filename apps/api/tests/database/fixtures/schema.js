/**
 * Expected physical schema, transcribed from `04-data-model.md` §5.
 *
 * Columns are `[name, type, notNull]`, in the order the DDL declares them. The
 * type notation matches `normalizeType()` in the db helper.
 *
 * This fixture is deliberately independent of the migrations: it is written from
 * the specification, so a migration that drifts from the document fails here.
 */

export const TABLES = {
  'ref.roles': [
    ['id', 'uuid', true],
    ['name', 'varchar(50)', true],
    ['is_system_wide', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
    // Phase 19 (`CR-002`), REQ-ROLE-009. Last because ALTER TABLE appends.
    ['is_institution_assignable', 'boolean', true],
    // Phase 22 (`CR-003`), REQ-ROLE-011.
    ['is_pic_scoped', 'boolean', true],
  ],
  'ref.categories': [
    ['id', 'uuid', true],
    ['name', 'varchar(100)', true],
  ],
  'ref.measurement_units': [
    ['id', 'uuid', true],
    ['name', 'varchar(100)', true],
  ],
  'ref.contract_types': [
    ['id', 'integer', true],
    ['name', 'varchar(50)', true],
  ],
  'ref.funding_sources': [
    ['id', 'integer', true],
    ['name', 'varchar(100)', true],
    // Phase 26 (`CR-007`). Nullable until every historical row has been given a
    // business code — it is assigned, never derived from the name (REQ-REF-007).
    ['code', 'varchar(8)', false],
  ],
  'ref.account_codes': [
    ['code', 'char(12)', true],
    ['name', 'varchar(250)', true],
  ],
  'ref.transaction_types': [
    ['id', 'integer', true],
    ['name', 'varchar(100)', true],
  ],
  'ref.permissions': [
    ['code', 'varchar(100)', true],
    ['description', 'text', true],
  ],
  'ref.asset_classifications': [
    ['id', 'char(12)', true],
    ['parent_id', 'char(12)', false],
    ['name', 'varchar(255)', true],
    ['origin', 'integer', true],
    ['category_id', 'uuid', false],
    // Phase 17 (`CR-001`). All four are nullable and stay NULL for the 14,738
    // externally-sourced rows — only `origin = 3` populates them (BR-016).
    ['institution_id', 'uuid', false],
    ['created_by', 'uuid', false],
    ['created_at', 'timestamptz', false],
    ['updated_at', 'timestamptz', false],
  ],
  'ref.attribute_definitions': [
    ['id', 'uuid', true],
    ['classification_id', 'char(12)', true],
    ['name', 'varchar(100)', true],
    ['attribute_type', 'ref.attribute_type', true],
    ['scope', 'ref.attribute_scope', true],
    ['is_required', 'boolean', true],
    ['uses_measurement_unit', 'boolean', true],
    ['measurement_unit_id', 'uuid', false],
    ['description', 'text', false],
    ['sort_order', 'integer', true],
    ['is_active', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],

  'public.institutions': [
    ['id', 'uuid', true],
    ['name', 'varchar(50)', true],
    ['code', 'varchar(25)', true],
    ['address', 'text', true],
    ['is_active', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
    // Phase 25 (`CR-006`). Last because `ALTER TABLE ADD COLUMN` appends and
    // this fixture asserts physical order. Nullable, and deliberately not
    // backfilled: NULL means "not configured", so the institution receives the
    // application's default format (REQ-ORG-007).
    ['inventory_code_format', 'varchar(200)', false],
  ],
  'public.departments': [
    // Phase 20 (`CR-003`): surrogate UUID key; `code` is the former natural key,
    // now unique only within an institution.
    ['code', 'varchar(8)', true],
    ['name', 'varchar(75)', true],
    ['is_active', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
    ['id', 'uuid', true],
    ['institution_id', 'uuid', false],
    ['current_pic_user_id', 'uuid', false],
  ],
  'public.users': [
    ['id', 'uuid', true],
    ['username', 'varchar(25)', true],
    ['password_hash', 'char(60)', true],
    ['first_name', 'varchar(150)', true],
    ['last_name', 'varchar(150)', true],
    ['contact_info', 'text', false],
    ['institution_id', 'uuid', false],
    ['is_active', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.user_roles': [
    ['user_id', 'uuid', true],
    ['role_id', 'uuid', true],
    ['assigned_at', 'timestamptz', true],
  ],
  'public.role_permissions': [
    ['role_id', 'uuid', true],
    ['permission_code', 'varchar(100)', true],
    ['assigned_at', 'timestamptz', true],
  ],

  'public.vendors': [
    ['id', 'uuid', true],
    ['name', 'varchar(255)', true],
    ['contact_info', 'text', false],
    ['address', 'text', false],
    ['is_active', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.suppliers': [
    ['id', 'uuid', true],
    ['name', 'varchar(255)', true],
    ['address', 'text', false],
    ['contact_info', 'text', false],
    ['is_active', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.contracts': [
    ['id', 'uuid', true],
    ['contract_number', 'varchar(150)', true],
    ['supplier_id', 'uuid', false],
    ['contract_type_id', 'integer', false],
    ['contract_date', 'date', true],
    ['funding_source_id', 'integer', false],
    ['contract_value', 'numeric(15,2)', false],
    ['receiving_document', 'varchar(255)', false],
    ['receiving_date', 'date', false],
    ['institution_id', 'uuid', false],
    ['account_code', 'char(12)', false],
    ['notes', 'text', false],
    ['is_active', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.contract_items': [
    ['id', 'uuid', true],
    ['contract_id', 'uuid', true],
    ['asset_name', 'varchar(150)', true],
    ['specification', 'text', false],
    ['quantity', 'integer', false],
    ['unit_price', 'numeric(15,2)', false],
    ['unit_type', 'varchar(50)', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],

  'public.locations': [
    ['id', 'uuid', true],
    ['name', 'varchar(255)', true],
    ['classification_id', 'char(12)', true],
    ['parent_location_id', 'uuid', false],
    ['institution_id', 'uuid', false],
    ['is_active', 'boolean', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
    // Phase 21 (`CR-003`). Last because ALTER TABLE appends.
    ['current_pic_user_id', 'uuid', false],
  ],
  'public.location_floor_plans': [
    ['id', 'uuid', true],
    ['location_id', 'uuid', true],
    ['file_name', 'varchar(255)', true],
    ['file_type', 'varchar(100)', true],
    ['file_size', 'bigint', true],
    ['storage_reference', 'text', true],
    ['uploaded_by', 'uuid', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.floor_plan_areas': [
    ['id', 'uuid', true],
    ['floor_plan_id', 'uuid', true],
    ['location_id', 'uuid', true],
    ['polygon', 'jsonb', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.assets': [
    ['id', 'uuid', true],
    ['name', 'varchar(255)', true],
    ['classification_id', 'char(12)', true],
    ['vendor_id', 'uuid', false],
    ['contract_id', 'uuid', false],
    ['institution_id', 'uuid', false],
    ['description', 'text', false],
    ['is_active', 'boolean', true],
    ['created_by', 'uuid', false],
    ['updated_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.asset_units': [
    ['id', 'uuid', true],
    ['asset_id', 'uuid', true],
    ['description', 'text', false],
    ['contract_item_id', 'uuid', false],
    ['department_id', 'uuid', false],
    ['lifecycle_state', 'public.lifecycle_state', true],
    ['current_condition', 'public.condition_enum', false],
    ['current_location_id', 'uuid', false],
    ['is_active', 'boolean', true],
    ['created_by', 'uuid', false],
    ['updated_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
    // Phase 18 (`CR-001`), REQ-UNIT-007. LAST, not beside `asset_id` where it
    // would read better: `ALTER TABLE ADD COLUMN` appends, and this fixture
    // asserts physical order. Nullable — a unit whose asset has no institution
    // has nothing to build a code from.
    // Widened from `varchar(40)` by Phase 25 (`CR-006`): a configurable format
    // can render more than the one shape Phase 18 could produce, and the width
    // is the registry's worst case rather than a guess (REQ-UNIT-007).
    ['inventory_code', 'varchar(64)', false],
    // Phase 26 (`CR-007`). Nullable: required only where the institution's
    // format uses `{NUMBER_COMPOSITION}`. No unique index — uniqueness belongs
    // to the finished code (`BR-020`).
    ['number_composition', 'varchar(32)', false],
  ],
  'public.asset_unit_locations': [
    ['id', 'uuid', true],
    ['asset_unit_id', 'uuid', true],
    ['location_id', 'uuid', true],
    ['is_current', 'boolean', true],
    ['assigned_at', 'timestamptz', true],
    ['unassigned_at', 'timestamptz', false],
    ['created_at', 'timestamptz', true],
  ],
  // Phase 21 (`CR-003`) — temporal responsibility, same shape for both.
  'public.department_pic_assignments': [
    ['id', 'uuid', true],
    ['department_id', 'uuid', true],
    ['user_id', 'uuid', true],
    ['is_current', 'boolean', true],
    ['assigned_at', 'timestamptz', true],
    ['ended_at', 'timestamptz', false],
    ['assigned_by', 'uuid', false],
    ['ended_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
  ],
  'public.location_pic_assignments': [
    ['id', 'uuid', true],
    ['location_id', 'uuid', true],
    ['user_id', 'uuid', true],
    ['is_current', 'boolean', true],
    ['assigned_at', 'timestamptz', true],
    ['ended_at', 'timestamptz', false],
    ['assigned_by', 'uuid', false],
    ['ended_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
  ],
  'public.longitudinal_history': [
    ['id', 'uuid', true],
    ['asset_unit_id', 'uuid', true],
    ['description', 'text', true],
    ['condition', 'public.condition_enum', true],
    ['location_id', 'uuid', true],
    ['lifecycle_state', 'public.lifecycle_state', false],
    ['effective_from', 'timestamptz', true],
    ['effective_to', 'timestamptz', false],
    ['created_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
    // Phase 31 (`CR-012` `DEC-A`), REQ-COND-006. LAST, not beside
    // `lifecycle_state` where it would read better: `ALTER TABLE ADD COLUMN`
    // appends, and this fixture asserts physical order.
    //
    // NOT NULL and, deliberately, WITHOUT A DEFAULT (`DEC-B`) — a default of
    // `MANUAL` would let a writer that forgets the column silently satisfy the
    // monthly assessment requirement. `UUID_DEFAULT_TABLES` above asserts what
    // does default; nothing here may quietly gain one.
    ['entry_type', 'public.history_entry_type', true],
  ],
  'public.asset_attribute_values': [
    ['id', 'uuid', true],
    ['asset_id', 'uuid', true],
    ['attribute_definition_id', 'uuid', true],
    ['value_text', 'text', false],
    ['value_numeric', 'numeric(20,4)', false],
    ['value_boolean', 'boolean', false],
    ['value_date', 'date', false],
    ['value_reference', 'varchar(255)', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.asset_unit_attribute_values': [
    ['id', 'uuid', true],
    ['asset_unit_id', 'uuid', true],
    ['attribute_definition_id', 'uuid', true],
    ['value_text', 'text', false],
    ['value_numeric', 'numeric(20,4)', false],
    ['value_boolean', 'boolean', false],
    ['value_date', 'date', false],
    ['value_reference', 'varchar(255)', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.attachments': [
    ['id', 'uuid', true],
    ['asset_id', 'uuid', true],
    ['asset_unit_id', 'uuid', false],
    ['file_name', 'varchar(255)', true],
    ['file_type', 'varchar(100)', true],
    ['file_size', 'bigint', true],
    ['storage_reference', 'text', true],
    ['uploaded_by', 'uuid', true],
    ['created_at', 'timestamptz', true],
  ],

  'public.borrowings': [
    ['id', 'uuid', true],
    ['borrower_name', 'varchar(255)', true],
    ['borrower_contact', 'text', true],
    ['borrow_date', 'date', true],
    ['expected_return_date', 'date', true],
    ['actual_return_date', 'date', false],
    ['responsible_person_id', 'uuid', false],
    ['institution_id', 'uuid', true],
    ['description', 'text', false],
    ['status', 'public.borrowing_status', true],
    ['created_by', 'uuid', false],
    ['updated_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.borrowing_items': [
    ['id', 'uuid', true],
    ['borrowing_id', 'uuid', true],
    ['asset_unit_id', 'uuid', true],
    ['created_at', 'timestamptz', true],
  ],
  'public.transactions': [
    ['id', 'uuid', true],
    ['transaction_date', 'date', true],
    ['transaction_type_id', 'integer', true],
    ['description', 'text', false],
    ['supplier_id', 'uuid', false],
    ['contract_id', 'uuid', false],
    ['institution_id', 'uuid', false],
    ['created_by', 'uuid', true],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.transaction_items': [
    ['id', 'uuid', true],
    ['transaction_id', 'uuid', true],
    ['asset_unit_id', 'uuid', true],
    ['notes', 'text', false],
    ['created_at', 'timestamptz', true],
  ],

  'audit.audit_logs': [
    ['id', 'uuid', true],
    ['actor_id', 'uuid', false],
    ['action', 'audit.audit_action', true],
    ['entity_type', 'varchar(100)', true],
    ['entity_id', 'varchar(255)', true],
    ['timestamp', 'timestamptz', true],
    ['old_values', 'jsonb', false],
    ['new_values', 'jsonb', false],
    ['ip_address', 'inet', false],
    ['metadata', 'jsonb', false],
  ],
};

/** Enumerated types — `04-data-model.md` §4. Label order is significant. */
export const ENUMS = {
  'public.status_enum': ['ACTIVE', 'INACTIVE'],
  'public.borrowing_status': ['DRAFT', 'ACTIVE', 'RETURNED', 'OVERDUE', 'CANCELLED'],
  'public.lifecycle_state': [
    'REGISTERED',
    'ACTIVE',
    'IN_STORAGE',
    'BORROWED',
    'UNDER_MAINTENANCE',
    'DISPOSED',
    'DEACTIVATED',
  ],
  'public.condition_enum': ['GOOD', 'FAIR', 'POOR', 'DAMAGED', 'UNSERVICEABLE'],
  // `CR-012`, migration 048. `SYSTEM` is reserved and has no writer.
  'public.history_entry_type': ['MANUAL', 'BORROWING', 'SYSTEM'],
  'ref.attribute_type': ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECTION', 'REFERENCE'],
  'ref.attribute_scope': ['ASSET', 'ASSET_UNIT'],
  'audit.audit_action': ['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'],
};

/** Primary keys, by constraint name. */
export const PRIMARY_KEYS = {
  pk_roles: 'ref.roles',
  pk_categories: 'ref.categories',
  pk_measurement_units: 'ref.measurement_units',
  pk_contract_types: 'ref.contract_types',
  pk_funding_sources: 'ref.funding_sources',
  pk_account_codes: 'ref.account_codes',
  pk_transaction_types: 'ref.transaction_types',
  pk_permissions: 'ref.permissions',
  pk_asset_classifications: 'ref.asset_classifications',
  pk_attribute_definitions: 'ref.attribute_definitions',
  pk_institutions: 'public.institutions',
  pk_departments: 'public.departments',
  pk_users: 'public.users',
  pk_user_roles: 'public.user_roles',
  pk_role_permissions: 'public.role_permissions',
  pk_vendors: 'public.vendors',
  pk_suppliers: 'public.suppliers',
  pk_contracts: 'public.contracts',
  pk_contract_items: 'public.contract_items',
  pk_locations: 'public.locations',
  pk_location_floor_plans: 'public.location_floor_plans',
  pk_floor_plan_areas: 'public.floor_plan_areas',
  pk_assets: 'public.assets',
  pk_asset_units: 'public.asset_units',
  pk_asset_unit_locations: 'public.asset_unit_locations',
  pk_department_pic_assignments: 'public.department_pic_assignments',
  pk_location_pic_assignments: 'public.location_pic_assignments',
  pk_longitudinal_history: 'public.longitudinal_history',
  pk_asset_attribute_values: 'public.asset_attribute_values',
  pk_asset_unit_attribute_values: 'public.asset_unit_attribute_values',
  pk_attachments: 'public.attachments',
  pk_borrowings: 'public.borrowings',
  pk_borrowing_items: 'public.borrowing_items',
  pk_transactions: 'public.transactions',
  pk_transaction_items: 'public.transaction_items',
  pk_audit_logs: 'audit.audit_logs',
};

/** Unique constraints, by name. */
export const UNIQUE_CONSTRAINTS = [
  'uq_roles_name',
  'uq_categories_name',
  'uq_measurement_units_name',
  'uq_contract_types_name',
  'uq_funding_sources_name',
  'uq_transaction_types_name',
  'uq_institutions_code',
  // Phase 20 (`CR-003`): a department code is unique WITHIN an institution, so
  // two institutions may each run a `TKJ`.
  'uq_departments_institution_code',
  'uq_users_username',
  'uq_contracts_number',
  'uq_location_floor_plans_location',
  'uq_floor_plan_areas_location',
  'uq_asset_attribute_values_asset_attr',
  'uq_asset_unit_attribute_values_unit_attr',
  'uq_borrowing_items_borrowing_unit',
  'uq_transaction_items_txn_unit',
];

/**
 * Check constraints, by name.
 *
 * Includes `chk_location_floor_plans_file_size`, which appears in the §5.3.9 DDL
 * but is missing from the §8.1 summary table. The DDL is authoritative.
 */
export const CHECK_CONSTRAINTS = [
  'chk_asset_classifications_no_self_ref',
  'chk_asset_classifications_origin',
  'chk_institutions_code_url_safe',
  // Phase 25 (`CR-006`). Characters only — tokens, ordering, the single
  // trailing sequence and the length ceiling are the application's to validate,
  // where the error can name the offending position (REQ-ORG-007).
  'chk_institutions_inventory_code_format',
  // Phase 26 (`CR-007`). Tolerates NULL: the codes are a business decision that
  // the migration deliberately does not make (REQ-REF-007).
  'chk_funding_sources_code_url_safe',
  'chk_roles_system_wide_not_assignable',
  'chk_roles_system_wide_not_pic_scoped',
  'chk_locations_no_self_ref',
  'chk_asset_unit_locations_dates',
  'chk_longitudinal_history_dates',
  'chk_attachments_file_size',
  'chk_location_floor_plans_file_size',
  'chk_contract_items_quantity',
  'chk_contract_items_price',
  'chk_borrowings_return_after_borrow',
  'chk_borrowings_actual_return',
  // Phase 21 (`CR-003`): `is_current` and `ended_at` cannot disagree.
  'chk_dept_pic_dates',
  'chk_dept_pic_current',
  'chk_loc_pic_dates',
  'chk_loc_pic_current',
];

/** Foreign keys: name → [child table, referenced table, on-delete action]. */
export const FOREIGN_KEYS = {
  fk_asset_classifications_parent: [
    'ref.asset_classifications',
    'ref.asset_classifications',
    'NO ACTION',
  ],
  fk_asset_classifications_category: ['ref.asset_classifications', 'ref.categories', 'NO ACTION'],
  fk_asset_classifications_institution: [
    'ref.asset_classifications',
    'public.institutions',
    'NO ACTION',
  ],
  fk_asset_classifications_created_by: ['ref.asset_classifications', 'public.users', 'NO ACTION'],
  fk_attribute_definitions_classification: [
    'ref.attribute_definitions',
    'ref.asset_classifications',
    'NO ACTION',
  ],
  fk_attribute_definitions_unit: [
    'ref.attribute_definitions',
    'ref.measurement_units',
    'NO ACTION',
  ],

  fk_users_institution: ['public.users', 'public.institutions', 'NO ACTION'],
  // Phase 20 (`CR-003`): departments belong to an institution.
  fk_departments_institution: ['public.departments', 'public.institutions', 'NO ACTION'],
  fk_user_roles_user: ['public.user_roles', 'public.users', 'CASCADE'],
  fk_user_roles_role: ['public.user_roles', 'ref.roles', 'CASCADE'],
  fk_role_permissions_role: ['public.role_permissions', 'ref.roles', 'CASCADE'],
  fk_role_permissions_permission: ['public.role_permissions', 'ref.permissions', 'CASCADE'],

  fk_contracts_supplier: ['public.contracts', 'public.suppliers', 'NO ACTION'],
  fk_contracts_type: ['public.contracts', 'ref.contract_types', 'NO ACTION'],
  fk_contracts_funding: ['public.contracts', 'ref.funding_sources', 'NO ACTION'],
  fk_contracts_institution: ['public.contracts', 'public.institutions', 'NO ACTION'],
  fk_contracts_account: ['public.contracts', 'ref.account_codes', 'NO ACTION'],
  fk_contract_items_contract: ['public.contract_items', 'public.contracts', 'CASCADE'],

  fk_locations_classification: ['public.locations', 'ref.asset_classifications', 'NO ACTION'],
  fk_locations_parent: ['public.locations', 'public.locations', 'NO ACTION'],
  fk_locations_institution: ['public.locations', 'public.institutions', 'NO ACTION'],
  fk_location_floor_plans_location: ['public.location_floor_plans', 'public.locations', 'CASCADE'],
  fk_location_floor_plans_uploaded_by: ['public.location_floor_plans', 'public.users', 'NO ACTION'],
  fk_floor_plan_areas_floor_plan: [
    'public.floor_plan_areas',
    'public.location_floor_plans',
    'CASCADE',
  ],
  fk_floor_plan_areas_location: ['public.floor_plan_areas', 'public.locations', 'NO ACTION'],

  fk_assets_classification: ['public.assets', 'ref.asset_classifications', 'NO ACTION'],
  fk_assets_vendor: ['public.assets', 'public.vendors', 'NO ACTION'],
  fk_assets_contract: ['public.assets', 'public.contracts', 'NO ACTION'],
  fk_assets_institution: ['public.assets', 'public.institutions', 'NO ACTION'],
  fk_assets_created_by: ['public.assets', 'public.users', 'NO ACTION'],
  fk_assets_updated_by: ['public.assets', 'public.users', 'NO ACTION'],

  fk_asset_units_asset: ['public.asset_units', 'public.assets', 'NO ACTION'],
  fk_asset_units_contract_item: ['public.asset_units', 'public.contract_items', 'NO ACTION'],
  fk_asset_units_department: ['public.asset_units', 'public.departments', 'NO ACTION'],
  fk_asset_units_created_by: ['public.asset_units', 'public.users', 'NO ACTION'],
  fk_asset_units_updated_by: ['public.asset_units', 'public.users', 'NO ACTION'],
  fk_asset_units_current_location: ['public.asset_units', 'public.locations', 'NO ACTION'],

  fk_asset_unit_locations_unit: ['public.asset_unit_locations', 'public.asset_units', 'NO ACTION'],
  // Phase 21 (`CR-003`) — PIC assignment history.
  fk_dept_pic_parent: ['public.department_pic_assignments', 'public.departments', 'NO ACTION'],
  fk_dept_pic_user: ['public.department_pic_assignments', 'public.users', 'NO ACTION'],
  fk_dept_pic_assigned_by: ['public.department_pic_assignments', 'public.users', 'NO ACTION'],
  fk_dept_pic_ended_by: ['public.department_pic_assignments', 'public.users', 'NO ACTION'],
  fk_loc_pic_parent: ['public.location_pic_assignments', 'public.locations', 'NO ACTION'],
  fk_loc_pic_user: ['public.location_pic_assignments', 'public.users', 'NO ACTION'],
  fk_loc_pic_assigned_by: ['public.location_pic_assignments', 'public.users', 'NO ACTION'],
  fk_loc_pic_ended_by: ['public.location_pic_assignments', 'public.users', 'NO ACTION'],
  fk_departments_current_pic: ['public.departments', 'public.users', 'NO ACTION'],
  fk_locations_current_pic: ['public.locations', 'public.users', 'NO ACTION'],
  fk_asset_unit_locations_location: [
    'public.asset_unit_locations',
    'public.locations',
    'NO ACTION',
  ],

  fk_longitudinal_history_unit: ['public.longitudinal_history', 'public.asset_units', 'NO ACTION'],
  fk_longitudinal_history_location: [
    'public.longitudinal_history',
    'public.locations',
    'NO ACTION',
  ],
  fk_longitudinal_history_created_by: ['public.longitudinal_history', 'public.users', 'NO ACTION'],

  fk_asset_attribute_values_asset: ['public.asset_attribute_values', 'public.assets', 'CASCADE'],
  fk_asset_attribute_values_definition: [
    'public.asset_attribute_values',
    'ref.attribute_definitions',
    'NO ACTION',
  ],
  fk_asset_unit_attribute_values_unit: [
    'public.asset_unit_attribute_values',
    'public.asset_units',
    'CASCADE',
  ],
  fk_asset_unit_attribute_values_definition: [
    'public.asset_unit_attribute_values',
    'ref.attribute_definitions',
    'NO ACTION',
  ],

  fk_attachments_asset: ['public.attachments', 'public.assets', 'CASCADE'],
  fk_attachments_unit: ['public.attachments', 'public.asset_units', 'NO ACTION'],
  fk_attachments_uploaded_by: ['public.attachments', 'public.users', 'NO ACTION'],

  fk_borrowings_responsible: ['public.borrowings', 'public.users', 'NO ACTION'],
  fk_borrowings_institution: ['public.borrowings', 'public.institutions', 'NO ACTION'],
  fk_borrowings_created_by: ['public.borrowings', 'public.users', 'NO ACTION'],
  fk_borrowings_updated_by: ['public.borrowings', 'public.users', 'NO ACTION'],
  fk_borrowing_items_borrowing: ['public.borrowing_items', 'public.borrowings', 'CASCADE'],
  fk_borrowing_items_unit: ['public.borrowing_items', 'public.asset_units', 'NO ACTION'],

  fk_transactions_type: ['public.transactions', 'ref.transaction_types', 'NO ACTION'],
  fk_transactions_supplier: ['public.transactions', 'public.suppliers', 'NO ACTION'],
  fk_transactions_contract: ['public.transactions', 'public.contracts', 'NO ACTION'],
  fk_transactions_institution: ['public.transactions', 'public.institutions', 'NO ACTION'],
  fk_transactions_created_by: ['public.transactions', 'public.users', 'NO ACTION'],
  fk_transaction_items_transaction: ['public.transaction_items', 'public.transactions', 'CASCADE'],
  fk_transaction_items_unit: ['public.transaction_items', 'public.asset_units', 'NO ACTION'],
};

/** Every explicitly created index — `04-data-model.md` §5 DDL. */
export const INDEXES = [
  'idx_asset_classifications_parent',
  'idx_asset_classifications_category',
  'idx_asset_classifications_institution',
  'idx_asset_classifications_origin',
  'idx_attribute_definitions_classification',
  'idx_attribute_definitions_scope',
  'idx_users_institution',
  'idx_users_active',
  'idx_role_permissions_permission',
  'idx_vendors_name',
  'idx_vendors_active',
  'idx_suppliers_name',
  'idx_suppliers_active',
  'idx_contracts_supplier',
  'idx_contracts_institution',
  'idx_contracts_number',
  'idx_contract_items_contract',
  'idx_locations_classification',
  'idx_locations_parent',
  'idx_locations_institution',
  'idx_locations_active',
  'idx_floor_plan_areas_floor_plan',
  // Present in the §5.3.1 DDL, absent from the §7.2 summary table.
  'idx_assets_classification',
  'idx_assets_vendor',
  'idx_assets_contract',
  'idx_assets_institution',
  'idx_assets_active',
  'idx_assets_name',
  'idx_departments_institution',
  'idx_asset_units_asset',
  'idx_asset_units_department',
  'idx_asset_units_lifecycle',
  'idx_asset_units_condition',
  'idx_asset_units_location',
  'idx_asset_units_active',
  'idx_asset_unit_locations_unit',
  'idx_asset_unit_locations_location',
  'idx_asset_unit_locations_current',
  'idx_dept_pic_parent',
  'idx_dept_pic_user',
  'idx_dept_pic_user_current',
  'idx_loc_pic_parent',
  'idx_loc_pic_user',
  'idx_loc_pic_user_current',
  'idx_longitudinal_history_unit',
  'idx_longitudinal_history_unit_current',
  'idx_longitudinal_history_effective',
  'idx_longitudinal_history_location',
  'idx_asset_attribute_values_asset',
  'idx_asset_unit_attribute_values_unit',
  'idx_attachments_asset',
  'idx_attachments_unit',
  'idx_borrowings_institution',
  'idx_borrowings_status',
  'idx_borrowings_dates',
  'idx_borrowings_overdue',
  'idx_borrowing_items_borrowing',
  'idx_borrowing_items_unit',
  'idx_transactions_type',
  'idx_transactions_supplier',
  'idx_transactions_institution',
  'idx_transactions_date',
  'idx_transactions_contract',
  'idx_transaction_items_transaction',
  'idx_transaction_items_unit',
  'idx_audit_logs_entity',
  'idx_audit_logs_actor',
  'idx_audit_logs_timestamp',
  'idx_audit_logs_action',
];

/** Partial indexes and the predicate each must carry. */
export const PARTIAL_INDEXES = {
  idx_users_active: 'is_active = true',
  idx_vendors_active: 'is_active = true',
  idx_suppliers_active: 'is_active = true',
  idx_locations_active: 'is_active = true',
  idx_assets_active: 'is_active = true',
  idx_asset_units_active: 'is_active = true',
  idx_asset_unit_locations_current: 'is_current = true',
  // Phase 21 (`CR-003`). The `uq_*_pic_current` pair are partial UNIQUE
  // indexes and live in UNIQUE_INDEXES below — `explicitIndexes` scans `idx_%`.
  idx_dept_pic_user_current: 'is_current = true',
  idx_loc_pic_user_current: 'is_current = true',
  idx_longitudinal_history_unit_current: 'effective_to IS NULL',
  idx_borrowings_overdue: "status = 'ACTIVE'",
  // Phase 17. Partial because the only queries filtering on origin want the
  // application-defined rows, a handful beside the 14,738 seeded ones.
  idx_asset_classifications_origin: 'origin = 3',
};

/**
 * Unique INDEXES that are not unique CONSTRAINTS.
 *
 * PostgreSQL cannot express a partial UNIQUE constraint — only a partial unique
 * index — so these appear in `pg_indexes` but never in `pg_constraint`, and
 * `UNIQUE_CONSTRAINTS` above would never see them. They are also outside the
 * `idx_` naming the index tests scan, which is why they need their own list.
 */
export const UNIQUE_INDEXES = {
  // Phase 18. Partial so the absence of a code is not a value to collide with:
  // many units may carry no inventory code, and they do not conflict.
  uq_asset_units_inventory_code: 'inventory_code IS NOT NULL',
  // Phase 26 (`CR-007`). Partial for the same reason: several funding sources
  // may sit at NULL while their business codes are decided, and an absent code
  // is not a value to collide with.
  uq_funding_sources_code: 'code IS NOT NULL',
  // Phase 21 (`CR-003`). UNIQUE, unlike `idx_asset_unit_locations_current`:
  // this row decides who is responsible, so two of them is not a tidiness
  // problem but an unanswerable question.
  uq_dept_pic_current: 'is_current = true',
  uq_loc_pic_current: 'is_current = true',
};

/** Columns defaulting to `gen_random_uuid()` — the §1.6 ID strategy. */
export const UUID_DEFAULT_TABLES = [
  'ref.roles',
  'ref.categories',
  'ref.measurement_units',
  'ref.attribute_definitions',
  'public.institutions',
  'public.users',
  'public.vendors',
  'public.suppliers',
  'public.contracts',
  'public.contract_items',
  'public.locations',
  'public.location_floor_plans',
  'public.floor_plan_areas',
  'public.assets',
  'public.asset_units',
  'public.asset_unit_locations',
  'public.longitudinal_history',
  'public.asset_attribute_values',
  'public.asset_unit_attribute_values',
  'public.attachments',
  'public.borrowings',
  'public.borrowing_items',
  'public.transactions',
  'public.transaction_items',
  'audit.audit_logs',
];

/** Integer identity primary keys — §5.1.6, §5.1.7, §5.1.9. */
export const IDENTITY_TABLES = [
  'ref.contract_types',
  'ref.funding_sources',
  'ref.transaction_types',
];
