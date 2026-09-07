/**
 * English — the source language and the fallback for every other one.
 *
 * Keys are grouped by where they are used, not by the words themselves, so a
 * screen's strings sit together and an unused key is visible. `common.*` is for
 * vocabulary that genuinely recurs — an action, a state, a table control. A
 * label used by exactly one screen belongs to that screen's group, even if some
 * other screen happens to use the same word today.
 */
export const en = {
  common: {
    actions: {
      add: 'Add',
      cancel: 'Cancel',
      clear: 'Clear',
      close: 'Close',
      confirm: 'Confirm',
      create: 'Create',
      deactivate: 'Deactivate',
      delete: 'Delete',
      edit: 'Edit',
      rename: 'Rename',
      reactivate: 'Reactivate',
      remove: 'Remove',
      retry: 'Try again',
      save: 'Save',
      saveChanges: 'Save changes',
      search: 'Search',
      view: 'View',
    },
    states: {
      loading: 'Loading…',
      empty: 'Nothing here yet',
      noResults: 'No results',
      notRecorded: 'Not recorded',
      notAssigned: 'Not assigned',
      none: 'None',
      /* The two ways an empty list can be empty. Which one a screen shows
         depends on whether the reader could do anything about it. */
      createFirst: 'Create the first one to get started.',
      noMatches: 'Nothing matches these filters.',
    },
    errors: {
      title: 'Something went wrong',
      forbidden: 'You do not have permission to do that.',
      notFound: 'That record could not be found.',
      conflict: 'That action conflicts with the current state of the record.',
      validation: 'Some of the information provided is not valid.',
      internal: 'Something went wrong on the server.',
      network: 'The server could not be reached. Check your connection.',
      unauthorized: 'Your session has expired. Please sign in again.',
      cancelled: 'The request was cancelled.',
      requestFailed: 'The request failed.',
    },
    fields: {
      name: 'Name',
      description: 'Description',
      status: 'Status',
      notes: 'Notes',
      date: 'Date',
      from: 'From',
      to: 'To',
      classification: 'Classification',
      institution: 'Institution',
      department: 'Department',
    },
    filters: {
      all: 'All',
      searchPlaceholder: 'Search…',
      status: 'Status',
    },
    /* Defaults for the shared pickers, so an unlabelled one is still localized
       rather than silently English. */
    select: {
      placeholder: 'Select…',
      search: 'Search…',
    },
    table: {
      /* The accessible name of a sortable column header. `field` is the API's
         own sort key (`06-api.md` §1.6) — the value the server orders by, not
         the visible heading, because that is what the control actually does. */
      sortBy: 'Sort by {{field}}',
    },
    pagination: {
      label: 'Pagination',
      range: '{{first}}–{{last}} of {{total}}',
      page: 'Page {{page}} of {{totalPages}}',
      pageEmpty: 'Page 0 of 0',
      previous: 'Previous page',
      next: 'Next page',
    },
    date: {
      pick: 'Pick a date',
      clear: 'Clear date',
    },
    language: {
      label: 'Language',
      change: 'Change language',
    },
    theme: {
      label: 'Theme',
      light: 'Light',
      dark: 'Dark',
      system: 'System',
    },
    toast: {
      created: '{{label}} created',
      updated: '{{label}} updated',
      deactivated: '{{label}} deactivated',
      reactivated: '{{label}} reactivated',
      deleted: '{{label}} deleted',
    },
  },

  operations: {
    borrowings: {
      extendDescription:
        'This record is closed as returned and a new draft is opened over the same units, so both keep the dates they actually had.',
      unitsEditable: 'The units this borrowing covers. Fixed once the borrowing is activated.',
      unitsFixed: 'The units this borrowing covers. Its composition is fixed.',
      title: 'Borrowings',
      description: 'Official records of asset units out on loan.',
      searchPlaceholder: 'Borrower name or contact…',
      overdue: 'Overdue',
      empty: 'No borrowings found',
      newTitle: 'New borrowing',
      newDescription: 'Created as a draft. Add the units it covers next, then activate it.',
      section: 'Borrowing',
      discardTitle: 'Discard your changes?',
      discardDescription: 'This borrowing has unsaved changes that will be lost.',
      discard: 'Discard',
      borrower: 'Borrower',
      borrowerContact: 'Borrower contact',
      borrowerContactHint: 'How to reach the borrower while the item is out.',
      borrowDate: 'Borrow date',
      expectedReturn: 'Expected return',
      responsiblePerson: 'Responsible person',
      responsiblePersonHint: 'The staff member accountable for the loan.',
      units: 'Units',
      noUnits: 'No units yet',
      noUnitsDescription: 'A borrowing must cover at least one unit before it can be activated.',
      addUnit: 'Add a unit to this borrowing',
      timeline: 'Timeline',
      timelineDescription:
        'Recorded on the borrowing itself. Completed records keep their original dates.',
      borrowed: 'Borrowed',
      actualReturn: 'Actual return',
      pastDue: 'Past due',
      activateTitle: 'Activate this borrowing?',
      activate: 'Activate',
      cancelTitle: 'Cancel this borrowing?',
      cancelDescription:
        'A cancelled draft cannot be reopened. No unit changes state — a draft never held them.',
      cancelConfirm: 'Cancel borrowing',
      returnTitle: 'Record the return',
      returnDescription: 'Every unit still on loan moves back to in use. This cannot be undone.',
      returnSubmit: 'Record return',
      actualReturnDate: 'Actual return date',
      defaultsToday: 'Defaults to today.',
      note: 'Note',
      extendTitle: 'Extend this borrowing',
      extend: 'Extend',
      newExpectedReturn: 'New expected return',
      newExpectedReturnHint: 'When the continued loan is due back.',
      closingDate: 'Closing date for this record',
    },
    transactions: {
      affectedUnitsDetail:
        'The units this transaction was recorded against. Lifecycle shows their state now, not at the time.',
      title: 'Transactions',
      description: 'Operational events recorded against individual asset units.',
      type: 'Type',
      contract: 'Contract',
      anyStartDate: 'Any start date',
      anyEndDate: 'Any end date',
      empty: 'No transactions found',
      newTitle: 'New transaction',
      newDescription: 'A historical record. Once created it cannot be edited or deleted.',
      section: 'Transaction',
      transactionDate: 'Transaction date',
      supplier: 'Supplier',
      procurementOnlyHint: 'Only for procurement-originated transactions.',
      institutionHint: 'Defaults to your own.',
      affectedUnits: 'Affected units',
      affectedUnitsDescription: 'Which physical units this transaction happened to.',
      notePlaceholder: 'Note (optional)',
      addUnits: 'Add units to this transaction',
      discardTitle: 'Discard this transaction?',
      discardDescription: 'Nothing has been recorded yet, and these details will be lost.',
      discard: 'Discard',
      noUnits: 'No units',
    },
    vendors: {
      deactivateActive: 'Existing assets keep referencing it; only new ones lose it as a choice.',
      deactivateInactive: 'It becomes selectable again on new assets.',
      title: 'Vendors',
      description: 'Manufacturers and brands that assets are attributed to.',
      searchPlaceholder: 'Name…',
      empty: 'No vendors found',
      newTitle: 'New vendor',
      contactInformation: 'Contact information',
      address: 'Address',
      details: 'Details',
      assets: 'Assets',
      assetsDescription: 'Assets attributed to this vendor, within your organization scope.',
      noAssets: 'No assets',
      noAssetsDescription: 'Nothing has been attributed to this vendor yet.',
    },
  },

  resources: {
    asset: 'Asset',
    location: 'Location',
    borrowing: 'Borrowing',
    transaction: 'Transaction',
    institution: 'Institution',
    department: 'Department',
    user: 'User',
    role: 'Role',
    attributeDefinition: 'Attribute definition',
    category: 'Category',
    measurementUnit: 'Measurement unit',
    contractType: 'Contract type',
    fundingSource: 'Funding source',
    transactionType: 'Transaction type',
    accountCode: 'Account code',
    supplier: 'Supplier',
    contract: 'Contract',
    vendor: 'Vendor',
  },

  /**
   * Copy belonging to the reusable interaction patterns, not to any one screen.
   *
   * A module passes its own words where it has better ones — "Here only" reads
   * better than "Direct only" on a location page — and falls back to these
   * otherwise, so a new screen is never unlabelled.
   */
  patterns: {
    derived: {
      pending: 'Not determined yet',
    },
    createRelated: {
      action: 'Create new',
    },
    dependent: {
      placeholder: 'Select the field above first',
      unavailable: 'Choose the field above to see the options available here.',
      empty: 'No options are available for that selection.',
    },
    scope: {
      label: 'Scope',
      all: 'Everything inside',
      direct: 'Here only',
    },
    timeline: {
      empty: 'Nothing recorded yet',
    },
    locationSelector: {
      title: 'Select a location',
      description:
        'Search by name, or open a location to see what is inside it. Any location can be selected.',
      placeholder: 'Select a location…',
      searchLabel: 'Search locations',
      searchPlaceholder: 'Search locations…',
      clearSearch: 'Clear search',
      clear: 'Clear location',
      trail: 'Location trail',
      top: 'All locations',
      loading: 'Loading locations…',
      noMatches: 'No matching locations',
      noMatchesHint: 'Try a different name, or browse by opening a location instead.',
      nothingHere: 'Nothing inside this location',
      openInside: 'Open {{name}}',
    },
  },

  states: {
    error: {
      forbidden: 'You do not have access to this',
      notFound: 'Not found',
      conflict: 'That conflicts with the current state',
      unauthorized: 'Your session has ended',
      network: 'Cannot reach the server',
      default: 'Something went wrong',
    },
  },

  nav: {
    groups: {
      dashboard: 'Dashboard',
      assets: 'Assets',
      procurement: 'Procurement',
      operations: 'Operations',
      organization: 'Organization',
      reportsAudit: 'Reports & Audit',
    },
    items: {
      dashboard: 'Dashboard',
      assets: 'Assets',
      assetUnits: 'Asset units',
      locations: 'Locations',
      classifications: 'Classifications',
      suppliers: 'Suppliers',
      contracts: 'Contracts',
      vendors: 'Vendors',
      borrowings: 'Borrowings',
      transactions: 'Transactions',
      institutions: 'Institutions',
      inventoryCodeFormat: 'Inventory code format',
      departments: 'Departments',
      users: 'Users',
      roles: 'Roles',
      attributeDefinitions: 'Attribute definitions',
      lookups: 'Lookups',
      reports: 'Reports',
      auditLog: 'Audit log',
    },
    mainNavigation: 'Main navigation',
    toggle: 'Toggle navigation',
    closeMenu: 'Close menu',
    breadcrumb: 'Breadcrumb',
    noModules: 'No modules are available to your account.',
  },

  crumbs: {
    home: 'Home',
    assets: 'Assets',
    assetUnits: 'Asset units',
    labels: 'Labels',
    scan: 'Scan',
    locations: 'Locations',
    classifications: 'Classifications',
    reference: 'Reference',
    attributeDefinitions: 'Attribute definitions',
    lookups: 'Lookups',
    procurement: 'Procurement',
    suppliers: 'Suppliers',
    contracts: 'Contracts',
    operations: 'Operations',
    vendors: 'Vendors',
    borrowings: 'Borrowings',
    transactions: 'Transactions',
    organization: 'Organization',
    institutions: 'Institutions',
    inventoryCodeFormat: 'Inventory code format',
    departments: 'Departments',
    users: 'Users',
    roles: 'Roles',
    reports: 'Reports',
    audit: 'Audit log',
    new: 'New',
    edit: 'Edit',
    floorPlan: 'Floor plan',
  },

  /**
   * Sign-in screen.
   *
   * There is deliberately no copy here for sign-up, "remember me" or password
   * reset: `06-api.md` §2 exposes no such capability, and a label without an
   * endpoint behind it is a promise the application cannot keep.
   */
  auth: {
    title: 'Sign in',
    subtitle: 'Use your institution account to continue.',
    username: 'Username',
    password: 'Password',
    submit: 'Sign in',
    help: 'Having trouble signing in? Contact your asset administrator.',
    session: {
      restoring: 'Restoring your session…',
      unavailableTitle: 'Could not reach the server',
      unavailableDescription:
        'Your session has not been signed out — we simply could not confirm it. Check your connection and try again.',
    },
    errors: {
      usernameRequired: 'Enter your username.',
      usernameTooLong: 'A username is at most 25 characters.',
      passwordRequired: 'Enter your password.',
    },
  },

  shell: {
    /* Sits under the AL-MUFTI lockup in the sidebar: the logo says which
       institution, this says which of its systems. */
    appName: 'Asset Management',
    searchAssets: 'Search assets',
    searchAssetsPlaceholder: 'Search assets…',
    signOut: 'Sign out',
    signOutTitle: 'Sign out?',
    signOutDescription: 'You will need to sign in again to continue.',
    noRoles: 'No roles',
  },

  /**
   * Database enums, rendered for people — `04-data-model.md` §4.
   *
   * The stored value never changes; only its presentation does. A screen that
   * printed `UNDER_MAINTENANCE` was showing a column value, not a label.
   */
  enums: {
    active: 'Active',
    inactive: 'Inactive',
    lifecycle: {
      REGISTERED: 'Registered',
      ACTIVE: 'In use',
      IN_STORAGE: 'In storage',
      BORROWED: 'On loan',
      UNDER_MAINTENANCE: 'Under maintenance',
      DISPOSED: 'Disposed',
      DEACTIVATED: 'Deactivated',
    },
    condition: {
      GOOD: 'Good',
      FAIR: 'Fair',
      POOR: 'Poor',
      DAMAGED: 'Damaged',
      UNSERVICEABLE: 'Unserviceable',
    },
    borrowing: {
      DRAFT: 'Draft',
      ACTIVE: 'Active',
      RETURNED: 'Returned',
      OVERDUE: 'Overdue',
      CANCELLED: 'Cancelled',
    },
    /* What an attribute definition accepts, and what it is attached to. Stored
       as `TEXT` / `ASSET_UNIT`; a screen that printed those was showing a column
       value, exactly as one printing `UNDER_MAINTENANCE` was. */
    attributeType: {
      TEXT: 'Text',
      NUMBER: 'Number',
      BOOLEAN: 'Yes or no',
      DATE: 'Date',
      SELECTION: 'Selection',
      REFERENCE: 'Reference',
    },
    attributeScope: {
      ASSET: 'Asset',
      ASSET_UNIT: 'Asset unit',
    },
    /* What an audit entry records. Stored as `STATUS_CHANGE`; a reader is shown
       what happened, not the column value. */
    auditAction: {
      CREATE: 'Created',
      UPDATE: 'Updated',
      DELETE: 'Deleted',
      STATUS_CHANGE: 'Status changed',
    },
  },

  /**
   * Audit log — `07-ui.md` §5.8.
   *
   * `entityType` values (`Asset`, `Borrowing`) are NOT translated: they are the
   * server's own record names, they are what the free-text filter matches on,
   * and translating them would make the filter unusable.
   */
  audit: {
    title: 'Audit log',
    description:
      'Read-only record of changes to critical business records. It covers every institution.',
    empty: 'No audit entries',
    when: 'When',
    actor: 'Actor',
    action: 'Action',
    entity: 'Entity',
    entityId: 'Entity ID',
    entityType: 'Entity type',
    entityTypePlaceholder: 'Asset, Borrowing…',
    entityIdPlaceholder: 'Exact id',
    anyStartDate: 'Any start date',
    anyEndDate: 'Any end date',
    clearStartDate: 'Clear start date',
    clearEndDate: 'Clear end date',
    /* A `NULL` actor is the system itself, which is what the data model defines
       it to mean — not a missing value. */
    system: 'System',
    entryTitle: 'Audit entry',
    entryDescription: 'A recorded change. Audit entries can never be edited or deleted.',
    ipAddress: 'IP address',
    request: 'Request',
    field: 'Field',
    before: 'Before',
    after: 'After',
    changed: 'changed',
    emptyValue: '(empty)',
    noValues: 'No field values were recorded.',
  },

  locations: {
    title: 'Locations',
    description: 'Where units physically are. Locations nest to represent containment.',
    new: 'New location',
    namePlaceholder: 'Location name…',
    emptyList: 'No locations found',
    emptyRoots: 'No top-level locations',
    treeView: 'Switch to tree view',
    listView: 'Switch to list view',
    expand: 'Expand {{name}}',
    collapse: 'Collapse {{name}}',
    nothingInside: 'Nothing inside this location.',
    columns: {
      inside: 'Inside',
    },
    topLevel: 'Top level',
    parentUnavailable: 'A location you cannot access',
    formDescription: 'A building, floor or room that units can be placed in.',
    create: 'Create location',
    parentHint: 'Leave empty for a top-level location such as a site or building.',
    institutionDefault: 'Default to my institution',
    insideAnother: 'Inside another location',
    details: 'Location details',
    classificationHint: 'Set when the location was created.',
    children: {
      title: 'Inside this location',
      empty: 'Nothing is recorded inside this location yet.',
    },
    units: {
      title: 'Asset units',
      descriptionAll:
        'Everything here and in every location inside this one. The Location column says where each unit actually is.',
      descriptionDirect: 'Only units recorded at {{name}} itself.',
      scopeLabel: 'Which units to show',
      scopeAll: 'Including inside',
      scopeDirect: 'Here only',
      here: 'Here',
      inside: 'Inside',
      emptyTitle: 'Nothing here',
      emptyAll: 'No units are recorded at this location or anything inside it.',
      emptyDirect: 'No units are recorded at this location itself. Try “Including inside”.',
    },
    deactivate: {
      title: 'Deactivate this location?',
      description:
        'Units recorded here keep their location history; it stops being offered for new placements.',
      reactivateTitle: 'Reactivate this location?',
      reactivateDescription: 'It becomes selectable again for placements.',
    },
    tabs: {
      info: 'Info',
      units: 'Units',
      floorPlan: 'Floor plan',
    },
  },

  floorPlan: {
    title: 'Floor plan',
    pageTitle: 'Floor plan — {{name}}',
    editDescription: 'Draw the rooms inside this location onto its plan.',
    belongsTo: 'This plan belongs to {{name}}.',
    backToLocation: 'Back to location',
    goToLocation: 'Go to that location',
    whereUnitIs: 'Where the unit is',
    unitLocation: 'Unit location',
    planBelongsTo: 'Floor plan belongs to',
    highlighted: '{{name}} is highlighted on this plan.',
    notMapped:
      'This plan does not mark out the exact location — no area has been drawn for it. It is somewhere inside the location this plan depicts.',
    highlightedTag: '— highlighted',
    none: 'No floor plan yet',
    noneDescription: 'Upload a plan image to start marking out the rooms it contains.',
    upload: 'Upload floor plan',
    replace: 'Replace floor plan',
    chooseImage: 'Choose a floor plan image',
    uploaded: 'Floor plan uploaded',
    replaced: 'Floor plan replaced',
    removed: 'Floor plan removed',
    remove: 'Remove floor plan',
    draw: 'Draw an area',
    saveArea: 'Save area',
    areaAdded: 'Area added',
    areaRemoved: 'Area removed',
    drawHint: 'Click the plan to place corners. {{count}} placed — at least {{min}} are needed.',
    areaLocation: 'Room this area represents',
    selectLocation: 'Select a location…',
    addByCoordinate: 'Add a point by coordinate (0–1)',
    pointX: 'Point X',
    pointY: 'Point Y',
    addPoint: 'Add point',
    undoPoint: 'Undo point',
    areasHere: 'Areas on this plan',
    noAreas: 'No areas defined yet. The rooms inside this location can be drawn onto the plan.',
    points: '{{count}} points',
    imageAlt: 'Floor plan of this location: {{fileName}}',
    loadingImage: 'Loading floor plan…',
    deleteArea: 'Delete area for {{name}}',
    confirmRemovePlan: 'Remove this floor plan?',
    confirmRemovePlanDescription:
      'The plan and every area drawn on it are deleted. The locations they represent are unaffected.',
    confirmRemoveArea: 'Remove this area?',
    confirmRemoveAreaDescription: 'The location this area represents is unaffected.',
  },

  /** Person in charge — Phase 21 (`CR-003`). Shared by departments and locations. */
  pic: {
    title: 'Person in charge',
    description: 'Who is responsible, and who was responsible before.',
    current: 'Currently',
    none: 'Nobody assigned',
    now: 'now',
    assign: 'Assign',
    assignTitle: 'Assign a person in charge',
    assignDescription: 'They become responsible from today. The change is recorded.',
    handOver: 'Hand over',
    handOverTitle: 'Hand over to someone else',
    handOverDescription:
      'The current holder’s period is closed today and a new one begins. Neither record is overwritten.',
    clear: 'Remove',
    clearTitle: 'Remove the person in charge?',
    clearDescription:
      'The post is left vacant. The record of who held it, and until when, is kept.',
    person: 'Person',
    personHint: 'Active users of this institution only.',
    assigned: 'Person in charge updated',
    cleared: 'Person in charge removed',
    assignedBy: 'Assigned by {{name}}',
    empty: 'No one has been assigned yet',
    emptyDescription: 'Assign someone to start the responsibility record.',
    noInstitution:
      'This record belongs to no institution, so there is no one who could be put in charge of it.',
  },

  units: {
    title: 'Asset unit',
    heading: 'Unit {{id}}',
    noDescription: 'No description',
    backToAsset: 'Back to asset',
    information: 'Unit information',
    tabs: {
      overview: 'Overview',
      attributes: 'Attribute values',
      history: 'History',
      borrowings: 'Borrowings',
      transactions: 'Transactions',
    },
    fields: {
      lifecycleState: 'Lifecycle state',
      currentCondition: 'Current condition',
      currentLocation: 'Current location',
      procurementItem: 'Procurement item',
      noProcurementItem: 'Not traced to a line item',
      departmentHint: "Only departments of this asset's institution can be assigned.",
      noDepartment: 'Not assigned',
      numberComposition: 'Number composition',
      numberCompositionHint:
        'Becomes part of this unit\'s permanent inventory code, exactly as you type it — it is never adjusted for you. Letters, digits, hyphen, underscore and dot only, up to {{max}} characters under this institution\'s format.',
      numberCompositions: 'Number compositions',
      // `total` rather than `count`: i18next reserves `count` for plural
      // resolution and would look for a `_one`/`_other` key that does not exist.
      numberCompositionsHint:
        'One per line, {{total}} in total — this institution\'s format allocates no sequence, so each unit needs its own. Up to {{max}} characters each, and no two the same.',
      numberCompositionsCount: '{{entered}} of {{expected}} entered',
    },
    location: {
      unrecorded: 'Not recorded — a location is set by recording a state change.',
      /* The plans that place this unit, outside-in. `viewOnPlan` used to label
         one button here; there is a trail of them now, each naming its own
         level, so the generic label had nothing left to say. */
      planTrail: 'Floor plans showing this unit',
      planTrailHint: 'Each plan marks out the next step in.',
      viewPlanOf: 'View the floor plan of {{name}}',
      planHere: 'This location has its own plan.',
      planAbove: 'Shown on the plan for {{name}}',
      planAboveMapped: ', where it is marked out.',
      planAboveUnmapped: ', which does not mark it out.',
      planUnknownOwner: 'a location above this one',
      noPlan: 'No floor plan available for this location or anything above it.',
    },
    history: {
      title: 'History',
      description: 'Condition, location and lifecycle state over time, newest first.',
      record: 'Record a change',
      recordTitle: 'Record a state change',
      recordDescription: 'Anything left blank carries forward from the current state.',
      recorded: 'History recorded',
      submit: 'Record',
      empty: 'No history recorded',
      emptyDescription: 'Recording a condition and location is what brings a unit into service.',
      unchanged: 'Unchanged',
      locationHint: 'Leave empty to keep the unit where it is.',
      lifecycleHint: 'Only transitions the state machine allows are accepted.',
      now: 'now',
    },
    edit: {
      title: 'Edit unit',
      description:
        'Condition, location and lifecycle state are historical facts and change only through the History tab.',
      updated: 'Unit updated',
      itemHint: "Only line items of the asset's own contract can be chosen.",
      noItem: 'Not traced to a line item',
    },
    columns: {
      unit: 'Asset unit',
      asset: 'Asset',
      department: 'Department',
      location: 'Location',
      lifecycle: 'Lifecycle',
      condition: 'Condition',
      borrower: 'Borrower',
      dates: 'Dates',
      type: 'Type',
    },
    unassignedDepartment: 'Not assigned',
    noLocation: 'No location recorded',
    list: {
      title: 'Asset units',
      description: 'The individually tracked physical items behind every asset.',
      descriptionPic: 'The units in the departments you are currently in charge of.',
      searchPlaceholder: 'Inventory code or description…',
      empty: 'No asset units found',
      emptyDescription: 'Nothing matches these filters.',
      emptyDescriptionPic:
        'Nothing matches these filters. You see only units in departments you are currently in charge of.',
    },
    emptyBorrowings: 'Never borrowed',
    emptyTransactions: 'No transactions',
  },

  assets: {
    list: {
      title: 'Assets',
      searchPlaceholder: 'Name or description…',
      location: 'Location',
      vendor: 'Vendor',
      contract: 'Contract',
      condition: 'Condition',
      empty: 'No assets found',
      emptyDescription: 'Nothing matches these filters.',
      filterByClassification: 'Filter by classification',
    },
    detail: {
      information: 'Asset information',
      vendor: 'Vendor',
      procurement: 'Procurement',
      attributes: 'Attribute values',
      attributesDescription: 'Extra fields configured for this classification.',
      attachments: 'Attachments',
    },
    form: {
      newTitle: 'New asset',
      editTitle: 'Edit asset',
      newDescription: 'Physical units are added once the asset exists.',
      editDescription: 'Changing the classification also changes which attributes apply.',
      create: 'Create asset',
      section: 'Asset details',
      classificationHint: 'Only the most specific level can be chosen.',
      institutionDefault: 'Default to my institution',
      vendor: 'Vendor',
      vendorHint: 'The manufacturer or brand behind this asset.',
      noVendor: 'No vendor',
      contract: 'Contract',
      contractHint:
        'The procurement contract this asset was bought under. Leave empty for a donated, self-built or migrated asset.',
      noContract: 'No procurement record',
      discardTitle: 'Discard your changes?',
      discardDescription: 'This asset has unsaved changes that will be lost.',
      discard: 'Discard',
    },
    attributes: {
      yes: 'Yes',
      none: 'No attributes are configured for this classification.',
      selectionHint: 'Allowed values are not configurable yet; this is stored as free text.',
      selectionNote:
        'One or more attributes here are a selection type. There is no storage for their allowed values yet, so they accept free text for now.',
    },
    label: {
      title: 'Unit labels',
      descriptionOne: 'A printable label for this unit. Stick it on the item itself.',
      descriptionMany: 'Printable labels for every unit of this asset, laid out for cutting.',
      print: 'Print',
      labelFor: 'Label for {{code}}',
      emptyTitle: 'Nothing to print',
      emptyDescription:
        'None of these units has an inventory code yet. A code is built from the owning institution, so set one on the asset first.',
      printLabel: 'Print label',
      printAllLabels: 'Print all labels',
      inventoryCode: 'Inventory code',
      noCode: 'Not assigned',
      noCodeHint: 'An inventory code is built from the owning institution. This asset has none.',
    },
    scan: {
      title: 'Scanned label',
      description: 'Looking up {{code}}…',
      resolving: 'Looking up the scanned code…',
      notFoundTitle: 'No unit for this code',
      notFoundDescription:
        'Nothing in your institution matches {{code}}. Check the code against the label, or the label may belong to another institution.',
      browseAssets: 'Browse assets',
      browseUnits: 'Browse asset units',
    },
    units: {
      title: 'Units',
      description: 'The individually tracked physical items belonging to this asset.',
      add: 'Add unit',
      addTitle: 'Add a unit',
      addDescription: 'A new unit starts as REGISTERED with no condition or location recorded.',
      created: 'Unit created',
      empty: 'No units yet',
      emptyDescription: 'An asset with no units is a record of something not yet received.',
      notRecordedCondition: 'Not recorded',
      itemHint: 'Which line of the contract this particular unit arrived on.',
      noItem: 'Not traced to a line item',
    },
  },

  procurement: {
    list: {
      title: 'Contracts',
      description: 'Procurement records assets are traced back to.',
      searchPlaceholder: 'Contract number…',
      supplier: 'Supplier',
      type: 'Type',
      empty: 'No contracts found',
    },
    detail: {
      information: 'Contract information',
      contractNumber: 'Contract number',
      supplier: 'Supplier',
      contractType: 'Contract type',
      contractDate: 'Contract date',
      contractValue: 'Contract value',
      fundingSource: 'Funding source',
      accountCode: 'Account code',
      receivingDocument: 'Receiving document',
      receivingDate: 'Receiving date',
      assets: 'Assets',
    },
    form: {
      newTitle: 'New contract',
      editTitle: 'Edit contract',
      newDescription: 'Line items are added once the contract exists.',
      editDescription: 'Line items and the assets traced to them are unaffected by these changes.',
      create: 'Create contract',
      section: 'Contract',
      valueHint: 'Numeric, two decimal places.',
      institutionHint: 'The receiving institution. Defaults to your own.',
      noSupplier: 'No supplier',
      noType: 'No type',
      noFundingSource: 'No funding source',
      noAccountCode: 'No account code',
      institutionDefault: 'Default to my institution',
      notReceived: 'Not received yet',
      createSupplier: 'Create supplier',
      createSupplierDescription:
        'Only a name is required; the rest can be filled in later on the supplier’s own page.',
      createContractType: 'Create contract type',
      createFundingSource: 'Create funding source',
      discardTitle: 'Discard your changes?',
      discardDescription: 'This contract has unsaved changes that will be lost.',
      discard: 'Discard',
    },
    suppliers: {
      title: 'Suppliers',
      description: 'The parties procurement contracts are executed with.',
      searchPlaceholder: 'Name…',
      empty: 'No suppliers found',
      newTitle: 'New supplier',
      contactInformation: 'Contact information',
      address: 'Address',
      details: 'Details',
      contracts: 'Contracts',
      contractsDescription: 'Procurement contracts executed with this supplier.',
      noContracts: 'No contracts',
      noContractsDescription: 'Nothing has been procured from this supplier yet.',
    },
    lineItems: {
      title: 'Line items',
      description:
        'What was purchased under this contract. Each line can be registered as an asset.',
      empty: 'No line items',
      emptyDescription: 'Add what was purchased, then register each line as an asset.',
      deleteTitle: 'Delete this line item?',
    },
    items: {
      quantity: 'Quantity',
      quantityHint: 'How many were ordered.',
      quantityOrdered: 'Quantity ordered',
      unitOfMeasure: 'Unit of measure',
      unitOfMeasureHint: 'What the quantity counts.',
      unitOfMeasurePlaceholder: 'piece, box, set…',
      unitPrice: 'Unit price',
      total: 'Total',
      item: 'Item',
      itemName: 'Item name',
      specification: 'Specification',
      addLineItem: 'Add line item',
      editLineItem: 'Edit line item',
      lineItemDescription: 'One purchased line of this contract.',
      addItem: 'Add item',
      assetUnits: 'Asset units',
      assetUnitsDescription:
        'The individually tracked physical items registered against this line item. Each is a separate record from the quantity ordered above.',
      nothingRegistered: 'Nothing registered yet',
      nothingRegisteredDescription: 'Use “Add asset” on this line to put it on the registry.',
    },
    addAsset: {
      title: 'Add asset',
      submit: 'Create asset',
      classificationHint:
        'The contract item carries none, so it is chosen here. Most specific level only.',
      vendor: 'Vendor',
      unitCount: 'Asset units to register',
      unitCountHintOrdered:
        '{{quantity}} ordered. Each unit registered is tracked individually. Registering fewer is normal — partial receiving is expected.',
      unitCountHint: 'How many individually tracked physical items arrived.',
    },
  },

  /**
   * Organization — `07-ui.md` §5.1.
   *
   * Institutions, departments, users and roles. The permission CODES themselves
   * are never translated: they are identifiers the API defines and an
   * administrator matches against the documentation, so translating them would
   * make them unsearchable.
   */
  organization: {
    institutions: {
      title: 'Institutions',
      description: 'Organizational units that own assets, contracts and users.',
      new: 'New institution',
      searchPlaceholder: 'Name or code…',
      empty: 'No institutions found',
      code: 'Code',
      codeHint: 'A short unique identifier, used across reports.',
      codeLabel: 'Code: {{code}}',
      address: 'Address',
      details: 'Details',
      deactivateTitle: 'Deactivate this institution?',
      deactivateDescription:
        'Its assets, contracts and users are preserved and keep referencing it.',
      reactivateTitle: 'Reactivate this institution?',
      reactivateDescription: 'It becomes selectable again for new records.',
    },
    /** Phase 25 (`CR-006`), REQ-ORG-007. */
    inventoryCodeFormat: {
      tab: 'Inventory code',
      title: 'Inventory code format',
      description:
        'How inventory codes are built for units registered in this institution from now on.',
      pageDescription: "The format used for your institution's asset unit inventory codes.",
      formatLabel: 'Format',
      addToken: 'Add a value',
      addSeparator: 'Add a separator',
      choose: 'Choose a value…',
      moveLeft: 'Move earlier',
      moveRight: 'Move later',
      remove: 'Remove',
      previewLabel: 'Preview',
      previewNote: 'Example only. No code is generated until a unit is registered. Limit: {{max}}.',
      // Every consequence is stated at the control, not in a help page.
      requiresValue:
        'Because the format uses {{tokens}}, every unit registered from now on must have it — a registration without one is refused rather than given an incomplete code.',
      unresolved:
        'There is no value available to preview {{tokens}}. The format can still be saved, but check it against a real registration before printing labels.',
      cannotRemoveLast:
        '{{token}} is the only thing separating one unit from another. Add a sequence or a number composition first — a format with neither would give every unit registered the same code.',
      compositionPerUnit:
        'This format allocates no sequence, so the number composition is the only thing that separates one unit from another. A value must be typed for every unit registered, including every unit of a procurement batch, and no two units may share one.',
      sharedNumbering:
        'This format does not include the institution code, so its numbering is shared with any other institution using the same shape. Codes stay unique; the sequence is no longer per-institution.',
      futureOnly:
        'Changing the format affects only units registered afterwards. Codes already issued, and the labels carrying them, never change.',
      reset: 'Use the default',
      saved: 'Inventory code format saved',
      noInstitutionTitle: 'No institution to configure',
      noInstitutionDescription:
        'Your account is not attached to one institution. Open the institution you want from Institutions and use its Inventory code tab.',
    },
    departments: {
      title: 'Departments',
      description: 'Departments belong to an institution. Two institutions may use the same code.',
      new: 'New department',
      empty: 'No departments found',
      code: 'Code',
      codeHint: 'Up to 8 characters. Unique within the institution.',
      codeLabel: 'Code: {{code}}',
      institutionReadOnlyHint:
        'Set when the department is created and never changed: moving it would clear the department of every unit assigned to it.',
      noInstitution: 'Not assigned to an institution',
      details: 'Details',
      deactivateTitle: 'Deactivate this department?',
      deactivateDescription: 'Asset units already assigned to it keep their assignment.',
      reactivateTitle: 'Reactivate this department?',
      reactivateDescription: 'It becomes selectable again for new assignments.',
    },
    users: {
      title: 'Users',
      description: 'Accounts that can sign in, and the roles that decide what they may do.',
      new: 'New user',
      newDescription: 'Roles can be assigned once the account exists.',
      searchPlaceholder: 'Username or name…',
      empty: 'No users found',
      username: 'Username',
      usernameHint: 'Permanent. It identifies this account in the audit trail.',
      password: 'Password',
      passwordHint: 'At least 12 characters.',
      firstName: 'First name',
      lastName: 'Last name',
      contactInfo: 'Contact information',
      institutionHint: 'Bounds what this user can see, unless one of their roles is system-wide.',
      noInstitution: 'No institution',
      profile: 'Profile',
      roles: 'Roles',
      rolesDescription:
        'Roles carry the permissions this account holds. Removing all of them leaves the user able to sign in but do nothing.',
      noRoles: 'No roles assigned',
      noRolesDescription: 'This account has no permissions.',
      removeRole: 'Remove {{name}}',
      selectRole: 'Select a role…',
      noFurtherRoles: 'No further roles available',
      assignRole: 'Assign role',
      roleAssigned: 'Role assigned',
      roleRemoved: 'Role removed',
      deactivateTitle: 'Deactivate this user?',
      deactivateDescription:
        'They are signed out immediately and cannot sign in again until reactivated.',
      reactivateTitle: 'Reactivate this user?',
      reactivateDescription: 'They will be able to sign in again with their existing password.',
    },
    roles: {
      title: 'Roles',
      description:
        'Each role is a named set of permissions. Users hold roles, not permissions directly.',
      new: 'New role',
      newDescription: 'Permissions are assigned after the role exists.',
      empty: 'No roles found',
      scope: 'Scope',
      systemWide: 'System-wide',
      institutionScoped: 'Institution-scoped',
      permissions: 'Permissions',
      details: 'Details',
      /* What system-wide DOES, in the words of the thing it affects. The rule
         reference that used to sit in this sentence was an engineering
         identifier, and an administrator has no way to look it up. */
      systemWideHint:
        'Lifts the institution scope on this role’s permissions. Required for managing institutions, roles and permissions. It grants nothing on its own.',
      systemWideEditHint:
        'Lifts the institution scope on this role’s permissions. Turning it off is refused while any institution, role or permission code is granted.',
      institutionAssignable: 'Assignable by institutions',
      institutionAssignableHint:
        'Lets institution administrators give this role to users in their own institution.',
      institutionAssignableBlocked:
        'Unavailable while this role is system-wide. A system-wide role escapes institution scope, so it can never be handed to an institution administrator.',
      institutionAssignableWarning:
        'This grants the role’s permissions to every institution administrator. Whoever creates a user account also sets its password and can sign in as it — so any role they can assign, they can take for themselves. Only turn this on if you would grant these permissions to every institution administrator directly.',
      /** The third scope tier — Phase 22 (`CR-003`), REQ-ROLE-011. */
      picScoped: 'Limited to their own departments',
      picScopedHint:
        'Holders reach only the asset units of departments they are currently the person in charge of.',
      picScopedBlocked:
        'A system-wide role already reaches every institution, which is the opposite of reaching only the departments you are responsible for.',
      picScopedWarning:
        'This narrows access rather than granting it, and only while every one of a user’s roles carries it — anyone who also holds an ordinary role keeps their full institution access. Units with no department are out of reach entirely, and holders cannot move a unit between departments.',
      permissionsGranted: '{{granted}} of {{total}} permissions granted.',
      savePermissions: 'Save permissions',
      permissionsUpdated: 'Permissions updated',
      delete: 'Delete role',
      deleteTitle: 'Delete this role?',
      deleteDescription: 'This cannot be undone. It is refused if any user still holds the role.',
    },
    permissions: {
      none: 'No permissions available.',
      selectAll: 'Select all',
      selectAllIn: 'Select all {{group}} permissions',
      requiresSystemWide: 'Requires a system-wide role',
      notEffectiveForPic: 'Not effective for a PIC-scoped role',
    },
  },

  /**
   * Reference data — `07-ui.md` §5.2.
   *
   * The classification hierarchy and its picker, the attribute definitions
   * configured against it, and the small editable lookups. `lookups.types.*`
   * carries a plural for a tab heading and a lowercase singular/plural for the
   * sentences that interpolate a resource name, because neither language forms
   * one from the other reliably.
   */
  reference: {
    classifications: {
      title: 'Classifications',
      description:
        'The reference hierarchy every asset and location is classified against. Government entries are fixed; your institution can add its own at the most specific level.',
      browse: 'Browse classifications',
      emptyTitle: 'No classification selected',
      emptyDescription:
        'Browse or search the hierarchy to inspect a classification and the attributes configured for it.',
      code: 'Code',
      parent: 'Parent',
      rootLevel: 'Root level',
      origin: 'Origin',
      category: 'Category',
      originValue: {
        1: 'Government reference data',
        2: 'Inherited from the previous system',
        3: 'Added in this application',
      },
      manage: {
        localBadge: 'Locally added',
        global: 'All institutions',
        ownedByInstitution: 'One institution',
        add: 'Add entry',
        addTitle: 'Add a classification',
        addDescription:
          'The new entry sits under {{parent}} as a most-specific classification. Its code is assigned automatically.',
        addHint:
          'Entries can only be added at the most specific level. Keep narrowing down until the list shows the individual items.',
        renameTitle: 'Rename classification',
        renameDescription:
          'Only the name changes. The code stays the same, so assets and locations already classified here are unaffected.',
        nameLabel: 'Name',
        ownerLabel: 'Available to',
        ownerGlobal: 'All institutions',
        ownerMine: 'My institution only',
        ownerHint:
          'An entry for one institution is invisible to the others. You can share it with everyone later, but that cannot be undone.',
        promote: 'Share with all',
        promoteTitle: 'Share with every institution?',
        promoteDescription:
          '{{name}} becomes available to every institution. This cannot be undone, because other institutions may start using it.',
        deleteTitle: 'Delete this classification?',
        deleteDescription:
          '{{name}} is removed permanently. This is only possible while nothing is classified against it.',
        created: 'Classification added',
        renamed: 'Classification renamed',
        deleted: 'Classification deleted',
        promoted: 'Classification shared with every institution',
      },
      attributes: {
        title: 'Attribute definitions',
        description: 'Extra fields configured for this classification.',
        empty: 'No attributes configured',
        emptyDescription: 'Assets classified here carry no additional attributes.',
        required: 'Required',
      },
    },
    picker: {
      title: 'Select a classification',
      description:
        'Search for a specific classification, or narrow down one level at a time. Only the most specific level can be selected.',
      placeholder: 'Select a classification…',
      searchLabel: 'Search classifications',
      searchPlaceholder: 'Search classifications…',
      clearSearch: 'Clear search',
      trail: 'Classification path',
      top: 'All',
      select: 'Select',
      loading: 'Loading classifications…',
      noMatches: 'No matching classifications',
      noMatchesHint: 'Try a different term, or browse by narrowing down instead.',
      nothingHere: 'Nothing at this level',
      useThis: 'Open "{{name}}"',
      local: 'Local',
    },
    attributeDefinitions: {
      title: 'Attribute definitions',
      description:
        'Extra fields configured per classification, for assets or for individual units.',
      new: 'New definition',
      empty: 'No attribute definitions',
      emptyDescription: 'Assets take only their built-in fields until a definition is configured.',
      yes: 'Yes',
      no: 'No',
      filters: {
        classification: 'Classification',
        anyClassification: 'Any classification',
        clearClassification: 'Clear classification filter',
        scope: 'Scope',
      },
      columns: {
        classification: 'Classification',
        editTitle: 'Edit attribute definition',
        editDescription:
          'The classification and the scope are fixed. Everything else can be changed.',
        fixedHint: 'Fixed when the definition was created.',
        type: 'Type',
        scope: 'Scope',
        required: 'Required',
      },
      form: {
        title: 'New attribute definition',
        description:
          'The classification and scope are permanent once values have been recorded against this definition.',
        type: 'Type',
        scope: 'Scope',
        required: 'Required',
        selectionNote:
          'Allowed values cannot be configured yet. There is nowhere to store a list of them, so values entered against this attribute are checked as free text for now.',
        usesUnit: 'Carries a measurement unit',
        measurementUnit: 'Measurement unit',
        noUnit: 'No unit',
        createUnit: 'Create measurement unit',
        createUnitDescription:
          'Only a name is required. It becomes available to every attribute that measures something.',
      },
      deactivate: {
        title: 'Deactivate this definition?',
        description:
          'Values already recorded against it are preserved; it stops being offered on new records.',
        reactivateTitle: 'Reactivate this definition?',
        reactivateDescription: 'It becomes available again on the forms for its classification.',
      },
    },
    lookups: {
      title: 'Reference lookups',
      description: 'Small configurable lists used across contracts, transactions and attributes.',
      id: 'ID',
      code: 'Code',
      codeHint: 'Up to 12 characters. Permanent once created.',
      // The funding source code is a business abbreviation, not a shortening of
      // the name — the form has to say so, because the server will not derive it.
      businessCodeHint:
        'The abbreviation your institution actually uses — "Dana Bos" is called BOS. It is not derived from the name. Up to 8 characters, and it may become part of an inventory code, so use letters, digits, hyphen, underscore or dot.',
      codeMissing: 'No code yet',
      new: 'New {{name}}',
      edit: 'Edit {{name}}',
      empty: 'No {{name}} yet',
      emptyDescription: 'Nothing has been added to this list.',
      deleteTitle: 'Delete this {{name}}?',
      deleteDescription: 'This cannot be undone. It is refused if any record still references it.',
      categories: {
        tab: 'Categories',
        note: 'Categories are reference data maintained outside this application and cannot be edited here.',
        empty: 'No categories',
      },
      types: {
        'measurement-units': {
          tab: 'Measurement units',
          singular: 'measurement unit',
          plural: 'measurement units',
        },
        'contract-types': {
          tab: 'Contract types',
          singular: 'contract type',
          plural: 'contract types',
        },
        'funding-sources': {
          tab: 'Funding sources',
          singular: 'funding source',
          plural: 'funding sources',
        },
        'transaction-types': {
          tab: 'Transaction types',
          singular: 'transaction type',
          plural: 'transaction types',
        },
        'account-codes': {
          tab: 'Account codes',
          singular: 'account code',
          plural: 'account codes',
        },
      },
    },
  },

  /**
   * Dashboard and reports — `07-ui.md` §5.7.
   *
   * `reports.items.*` is one entry per registry declaration. The registry itself
   * holds KEYS rather than words: it is a module-scope constant evaluated before
   * a language is chosen, so a string captured there would never change again.
   */
  dashboard: {
    title: 'Dashboard',
    description: 'A summary of the registry, within your organization scope.',
    assets: 'Assets',
    activeCount: '{{n}} active',
    assetUnits: 'Asset units',
    loansOut: 'Loans out',
    pastDue: 'Past due',
    pastDueHint: 'Still holding units past the expected return',
    byLifecycle: 'Units by lifecycle state',
    byCondition: 'Units by condition',
    byClassification: 'Assets by classification',
    byClassificationHint: 'The {{n}} classifications with the most assets. The full report lists them all.',
    fullReport: 'Full report',

    // `CR-012`. A PIC-scoped caller sees a different set of cards, so the page
    // description says which registry they are looking at rather than implying
    // they are seeing the whole institution.
    descriptionScoped: 'A summary of the departments you are responsible for.',
    noCards: 'There is nothing here for your permissions.',

    assessment: {
      month: 'Month',
      coverageTitle: 'Monthly assessment coverage',
      coverageHint:
        'Asset units with at least one assessment recorded by the department this month.',
      coverage: 'Coverage',
      responsible: 'Person in charge',
      unassessed: 'Not assessed',
      lastActivity: 'Last activity',
      unassignedPic: 'Nobody assigned',
      // Not "0%": the department has not failed to assess its units, it has
      // nobody to ask.
      noResponsibleUser: 'No person in charge',
      noUnits: 'No units',
      noDepartments: 'No departments to report on.',
      byOthersHint:
        '{{n}} further unit(s) were assessed by someone other than the department’s person in charge, so they do not count towards coverage.',

      activityTitle: 'Assessment activity',
      activityHint: '{{n}} unit(s) covered this month. Entries and units are different counts.',
      entries: 'Entries',
      uniqueUnits: 'Units',
      notDepartmentPic: 'not the department’s PIC',
      noActivity: 'No assessments recorded this month.',

      unassignedTitle: 'Units with no department',
      unassignedHint:
        'Nobody is responsible for these, so no assessment can be expected. Assign them to a department.',
      unassignedLooked: '{{n}} of them have been assessed by someone.',
      assignDepartment: 'Review units',
    },

    locationCondition: {
      title: 'Units by location and condition',
      hint: 'Where the units are, and what state they are in.',
      scopeLabel: 'Show',
      scopeDirect: 'At each location',
      scopeAll: 'Including everything inside',
      totals: '{{units}} unit(s) across {{locations}} location(s); {{unlocated}} with no location.',
    },
  },

  reports: {
    title: 'Reports',
    description:
      'Read-only views over the registry. Every report respects your organization scope.',
    notFound: 'Report not found',
    noReport: 'No report called “{{slug}}”',
    noReportHint: 'It may have been renamed.',
    back: 'Back to reports',
    export: 'Export CSV',
    /* The export takes what is on screen, and for a paged report that is this
       page — said plainly, because a partial export that looked complete would
       be found out only after someone acted on it. */
    exportNote: 'Export writes the rows shown above.',
    exportNotePaged: 'Export writes the rows shown above on this page.',
    exportWorkbook: 'Export workbook',
    /* This one is a SERVER export of the whole filtered set, photographs
       included — the opposite of the note above it, so it says so. */
    exportNoteWhole:
      'Export writes every row matching these filters, not only this page, as a spreadsheet with photographs.',
    totals: 'Totals',
    breakdown: 'Breakdown',
    chartEmpty: 'Nothing to chart yet.',
    empty: 'Nothing to report',
    emptyDescription: 'No records match this view.',
    anyClassification: 'Any classification',
    clearClassification: 'Clear classification',
    filterByClassification: 'Filter by classification',
    overdue: 'Overdue',
    pastDueOnly: 'Past due only',
    procurement: 'Procurement',
    tracedToContract: 'Traced to a contract',
    anyStartDate: 'Any start date',
    anyEndDate: 'Any end date',
    clearStartDate: 'Clear start date',
    clearEndDate: 'Clear end date',
    items: {
      inventory: {
        title: 'Inventory',
        description: 'Every asset with the number of physical units registered against it.',
        searchPlaceholder: 'Name or description…',
      },
      inventoryUnits: {
        title: 'Inventory (per unit)',
        description:
          'Every individual physical item, one row each. Export writes the full RPS sheet, with photographs where a unit or its asset has one.',
        searchPlaceholder: 'Inventory code or description…',
      },
      status: {
        title: 'Status',
        description: 'Asset units by lifecycle state, with the active/inactive asset split.',
      },
      byClassification: {
        title: 'By classification',
        description: 'Assets grouped by the classification they are registered under.',
      },
      byOrganization: {
        title: 'By organization',
        description: 'Asset units by institution and the department responsible for them.',
      },
      byLocation: {
        title: 'By location',
        description:
          'Asset units by where they currently are, including those with nothing recorded.',
      },
      // `CR-012`.
      byLocationCondition: {
        title: 'By location and condition',
        description:
          'Where the asset units are, crossed with what state they are in. Both axes at once.',
      },
      assessmentCoverage: {
        title: 'Monthly assessment coverage',
        description:
          'Which departments have assessed their asset units this month, and which units are outstanding.',
      },
      assessmentActivity: {
        title: 'Assessment activity',
        description:
          'Who recorded assessments in a month. Entries and units are counted separately.',
      },
      byCondition: {
        title: 'By condition',
        description: 'Asset units by recorded condition.',
      },
      borrowings: {
        title: 'Borrowings',
        description: 'Active and historical loans, with the overdue ones identified.',
      },
      procurementTraceability: {
        title: 'Procurement traceability',
        description:
          'Which assets trace back to a contract, and how many of their units carry the line item.',
      },
    },
    columns: {
      asset: 'Asset',
      assetUnits: 'Asset units',
      tracedUnits: 'Traced units',
      classification: 'Classification',
      institution: 'Institution',
      department: 'Department',
      location: 'Location',
      condition: 'Condition',
      lifecycleState: 'Lifecycle state',
      inventoryCode: 'Inventory code',
      count: 'Count',
      borrower: 'Borrower',
      contact: 'Contact',
      borrowed: 'Borrowed',
      due: 'Due',
      returned: 'Returned',
      contract: 'Contract',
      supplier: 'Supplier',
      contractDate: 'Contract date',
    },
    totalLabels: {
      assets: 'Assets',
      activeAssets: 'Active assets',
      inactiveAssets: 'Inactive assets',
      units: 'Units',
      classifications: 'Classifications in use',
      institutions: 'Institutions',
      locations: 'Locations in use',
      unlocated: 'Without a location',
      unrecorded: 'Condition not recorded',
    },
    values: {
      unassigned: 'Unassigned',
      noLocation: 'No location recorded',
      notRecorded: 'Not recorded',
      pastDue: 'Past due',
      noProcurement: 'No procurement record',
    },
  },

  notFound: {
    title: 'Page not found',
    description: 'That address does not match any page in the application.',
    back: 'Back to dashboard',
    reload: 'Reload the page',
  },
};
