'use strict';

/**
 * Model associations.
 *
 * One association per foreign key in `04-data-model.md` §5 — the same 59 keys
 * verified in Phase 1. Association names are chosen to read as the domain reads
 * (`03-domain.md` §10's ERD), not as the column names do.
 *
 * `onDelete` is deliberately NOT declared here. The migrations already define
 * the cascade behaviour (§8.2) and the database enforces it; repeating it in
 * the ORM would create a second place for it to be wrong.
 */

function applyAssociations(models) {
  const {
    Role,
    Category,
    MeasurementUnit,
    Permission,
    AssetClassification,
    AttributeDefinition,
    Institution,
    Department,
    DepartmentPicAssignment,
    LocationPicAssignment,
    PositionAssignment,
    WorkflowDefinition,
    WorkflowDefinitionStep,
    Request,
    RequestItem,
    RequestStep,
    RequestStepItemNote,
    RequestDocument,
    RequestItemUnit,
    RequestItemUnitReceipt,
    RequestCloseEvent,
    RequestReceiptConfirmation,
    AssetUnitReport,
    Consumable,
    ConsumableStockMovement,
    User,
    UserRole,
    RolePermission,
    Vendor,
    Supplier,
    Contract,
    ContractItem,
    Location,
    LocationFloorPlan,
    FloorPlanArea,
    Asset,
    AssetUnit,
    AssetUnitLocation,
    LongitudinalHistory,
    AssetAttributeValue,
    AssetUnitAttributeValue,
    Attachment,
    Borrowing,
    BorrowingItem,
    Transaction,
    TransactionItem,
    ContractType,
    FundingSource,
    AccountCode,
    TransactionType,
  } = models;

  // --- Reference -------------------------------------------------------------

  AssetClassification.belongsTo(AssetClassification, {
    as: 'parent',
    foreignKey: 'parentId',
  });
  AssetClassification.hasMany(AssetClassification, {
    as: 'children',
    foreignKey: 'parentId',
  });
  AssetClassification.belongsTo(Category, { as: 'category', foreignKey: 'categoryId' });
  Category.hasMany(AssetClassification, { as: 'classifications', foreignKey: 'categoryId' });

  // Phase 17 (`CR-001`). Only `origin = 3` rows carry these; every seeded row
  // leaves both null, which is why neither association is required.
  AssetClassification.belongsTo(Institution, {
    as: 'institution',
    foreignKey: 'institutionId',
  });
  Institution.hasMany(AssetClassification, {
    as: 'classifications',
    foreignKey: 'institutionId',
  });
  AssetClassification.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });

  AttributeDefinition.belongsTo(AssetClassification, {
    as: 'classification',
    foreignKey: 'classificationId',
  });
  AssetClassification.hasMany(AttributeDefinition, {
    as: 'attributeDefinitions',
    foreignKey: 'classificationId',
  });
  AttributeDefinition.belongsTo(MeasurementUnit, {
    as: 'measurementUnit',
    foreignKey: 'measurementUnitId',
  });
  MeasurementUnit.hasMany(AttributeDefinition, {
    as: 'attributeDefinitions',
    foreignKey: 'measurementUnitId',
  });

  // --- Organization and authorization ----------------------------------------

  User.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Institution.hasMany(User, { as: 'users', foreignKey: 'institutionId' });

  // Phase 20 (`CR-003`). Optional on the Department side: a null institution
  // means UNASSIGNED, not shared.
  Department.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Institution.hasMany(Department, { as: 'departments', foreignKey: 'institutionId' });

  /**
   * Person in charge — Phase 21 (`CR-003`).
   *
   * `currentPic` is the DENORMALIZED live holder; `picAssignments` is the
   * authoritative history. Both are declared because both are read: the first
   * to answer "who is responsible" in one query, the second to answer "who was
   * responsible in March".
   */
  Department.belongsTo(User, { as: 'currentPic', foreignKey: 'currentPicUserId' });
  DepartmentPicAssignment.belongsTo(Department, {
    as: 'department',
    foreignKey: 'departmentId',
  });
  Department.hasMany(DepartmentPicAssignment, {
    as: 'picAssignments',
    foreignKey: 'departmentId',
  });
  DepartmentPicAssignment.belongsTo(User, { as: 'user', foreignKey: 'userId' });
  DepartmentPicAssignment.belongsTo(User, { as: 'assigner', foreignKey: 'assignedBy' });
  DepartmentPicAssignment.belongsTo(User, { as: 'ender', foreignKey: 'endedBy' });
  User.hasMany(DepartmentPicAssignment, {
    as: 'departmentPicAssignments',
    foreignKey: 'userId',
  });

  User.belongsToMany(Role, {
    as: 'roles',
    through: UserRole,
    foreignKey: 'userId',
    otherKey: 'roleId',
  });
  Role.belongsToMany(User, {
    as: 'users',
    through: UserRole,
    foreignKey: 'roleId',
    otherKey: 'userId',
  });
  UserRole.belongsTo(User, { as: 'user', foreignKey: 'userId' });
  UserRole.belongsTo(Role, { as: 'role', foreignKey: 'roleId' });

  Role.belongsToMany(Permission, {
    as: 'permissions',
    through: RolePermission,
    foreignKey: 'roleId',
    otherKey: 'permissionCode',
  });
  Permission.belongsToMany(Role, {
    as: 'roles',
    through: RolePermission,
    foreignKey: 'permissionCode',
    otherKey: 'roleId',
  });
  RolePermission.belongsTo(Role, { as: 'role', foreignKey: 'roleId' });
  RolePermission.belongsTo(Permission, { as: 'permission', foreignKey: 'permissionCode' });

  // --- Procurement -----------------------------------------------------------

  Contract.belongsTo(Supplier, { as: 'supplier', foreignKey: 'supplierId' });
  Supplier.hasMany(Contract, { as: 'contracts', foreignKey: 'supplierId' });
  Contract.belongsTo(ContractType, { as: 'contractType', foreignKey: 'contractTypeId' });
  ContractType.hasMany(Contract, { as: 'contracts', foreignKey: 'contractTypeId' });
  Contract.belongsTo(FundingSource, { as: 'fundingSource', foreignKey: 'fundingSourceId' });
  FundingSource.hasMany(Contract, { as: 'contracts', foreignKey: 'fundingSourceId' });
  Contract.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Institution.hasMany(Contract, { as: 'contracts', foreignKey: 'institutionId' });
  Contract.belongsTo(AccountCode, {
    as: 'account',
    foreignKey: 'accountCode',
    targetKey: 'code',
  });
  AccountCode.hasMany(Contract, {
    as: 'contracts',
    foreignKey: 'accountCode',
    sourceKey: 'code',
  });

  ContractItem.belongsTo(Contract, { as: 'contract', foreignKey: 'contractId' });
  Contract.hasMany(ContractItem, { as: 'items', foreignKey: 'contractId' });

  // --- Locations and floor plans ---------------------------------------------

  Location.belongsTo(AssetClassification, {
    as: 'classification',
    foreignKey: 'classificationId',
  });
  AssetClassification.hasMany(Location, { as: 'locations', foreignKey: 'classificationId' });
  Location.belongsTo(Location, { as: 'parent', foreignKey: 'parentLocationId' });
  Location.hasMany(Location, { as: 'children', foreignKey: 'parentLocationId' });
  Location.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Institution.hasMany(Location, { as: 'locations', foreignKey: 'institutionId' });
  // Migration 063 (REQ-REQUEST-023): the institution's Teacher Storage Room.
  Institution.belongsTo(Location, {
    as: 'teacherStorageLocation',
    foreignKey: 'teacherStorageLocationId',
  });

  // Person in charge — Phase 21 (`CR-003`). Responsibility and history only;
  // nothing in the authorization layer reads these (§5.4).
  Location.belongsTo(User, { as: 'currentPic', foreignKey: 'currentPicUserId' });
  LocationPicAssignment.belongsTo(Location, { as: 'location', foreignKey: 'locationId' });
  Location.hasMany(LocationPicAssignment, { as: 'picAssignments', foreignKey: 'locationId' });
  LocationPicAssignment.belongsTo(User, { as: 'user', foreignKey: 'userId' });
  LocationPicAssignment.belongsTo(User, { as: 'assigner', foreignKey: 'assignedBy' });
  LocationPicAssignment.belongsTo(User, { as: 'ender', foreignKey: 'endedBy' });
  User.hasMany(LocationPicAssignment, {
    as: 'locationPicAssignments',
    foreignKey: 'userId',
  });

  // School positions — Phase 35 (`CR-014`). Independent of both PIC tables: no
  // association links a position to a PIC assignment, and nothing in the
  // authorization layer reads these (`BR-028`).
  PositionAssignment.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  PositionAssignment.belongsTo(Department, { as: 'department', foreignKey: 'departmentId' });
  Department.hasMany(PositionAssignment, {
    as: 'positionAssignments',
    foreignKey: 'departmentId',
  });
  PositionAssignment.belongsTo(User, { as: 'user', foreignKey: 'userId' });
  PositionAssignment.belongsTo(User, { as: 'assigner', foreignKey: 'assignedBy' });
  PositionAssignment.belongsTo(User, { as: 'ender', foreignKey: 'endedBy' });
  User.hasMany(PositionAssignment, { as: 'positionAssignments', foreignKey: 'userId' });

  // Workflow definitions — Phase 36 (`CR-014`). A step names a position CODE;
  // nothing associates it with a PositionAssignment, because resolving the code
  // to a person is execution (Phase 38), not configuration.
  WorkflowDefinition.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  WorkflowDefinition.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });
  WorkflowDefinition.belongsTo(User, { as: 'publisher', foreignKey: 'publishedBy' });
  WorkflowDefinition.hasMany(WorkflowDefinitionStep, { as: 'steps', foreignKey: 'definitionId' });
  WorkflowDefinitionStep.belongsTo(WorkflowDefinition, {
    as: 'definition',
    foreignKey: 'definitionId',
  });

  // Requests — Phase 37 (`CR-014`). No association to assets or asset units:
  // a request is optional and nothing links to it yet (the unit link is
  // Phase 40).
  Request.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Request.belongsTo(User, { as: 'requester', foreignKey: 'requesterUserId' });
  Request.belongsTo(PositionAssignment, {
    as: 'requesterAssignment',
    foreignKey: 'requesterAssignmentId',
  });
  Request.belongsTo(Department, { as: 'requesterDepartment', foreignKey: 'requesterDepartmentId' });
  Request.belongsTo(Department, { as: 'department', foreignKey: 'departmentId' });
  Request.belongsTo(Location, { as: 'destination', foreignKey: 'destinationLocationId' });
  Request.belongsTo(WorkflowDefinition, {
    as: 'workflowDefinition',
    foreignKey: 'workflowDefinitionId',
  });
  Request.hasMany(RequestItem, { as: 'items', foreignKey: 'requestId' });
  RequestItem.belongsTo(Request, { as: 'request', foreignKey: 'requestId' });
  RequestItem.belongsTo(MeasurementUnit, {
    as: 'measurementUnit',
    foreignKey: 'measurementUnitId',
  });
  RequestItem.belongsTo(AssetClassification, {
    as: 'classification',
    foreignKey: 'classificationId',
  });

  // Request steps — Phase 38. The actor assignment is who acted and in which
  // capacity; it grants nothing (`BR-028`).
  Request.hasMany(RequestStep, { as: 'steps', foreignKey: 'requestId' });
  RequestStep.belongsTo(Request, { as: 'request', foreignKey: 'requestId' });
  RequestStep.belongsTo(User, { as: 'actedBy', foreignKey: 'actedByUserId' });
  RequestStep.belongsTo(PositionAssignment, {
    as: 'actedAs',
    foreignKey: 'actedAsAssignmentId',
  });

  // Request Revision — migration 059 (REQ-REQUEST-018). A revision decision's
  // optional per-item notes; the item link is detached if the item is deleted.
  RequestStep.hasMany(RequestStepItemNote, { as: 'itemNotes', foreignKey: 'requestStepId' });
  RequestStepItemNote.belongsTo(RequestStep, { as: 'step', foreignKey: 'requestStepId' });
  RequestStepItemNote.belongsTo(RequestItem, { as: 'item', foreignKey: 'requestItemId' });

  // Request documents — Phase 39. Owned by the request; `Attachment` is
  // unchanged (`CR-014` `DEC-O`).
  Request.hasMany(RequestDocument, { as: 'documents', foreignKey: 'requestId' });
  RequestDocument.belongsTo(Request, { as: 'request', foreignKey: 'requestId' });
  RequestDocument.belongsTo(User, { as: 'uploader', foreignKey: 'uploadedBy' });

  // Registration links — Phase 40. A unit fulfils at most one item
  // (`uq_request_item_units_unit`), hence `hasOne` from the unit.
  RequestItem.hasMany(RequestItemUnit, { as: 'links', foreignKey: 'requestItemId' });
  RequestItemUnit.belongsTo(RequestItem, { as: 'item', foreignKey: 'requestItemId' });
  RequestItemUnit.belongsTo(AssetUnit, { as: 'assetUnit', foreignKey: 'assetUnitId' });
  AssetUnit.hasOne(RequestItemUnit, { as: 'requestItemLink', foreignKey: 'assetUnitId' });
  RequestItemUnit.belongsTo(User, { as: 'linker', foreignKey: 'linkedBy' });

  // Receipts and close events — Phase 41. Receipts are a link's history; at
  // most one is active (`uq_riu_receipts_active`).
  RequestItemUnit.hasMany(RequestItemUnitReceipt, {
    as: 'receipts',
    foreignKey: 'requestItemUnitId',
  });
  RequestItemUnitReceipt.belongsTo(RequestItemUnit, {
    as: 'link',
    foreignKey: 'requestItemUnitId',
  });
  RequestItemUnitReceipt.belongsTo(User, { as: 'recorder', foreignKey: 'recordedBy' });
  RequestItemUnitReceipt.belongsTo(User, { as: 'reverser', foreignKey: 'reversedBy' });
  Request.hasMany(RequestCloseEvent, { as: 'closeEvents', foreignKey: 'requestId' });
  RequestCloseEvent.belongsTo(Request, { as: 'request', foreignKey: 'requestId' });
  RequestCloseEvent.belongsTo(User, { as: 'closer', foreignKey: 'closedBy' });

  // Receipt confirmations — migration 057. One per Record Receipt action: its
  // receipts point here, and so do its photos (`CONFIRMATION_PHOTO` documents).
  Request.hasMany(RequestReceiptConfirmation, {
    as: 'receiptConfirmations',
    foreignKey: 'requestId',
  });
  RequestReceiptConfirmation.belongsTo(Request, { as: 'request', foreignKey: 'requestId' });
  RequestReceiptConfirmation.belongsTo(User, { as: 'confirmer', foreignKey: 'confirmedBy' });
  RequestReceiptConfirmation.hasMany(RequestItemUnitReceipt, {
    as: 'receipts',
    foreignKey: 'receiptConfirmationId',
  });
  RequestItemUnitReceipt.belongsTo(RequestReceiptConfirmation, {
    as: 'confirmation',
    foreignKey: 'receiptConfirmationId',
  });
  RequestReceiptConfirmation.hasMany(RequestDocument, {
    as: 'photos',
    foreignKey: 'receiptConfirmationId',
  });
  // Migration 062 (REQ-REQUEST-022): the received unit a confirmation photo shows.
  RequestDocument.belongsTo(RequestItemUnitReceipt, {
    as: 'receipt',
    foreignKey: 'requestItemUnitReceiptId',
  });

  LocationFloorPlan.belongsTo(Location, { as: 'location', foreignKey: 'locationId' });
  // hasOne, not hasMany: uq_location_floor_plans_location makes it strictly 1:1.
  Location.hasOne(LocationFloorPlan, { as: 'floorPlan', foreignKey: 'locationId' });
  LocationFloorPlan.belongsTo(User, { as: 'uploader', foreignKey: 'uploadedBy' });

  FloorPlanArea.belongsTo(LocationFloorPlan, { as: 'floorPlan', foreignKey: 'floorPlanId' });
  LocationFloorPlan.hasMany(FloorPlanArea, { as: 'areas', foreignKey: 'floorPlanId' });
  FloorPlanArea.belongsTo(Location, { as: 'location', foreignKey: 'locationId' });
  Location.hasOne(FloorPlanArea, { as: 'floorPlanArea', foreignKey: 'locationId' });

  // --- Asset core ------------------------------------------------------------

  Asset.belongsTo(AssetClassification, {
    as: 'classification',
    foreignKey: 'classificationId',
  });
  AssetClassification.hasMany(Asset, { as: 'assets', foreignKey: 'classificationId' });
  Asset.belongsTo(Vendor, { as: 'vendor', foreignKey: 'vendorId' });
  Vendor.hasMany(Asset, { as: 'assets', foreignKey: 'vendorId' });
  Asset.belongsTo(Contract, { as: 'contract', foreignKey: 'contractId' });
  Contract.hasMany(Asset, { as: 'assets', foreignKey: 'contractId' });
  Asset.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Institution.hasMany(Asset, { as: 'assets', foreignKey: 'institutionId' });
  Asset.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });
  Asset.belongsTo(User, { as: 'updater', foreignKey: 'updatedBy' });

  AssetUnit.belongsTo(Asset, { as: 'asset', foreignKey: 'assetId' });
  Asset.hasMany(AssetUnit, { as: 'units', foreignKey: 'assetId' });
  AssetUnit.belongsTo(ContractItem, { as: 'contractItem', foreignKey: 'contractItemId' });
  ContractItem.hasMany(AssetUnit, { as: 'assetUnits', foreignKey: 'contractItemId' });
  AssetUnit.belongsTo(Department, { as: 'department', foreignKey: 'departmentId' });
  Department.hasMany(AssetUnit, { as: 'assetUnits', foreignKey: 'departmentId' });
  AssetUnit.belongsTo(Location, { as: 'currentLocation', foreignKey: 'currentLocationId' });
  Location.hasMany(AssetUnit, { as: 'assetUnits', foreignKey: 'currentLocationId' });
  // Acquisition fact — migration 056, REQ-UNIT-012.
  AssetUnit.belongsTo(FundingSource, { as: 'fundingSource', foreignKey: 'fundingSourceId' });
  FundingSource.hasMany(AssetUnit, { as: 'assetUnits', foreignKey: 'fundingSourceId' });
  AssetUnit.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });
  AssetUnit.belongsTo(User, { as: 'updater', foreignKey: 'updatedBy' });

  AssetUnitLocation.belongsTo(AssetUnit, { as: 'assetUnit', foreignKey: 'assetUnitId' });
  AssetUnit.hasMany(AssetUnitLocation, { as: 'locationHistory', foreignKey: 'assetUnitId' });
  AssetUnitLocation.belongsTo(Location, { as: 'location', foreignKey: 'locationId' });
  Location.hasMany(AssetUnitLocation, { as: 'unitAssignments', foreignKey: 'locationId' });

  LongitudinalHistory.belongsTo(AssetUnit, { as: 'assetUnit', foreignKey: 'assetUnitId' });
  AssetUnit.hasMany(LongitudinalHistory, { as: 'history', foreignKey: 'assetUnitId' });
  LongitudinalHistory.belongsTo(Location, { as: 'location', foreignKey: 'locationId' });
  Location.hasMany(LongitudinalHistory, { as: 'history', foreignKey: 'locationId' });
  LongitudinalHistory.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });

  AssetAttributeValue.belongsTo(Asset, { as: 'asset', foreignKey: 'assetId' });
  Asset.hasMany(AssetAttributeValue, { as: 'attributeValues', foreignKey: 'assetId' });
  AssetAttributeValue.belongsTo(AttributeDefinition, {
    as: 'definition',
    foreignKey: 'attributeDefinitionId',
  });
  AttributeDefinition.hasMany(AssetAttributeValue, {
    as: 'assetValues',
    foreignKey: 'attributeDefinitionId',
  });

  AssetUnitAttributeValue.belongsTo(AssetUnit, { as: 'assetUnit', foreignKey: 'assetUnitId' });
  AssetUnit.hasMany(AssetUnitAttributeValue, {
    as: 'attributeValues',
    foreignKey: 'assetUnitId',
  });
  AssetUnitAttributeValue.belongsTo(AttributeDefinition, {
    as: 'definition',
    foreignKey: 'attributeDefinitionId',
  });
  AttributeDefinition.hasMany(AssetUnitAttributeValue, {
    as: 'assetUnitValues',
    foreignKey: 'attributeDefinitionId',
  });

  Attachment.belongsTo(Asset, { as: 'asset', foreignKey: 'assetId' });
  Asset.hasMany(Attachment, { as: 'attachments', foreignKey: 'assetId' });
  Attachment.belongsTo(AssetUnit, { as: 'assetUnit', foreignKey: 'assetUnitId' });
  AssetUnit.hasMany(Attachment, { as: 'attachments', foreignKey: 'assetUnitId' });
  Attachment.belongsTo(User, { as: 'uploader', foreignKey: 'uploadedBy' });

  // --- Operations ------------------------------------------------------------

  Borrowing.belongsTo(User, { as: 'responsiblePerson', foreignKey: 'responsiblePersonId' });
  Borrowing.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Institution.hasMany(Borrowing, { as: 'borrowings', foreignKey: 'institutionId' });
  Borrowing.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });
  Borrowing.belongsTo(User, { as: 'updater', foreignKey: 'updatedBy' });

  BorrowingItem.belongsTo(Borrowing, { as: 'borrowing', foreignKey: 'borrowingId' });
  Borrowing.hasMany(BorrowingItem, { as: 'items', foreignKey: 'borrowingId' });
  BorrowingItem.belongsTo(AssetUnit, { as: 'assetUnit', foreignKey: 'assetUnitId' });
  AssetUnit.hasMany(BorrowingItem, { as: 'borrowingItems', foreignKey: 'assetUnitId' });

  Transaction.belongsTo(TransactionType, {
    as: 'transactionType',
    foreignKey: 'transactionTypeId',
  });
  TransactionType.hasMany(Transaction, { as: 'transactions', foreignKey: 'transactionTypeId' });
  Transaction.belongsTo(Supplier, { as: 'supplier', foreignKey: 'supplierId' });
  Supplier.hasMany(Transaction, { as: 'transactions', foreignKey: 'supplierId' });
  Transaction.belongsTo(Contract, { as: 'contract', foreignKey: 'contractId' });
  Contract.hasMany(Transaction, { as: 'transactions', foreignKey: 'contractId' });
  Transaction.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Institution.hasMany(Transaction, { as: 'transactions', foreignKey: 'institutionId' });
  Transaction.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });

  TransactionItem.belongsTo(Transaction, { as: 'transaction', foreignKey: 'transactionId' });
  Transaction.hasMany(TransactionItem, { as: 'items', foreignKey: 'transactionId' });
  TransactionItem.belongsTo(AssetUnit, { as: 'assetUnit', foreignKey: 'assetUnitId' });
  AssetUnit.hasMany(TransactionItem, { as: 'transactionItems', foreignKey: 'assetUnitId' });

  // Migration 066 (REQ-REQUEST-025): a Room PIC's report about one unit.
  AssetUnitReport.belongsTo(AssetUnit, { as: 'assetUnit', foreignKey: 'assetUnitId' });
  AssetUnitReport.belongsTo(User, { as: 'reporter', foreignKey: 'reporterId' });
  AssetUnitReport.belongsTo(User, { as: 'reviewer', foreignKey: 'reviewedBy' });
  AssetUnitReport.belongsTo(LongitudinalHistory, { as: 'history', foreignKey: 'historyId' });

  // Migration 067 (§73): consumables, their stock movements, and the request
  // lines that name one.
  Consumable.belongsTo(Institution, { as: 'institution', foreignKey: 'institutionId' });
  Consumable.belongsTo(MeasurementUnit, {
    as: 'measurementUnit',
    foreignKey: 'measurementUnitId',
  });
  Consumable.hasMany(ConsumableStockMovement, { as: 'movements', foreignKey: 'consumableId' });
  ConsumableStockMovement.belongsTo(Consumable, { as: 'consumable', foreignKey: 'consumableId' });
  ConsumableStockMovement.belongsTo(User, { as: 'actor', foreignKey: 'createdBy' });
  ConsumableStockMovement.belongsTo(RequestItem, {
    as: 'requestItem',
    foreignKey: 'requestItemId',
  });
  RequestItem.belongsTo(Consumable, { as: 'consumable', foreignKey: 'consumableId' });
  RequestItem.hasMany(ConsumableStockMovement, { as: 'issues', foreignKey: 'requestItemId' });

  // `audit.audit_logs.actor_id` has no association: the DDL defines no foreign
  // key, so there is no referential relationship to model.
}

module.exports = { applyAssociations };
