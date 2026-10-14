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
    // Migration 063 — the Teacher Storage Room (REQ-REQUEST-023). NULL means
    // not configured; no backfill.
    ['teacher_storage_location_id', 'uuid', false],
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
    // Migration 056 (`CR-014` Phase 42 acquisition facts, REQ-UNIT-012). Both
    // nullable, no default, no backfill; appended, so last.
    ['funding_source_id', 'integer', false],
    ['acquisition_date', 'date', false],
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
  // Phase 35 (`CR-014`) — school positions; the PIC shape plus the position
  // and the institution it is held in.
  'public.position_assignments': [
    ['id', 'uuid', true],
    ['institution_id', 'uuid', true],
    ['user_id', 'uuid', true],
    ['position_code', 'varchar(32)', true],
    ['department_id', 'uuid', false],
    ['is_current', 'boolean', true],
    ['assigned_at', 'timestamptz', true],
    ['ended_at', 'timestamptz', false],
    ['assigned_by', 'uuid', false],
    ['ended_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
  ],
  // Phase 36 (`CR-014`) — workflow definitions. `actor_position_code` is
  // nullable by decision D1: an undecided DRAFT actor, refused at publication.
  'public.workflow_definitions': [
    ['id', 'uuid', true],
    ['institution_id', 'uuid', true],
    ['category', 'varchar(10)', true],
    ['requester_position_code', 'varchar(32)', true],
    ['version', 'integer', true],
    ['status', 'varchar(10)', true],
    ['published_at', 'timestamptz', false],
    ['published_by', 'uuid', false],
    ['retired_at', 'timestamptz', false],
    ['created_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.workflow_definition_steps': [
    ['id', 'uuid', true],
    ['definition_id', 'uuid', true],
    ['sequence', 'smallint', true],
    ['step_type', 'varchar(10)', true],
    ['actor_position_code', 'varchar(32)', false],
    ['procurement_mode', 'varchar(10)', false],
    ['skip_if_requester_is_actor', 'boolean', true],
  ],
  // Phase 37 (`CR-014`) — requests, drafting only. `quantity_requested` is a
  // whole number of asset units (`CR-014` Q1, working assumption).
  'public.requests': [
    ['id', 'uuid', true],
    ['institution_id', 'uuid', true],
    ['request_number', 'varchar(32)', true],
    ['category', 'varchar(10)', true],
    ['title', 'varchar(255)', true],
    ['justification', 'text', false],
    ['requester_user_id', 'uuid', true],
    ['requester_assignment_id', 'uuid', true],
    ['requester_position_code', 'varchar(32)', true],
    ['requester_department_id', 'uuid', false],
    ['department_id', 'uuid', false],
    ['destination_location_id', 'uuid', false],
    ['needed_by', 'date', false],
    ['workflow_definition_id', 'uuid', false],
    ['status', 'varchar(20)', true],
    ['submitted_at', 'timestamptz', false],
    ['approved_at', 'timestamptz', false],
    ['closed_at', 'timestamptz', false],
    ['close_reason', 'text', false],
    ['created_by', 'uuid', false],
    ['updated_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.request_items': [
    ['id', 'uuid', true],
    ['request_id', 'uuid', true],
    ['line_no', 'smallint', true],
    ['description', 'varchar(255)', true],
    ['specification', 'text', false],
    ['quantity_requested', 'integer', true],
    ['quantity_cancelled', 'integer', true],
    ['measurement_unit_id', 'uuid', false],
    ['estimated_unit_price', 'numeric(15,2)', false],
    ['classification_id', 'char(12)', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
    // Migration 060 — the optional product link (REQ-REQUEST-019). Added by
    // ALTER, so it is the last column.
    ['reference_url', 'varchar(2048)', false],
    // Migration 067 (§73) — a consumable line. Added by ALTER, so last.
    ['consumable_id', 'uuid', false],
  ],
  // Phase 38 (`CR-014`) — the workflow snapshot and its execution.
  'public.request_steps': [
    ['id', 'uuid', true],
    ['request_id', 'uuid', true],
    ['sequence', 'smallint', true],
    ['step_type', 'varchar(10)', true],
    ['actor_position_code', 'varchar(32)', true],
    ['procurement_mode', 'varchar(10)', false],
    ['skip_if_requester_is_actor', 'boolean', true],
    ['state', 'varchar(10)', true],
    ['skip_reason', 'varchar(10)', false],
    ['acted_by_user_id', 'uuid', false],
    ['acted_as_assignment_id', 'uuid', false],
    ['comment', 'text', false],
    ['activated_at', 'timestamptz', false],
    ['completed_at', 'timestamptz', false],
    ['created_at', 'timestamptz', true],
    // Migration 059 — the approval cycle (REQ-REQUEST-018); every earlier row is 1.
    // Added by ALTER, so it is the last column.
    ['cycle', 'smallint', true],
  ],
  // Phase 39 (`CR-014`) — files attached to a request.
  'public.request_documents': [
    ['id', 'uuid', true],
    ['request_id', 'uuid', true],
    ['document_type', 'varchar(20)', true],
    ['title', 'varchar(255)', false],
    ['file_name', 'varchar(255)', true],
    ['file_type', 'varchar(100)', true],
    ['file_size', 'bigint', true],
    ['storage_reference', 'text', true],
    ['uploaded_by', 'uuid', true],
    ['created_at', 'timestamptz', true],
    // Migration 057: set exactly on a CONFIRMATION_PHOTO.
    ['receipt_confirmation_id', 'uuid', false],
    // Migration 062 — the received unit a confirmation photo shows
    // (REQ-REQUEST-022). Added by ALTER, so it is the last column.
    ['request_item_unit_receipt_id', 'uuid', false],
  ],
  // Phase 40 (`CR-014`) — registration links; no receipt column (Phase 41).
  'public.request_item_units': [
    ['id', 'uuid', true],
    ['request_item_id', 'uuid', true],
    ['asset_unit_id', 'uuid', true],
    ['linked_at', 'timestamptz', true],
    ['linked_by', 'uuid', true],
  ],
  // Phase 41 (`CR-014`) — receipts (append-only, reversible) and close events.
  'public.request_item_unit_receipts': [
    ['id', 'uuid', true],
    ['request_item_unit_id', 'uuid', true],
    ['received_on', 'date', true],
    ['recorded_at', 'timestamptz', true],
    ['recorded_by', 'uuid', true],
    ['note', 'text', false],
    ['reversed_at', 'timestamptz', false],
    ['reversed_by', 'uuid', false],
    ['reversal_reason', 'text', false],
    // Migration 057: null on a Phase 41 receipt (no backfill).
    ['receipt_confirmation_id', 'uuid', false],
  ],
  'public.request_close_events': [
    ['id', 'uuid', true],
    ['request_id', 'uuid', true],
    ['reason', 'text', true],
    ['closed_at', 'timestamptz', true],
    ['closed_by', 'uuid', true],
  ],
  // Migration 057 — the requester's receipt confirmation; immutable.
  'public.request_receipt_confirmations': [
    ['id', 'uuid', true],
    ['request_id', 'uuid', true],
    ['placement', 'varchar(24)', false],
    ['description', 'text', true],
    ['destination_location_id', 'uuid', false],
    ['destination_name', 'varchar(255)', false],
    ['confirmed_by', 'uuid', true],
    ['confirmed_at', 'timestamptz', true],
  ],
  // Migration 066 (REQ-REQUEST-025) — a Room PIC's report; the original
  // observation is immutable, the review written once.
  'public.asset_unit_reports': [
    ['id', 'uuid', true],
    ['institution_id', 'uuid', true],
    ['asset_unit_id', 'uuid', true],
    ['kind', 'varchar(20)', true],
    ['narrative', 'text', true],
    ['reported_condition', 'public.condition_enum', false],
    ['destination_location_id', 'uuid', false],
    ['destination_name', 'varchar(255)', false],
    ['snapshot_location_id', 'uuid', true],
    ['snapshot_location_name', 'varchar(255)', true],
    ['snapshot_condition', 'public.condition_enum', false],
    ['snapshot_history_id', 'uuid', false],
    ['reporter_id', 'uuid', true],
    ['reported_at', 'timestamptz', true],
    ['status', 'varchar(20)', true],
    ['reviewed_by', 'uuid', false],
    ['reviewed_at', 'timestamptz', false],
    ['review_note', 'text', false],
    ['stale_acknowledged', 'boolean', true],
    ['history_id', 'uuid', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  // Migration 067 (§73) — quantity-based stock and its append-only movements.
  'public.consumables': [
    ['id', 'uuid', true],
    ['institution_id', 'uuid', true],
    ['name', 'varchar(255)', true],
    ['description', 'text', false],
    ['measurement_unit_id', 'uuid', true],
    ['quantity_on_hand', 'integer', true],
    ['is_active', 'boolean', true],
    ['created_by', 'uuid', false],
    ['updated_by', 'uuid', false],
    ['created_at', 'timestamptz', true],
    ['updated_at', 'timestamptz', true],
  ],
  'public.consumable_stock_movements': [
    ['id', 'uuid', true],
    ['consumable_id', 'uuid', true],
    ['movement_type', 'varchar(20)', true],
    ['quantity', 'integer', true],
    ['balance_after', 'integer', true],
    ['request_item_id', 'uuid', false],
    ['note', 'text', false],
    ['created_by', 'uuid', true],
    ['created_at', 'timestamptz', true],
  ],
  // Migration 058 — request read state (P6); not audited.
  'public.request_views': [
    ['user_id', 'uuid', true],
    ['request_id', 'uuid', true],
    ['last_seen_at', 'timestamptz', true],
  ],
  // Migration 059 — a revision decision's per-item notes; immutable, snapshots.
  'public.request_step_item_notes': [
    ['id', 'uuid', true],
    ['request_step_id', 'uuid', true],
    ['request_item_id', 'uuid', false],
    ['line_no', 'smallint', true],
    ['item_description', 'varchar(255)', true],
    ['note', 'text', true],
    ['created_at', 'timestamptz', true],
  ],
  'public.longitudinal_history': [
    ['id', 'uuid', true],
    ['asset_unit_id', 'uuid', true],
    ['description', 'text', true],
    // Migration 064 (REQ-REQUEST-024): nullable, but only on a SYSTEM row
    // (chk_longitudinal_history_condition).
    ['condition', 'public.condition_enum', false],
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
    // Migration 061 — REGISTRATION_PHOTO or none (REQ-REQUEST-020). Added by
    // ALTER, so it is the last column.
    ['purpose', 'varchar(30)', false],
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
  // Migration 065 (REQ-REQUEST-025): REPORT — a confirmed Room PIC report.
  'public.history_entry_type': ['MANUAL', 'BORROWING', 'SYSTEM', 'REPORT'],
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
  pk_position_assignments: 'public.position_assignments',
  pk_workflow_definitions: 'public.workflow_definitions',
  pk_workflow_definition_steps: 'public.workflow_definition_steps',
  pk_requests: 'public.requests',
  pk_request_items: 'public.request_items',
  pk_request_steps: 'public.request_steps',
  pk_request_documents: 'public.request_documents',
  pk_request_item_units: 'public.request_item_units',
  pk_request_item_unit_receipts: 'public.request_item_unit_receipts',
  pk_request_close_events: 'public.request_close_events',
  pk_request_receipt_confirmations: 'public.request_receipt_confirmations',
  pk_asset_unit_reports: 'public.asset_unit_reports',
  // Migration 067 (§73).
  pk_consumables: 'public.consumables',
  pk_consumable_stock_movements: 'public.consumable_stock_movements',
  pk_request_views: 'public.request_views',
  pk_request_step_item_notes: 'public.request_step_item_notes',
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
  // Migration 063: makes (location, institution) referenceable.
  'uq_locations_id_institution',
  // Migration 066: one history row comes from one report.
  'uq_aur_history',
  // Migration 067: the target of the movements' composite key.
  'uq_request_items_id_consumable',
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
  // Phase 36 (`CR-014`): version numbers per key; step numbers per definition.
  'uq_wf_def_version',
  'uq_wf_step_sequence',
  // Phase 37 (`CR-014`): numbers per institution; lines per request.
  'uq_requests_number',
  'uq_request_items_line',
  // Phase 38: step numbers per request — per approval cycle since migration 059.
  'uq_request_steps_cycle_sequence',
  // Migration 059: one note per item per revision decision.
  'uq_rsin_step_item',
  'uq_request_item_units_unit',
  // Migration 062: makes (receipt, confirmation) referenceable by a photo.
  'uq_riu_receipts_id_confirmation',
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
  // Migration 064: only a SYSTEM row may omit the condition.
  'chk_longitudinal_history_condition',
  // Migration 066 (REQ-REQUEST-025).
  'chk_aur_kind',
  'chk_aur_status',
  'chk_aur_narrative',
  'chk_aur_condition',
  'chk_aur_destination',
  'chk_aur_review',
  'chk_aur_reject_note',
  'chk_aur_reviewer',
  'chk_aur_history',
  // Migration 067 (§73).
  'chk_consumables_name',
  'chk_consumables_on_hand',
  'chk_request_items_consumable',
  'chk_csm_type',
  'chk_csm_quantity',
  'chk_csm_balance',
  'chk_csm_request_item',
  'chk_csm_adjustment_note',
  'chk_attachments_file_size',
  // Migration 061: the one purpose, and only on a JPG / PNG.
  'chk_attachments_purpose',
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
  // Phase 35 (`CR-014`). The position list is a named CHECK, not an enum
  // (`DEC-U`); the drift test in 29-position-assignments keeps it in step.
  'chk_pos_assign_position',
  'chk_pos_assign_department',
  'chk_pos_assign_dates',
  'chk_pos_assign_current',
  // Phase 36 (`CR-014`). Category and position lists are named CHECKs (`DEC-U`);
  // the drift test in 30-workflow-definitions keeps them in step.
  'chk_wf_def_category',
  'chk_wf_def_requester',
  'chk_wf_def_status',
  'chk_wf_def_version',
  'chk_wf_def_published',
  'chk_wf_def_retired',
  'chk_wf_step_type',
  'chk_wf_step_actor',
  'chk_wf_step_mode',
  'chk_wf_step_mode_use',
  'chk_wf_step_sequence',
  // Phase 37 (`CR-014`). The last two are the approved additions (decision E6).
  'chk_requests_category',
  'chk_requests_requester',
  'chk_requests_status',
  'chk_requests_jurusan_department',
  'chk_requests_definition',
  'chk_requests_requester_department',
  'chk_requests_department_locked',
  'chk_request_items_quantity',
  'chk_request_items_cancelled',
  'chk_request_items_price',
  // Migration 060: an HTTP(S) link without whitespace or credentials — a backstop.
  'chk_request_items_reference_url',
  // Phase 38 (`CR-014`). The last three are the approved additions (F7).
  'chk_request_steps_type',
  'chk_request_steps_actor',
  'chk_request_steps_mode',
  'chk_request_steps_state',
  'chk_request_steps_skip',
  // Migration 059: the comment rule covers REJECTED and RETURNED.
  'chk_request_steps_decision_comment',
  'chk_request_steps_acted',
  'chk_request_steps_finished',
  'chk_request_steps_activated',
  // Migration 059: the approval cycle, and only a DECIDE step is RETURNED.
  'chk_request_steps_cycle',
  'chk_request_steps_returned_decide',
  'chk_rsin_note',
  'chk_rsin_line',
  'chk_request_documents_type',
  'chk_request_documents_size',
  'chk_riu_receipts_reversal',
  'chk_request_close_events_reason',
  // Migration 057.
  'chk_rrc_placement',
  'chk_rrc_destination',
  'chk_rrc_description',
  'chk_request_documents_confirmation',
  // Migration 062: only a confirmation photo names a receipt.
  'chk_request_documents_receipt_photo',
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
  // Migration 063: composite (location, institution) — the room is this
  // institution's own.
  fk_institutions_teacher_storage: ['public.institutions', 'public.locations', 'NO ACTION'],
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
  fk_asset_units_funding_source: ['public.asset_units', 'ref.funding_sources', 'NO ACTION'],

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
  fk_pos_assign_institution: ['public.position_assignments', 'public.institutions', 'NO ACTION'],
  fk_pos_assign_user: ['public.position_assignments', 'public.users', 'NO ACTION'],
  fk_pos_assign_department: ['public.position_assignments', 'public.departments', 'NO ACTION'],
  fk_pos_assign_assigned_by: ['public.position_assignments', 'public.users', 'NO ACTION'],
  fk_pos_assign_ended_by: ['public.position_assignments', 'public.users', 'NO ACTION'],
  fk_wf_def_institution: ['public.workflow_definitions', 'public.institutions', 'NO ACTION'],
  fk_wf_def_published_by: ['public.workflow_definitions', 'public.users', 'NO ACTION'],
  fk_wf_def_created_by: ['public.workflow_definitions', 'public.users', 'NO ACTION'],
  fk_wf_step_definition: [
    'public.workflow_definition_steps',
    'public.workflow_definitions',
    'CASCADE',
  ],
  // Phase 37 (`CR-014`). No cascade anywhere: items are removed only while
  // their request is a DRAFT, by the service.
  fk_requests_institution: ['public.requests', 'public.institutions', 'NO ACTION'],
  fk_requests_requester: ['public.requests', 'public.users', 'NO ACTION'],
  fk_requests_assignment: ['public.requests', 'public.position_assignments', 'NO ACTION'],
  fk_requests_req_dept: ['public.requests', 'public.departments', 'NO ACTION'],
  fk_requests_department: ['public.requests', 'public.departments', 'NO ACTION'],
  fk_requests_destination: ['public.requests', 'public.locations', 'NO ACTION'],
  fk_requests_definition: ['public.requests', 'public.workflow_definitions', 'NO ACTION'],
  fk_requests_created_by: ['public.requests', 'public.users', 'NO ACTION'],
  fk_requests_updated_by: ['public.requests', 'public.users', 'NO ACTION'],
  fk_request_items_request: ['public.request_items', 'public.requests', 'NO ACTION'],
  fk_request_items_unit: ['public.request_items', 'ref.measurement_units', 'NO ACTION'],
  fk_request_items_classification: [
    'public.request_items',
    'ref.asset_classifications',
    'NO ACTION',
  ],
  // Phase 38. No cascade: steps are the record of how a request was decided.
  fk_request_steps_request: ['public.request_steps', 'public.requests', 'NO ACTION'],
  fk_request_steps_acted_by: ['public.request_steps', 'public.users', 'NO ACTION'],
  fk_request_steps_acted_as: ['public.request_steps', 'public.position_assignments', 'NO ACTION'],
  fk_request_documents_request: ['public.request_documents', 'public.requests', 'NO ACTION'],
  fk_request_documents_uploader: ['public.request_documents', 'public.users', 'NO ACTION'],
  fk_riu_item: ['public.request_item_units', 'public.request_items', 'NO ACTION'],
  fk_riu_unit: ['public.request_item_units', 'public.asset_units', 'NO ACTION'],
  fk_riu_linked_by: ['public.request_item_units', 'public.users', 'NO ACTION'],
  fk_riu_receipts_link: ['public.request_item_unit_receipts', 'public.request_item_units', 'NO ACTION'],
  fk_riu_receipts_recorded_by: ['public.request_item_unit_receipts', 'public.users', 'NO ACTION'],
  fk_riu_receipts_reversed_by: ['public.request_item_unit_receipts', 'public.users', 'NO ACTION'],
  fk_request_close_events_request: ['public.request_close_events', 'public.requests', 'NO ACTION'],
  fk_request_close_events_closed_by: ['public.request_close_events', 'public.users', 'NO ACTION'],
  // Migration 058: read state.
  fk_request_views_user: ['public.request_views', 'public.users', 'NO ACTION'],
  fk_request_views_request: ['public.request_views', 'public.requests', 'NO ACTION'],
  // Migration 059. The item link is detached by the service, never by cascade.
  fk_rsin_step: ['public.request_step_item_notes', 'public.request_steps', 'NO ACTION'],
  fk_rsin_item: ['public.request_step_item_notes', 'public.request_items', 'NO ACTION'],
  // Migration 057. No cascade: a confirmation is evidence.
  fk_rrc_request: ['public.request_receipt_confirmations', 'public.requests', 'NO ACTION'],
  fk_rrc_destination: ['public.request_receipt_confirmations', 'public.locations', 'NO ACTION'],
  fk_rrc_confirmed_by: ['public.request_receipt_confirmations', 'public.users', 'NO ACTION'],
  // Migration 066 (REQ-REQUEST-025).
  fk_aur_institution: ['public.asset_unit_reports', 'public.institutions', 'NO ACTION'],
  fk_aur_unit: ['public.asset_unit_reports', 'public.asset_units', 'NO ACTION'],
  fk_aur_destination: ['public.asset_unit_reports', 'public.locations', 'NO ACTION'],
  fk_aur_snapshot_location: ['public.asset_unit_reports', 'public.locations', 'NO ACTION'],
  fk_aur_snapshot_history: ['public.asset_unit_reports', 'public.longitudinal_history', 'NO ACTION'],
  fk_aur_reporter: ['public.asset_unit_reports', 'public.users', 'NO ACTION'],
  fk_aur_reviewer: ['public.asset_unit_reports', 'public.users', 'NO ACTION'],
  fk_aur_history: ['public.asset_unit_reports', 'public.longitudinal_history', 'NO ACTION'],
  // Migration 067 (§73).
  fk_consumables_institution: ['public.consumables', 'public.institutions', 'NO ACTION'],
  fk_consumables_measurement_unit: ['public.consumables', 'ref.measurement_units', 'NO ACTION'],
  fk_consumables_created_by: ['public.consumables', 'public.users', 'NO ACTION'],
  fk_consumables_updated_by: ['public.consumables', 'public.users', 'NO ACTION'],
  fk_request_items_consumable: ['public.request_items', 'public.consumables', 'NO ACTION'],
  fk_csm_consumable: ['public.consumable_stock_movements', 'public.consumables', 'NO ACTION'],
  fk_csm_request_item: ['public.consumable_stock_movements', 'public.request_items', 'NO ACTION'],
  fk_csm_created_by: ['public.consumable_stock_movements', 'public.users', 'NO ACTION'],
  fk_riu_receipts_confirmation: [
    'public.request_item_unit_receipts',
    'public.request_receipt_confirmations',
    'NO ACTION',
  ],
  // Migration 062: composite (receipt, confirmation) — a unit photo's receipt is
  // one of its own confirmation's.
  fk_request_documents_receipt: [
    'public.request_documents',
    'public.request_item_unit_receipts',
    'NO ACTION',
  ],
  fk_request_documents_confirmation: [
    'public.request_documents',
    'public.request_receipt_confirmations',
    'NO ACTION',
  ],
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
  // Migration 063.
  'idx_institutions_teacher_storage',
  // Migration 066.
  'idx_aur_unit',
  'idx_aur_reporter',
  'idx_aur_institution_status',
  // Migration 067 (§73).
  'idx_request_items_consumable',
  'idx_csm_consumable',
  'idx_csm_request_item',
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
  // Migration 056 (REQ-UNIT-012). Partial: most units record no funding source.
  'idx_asset_units_funding_source',
  'idx_asset_unit_locations_unit',
  'idx_asset_unit_locations_location',
  'idx_asset_unit_locations_current',
  'idx_dept_pic_parent',
  'idx_dept_pic_user',
  'idx_dept_pic_user_current',
  'idx_loc_pic_parent',
  'idx_loc_pic_user',
  'idx_loc_pic_user_current',
  'idx_pos_assign_user_current',
  'idx_pos_assign_department',
  'idx_pos_assign_institution',
  'idx_requests_institution_status',
  'idx_requests_requester',
  'idx_requests_department',
  'idx_request_steps_open',
  'idx_request_documents_request',
  'idx_riu_item',
  'idx_request_close_events_request',
  // Migration 057.
  'idx_rrc_request',
  'idx_riu_receipts_confirmation',
  'idx_request_documents_confirmation',
  // Migration 062.
  'idx_request_documents_receipt',
  // Migration 059.
  'idx_rsin_step',
  'idx_rsin_item',
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
  // Migration 063: most institutions name no room.
  idx_institutions_teacher_storage: 'teacher_storage_location_id IS NOT NULL',
  idx_assets_active: 'is_active = true',
  idx_asset_units_active: 'is_active = true',
  idx_asset_units_funding_source: 'funding_source_id IS NOT NULL',
  idx_asset_unit_locations_current: 'is_current = true',
  // Phase 21 (`CR-003`). The `uq_*_pic_current` pair are partial UNIQUE
  // indexes and live in UNIQUE_INDEXES below — `explicitIndexes` scans `idx_%`.
  idx_dept_pic_user_current: 'is_current = true',
  idx_loc_pic_user_current: 'is_current = true',
  // Phase 35 (`CR-014`). Written `WHERE is_current`, which PostgreSQL keeps.
  idx_pos_assign_user_current: 'WHERE is_current',
  idx_pos_assign_department: 'department_id IS NOT NULL',
  idx_pos_assign_institution: 'WHERE is_current',
  // Phase 37 (`CR-014`).
  idx_requests_department: 'department_id IS NOT NULL',
  // Phase 38: "awaiting my action" and actor visibility.
  idx_request_steps_open: "'ACTIVE'",
  // Migration 057: most receipts / documents have no confirmation.
  idx_riu_receipts_confirmation: 'receipt_confirmation_id IS NOT NULL',
  idx_request_documents_confirmation: 'receipt_confirmation_id IS NOT NULL',
  // Migration 062: most photos show the whole confirmation.
  idx_request_documents_receipt: 'request_item_unit_receipt_id IS NOT NULL',
  // Migration 059: a note whose item was deleted has no link.
  idx_rsin_item: 'request_item_id IS NOT NULL',
  // Migration 067: most lines are asset lines; most movements are not issues.
  idx_request_items_consumable: 'consumable_id IS NOT NULL',
  idx_csm_request_item: 'request_item_id IS NOT NULL',
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
  // Phase 35 (`CR-014`). One current holder per single-holder post, one
  // Toolman department per person, no duplicate live assignment. The precise
  // behaviour of each is exercised in 29-position-assignments.
  uq_pos_assign_institution_post: 'KEPALA_SEKOLAH',
  uq_pos_assign_department_post: 'TOOLMAN',
  uq_pos_assign_one_toolman: 'TOOLMAN',
  uq_pos_assign_no_duplicate: 'WHERE is_current',
  // Phase 36 (`CR-014`). One ACTIVE and one DRAFT per (institution, category,
  // requester context); exercised in 30-workflow-definitions.
  uq_wf_def_active: "'ACTIVE'",
  uq_wf_def_draft: "'DRAFT'",
  // Phase 38: decisions run strictly in sequence (G1).
  uq_request_steps_one_active_decision: "'DECIDE'",
  // Migration 067 (§73): one name per institution, whatever its case — an
  // expression, not a predicate, so it can only be an index.
  uq_consumables_institution_name: 'lower((name)::text)',
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
  'public.position_assignments',
  'public.workflow_definitions',
  'public.workflow_definition_steps',
  'public.requests',
  'public.request_items',
  'public.request_steps',
  'public.request_documents',
  'public.request_item_units',
  'public.request_item_unit_receipts',
  'public.request_close_events',
  'public.request_receipt_confirmations',
  'public.asset_unit_reports',
  'public.consumables',
  'public.consumable_stock_movements',
  'public.request_step_item_notes',
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
