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
      requests: 'Requests',
      reportsAudit: 'Reports & Audit',
    },
    items: {
      dashboard: 'Dashboard',
      assets: 'Assets',
      assetUnits: 'Asset units',
      myRooms: 'My rooms',
      unitReports: 'Unit reports',
      consumables: 'Consumables',
      locations: 'Locations',
      classifications: 'Classifications',
      suppliers: 'Suppliers',
      contracts: 'Contracts',
      vendors: 'Vendors',
      borrowings: 'Borrowings',
      transactions: 'Transactions',
      institutions: 'Institutions',
      inventoryCodeFormat: 'Inventory code format',
      teacherStorageRoom: 'Teacher storage room',
      departments: 'Departments',
      users: 'Users',
      roles: 'Roles',
      workflows: 'Workflow configuration',
      myRequests: 'My requests',
      allRequests: 'All requests',
      awaitingRequests: 'Needs my action',
      updatedRequests: 'Updates',
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
    myRooms: 'My rooms',
    unitReports: 'Unit reports',
    consumables: 'Consumables',
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
    teacherStorageRoom: 'Teacher storage room',
    departments: 'Departments',
    users: 'Users',
    roles: 'Roles',
    workflows: 'Workflow configuration',
    requests: 'Requests',
    allRequests: 'All requests',
    awaitingRequests: 'Needs my action',
    updatedRequests: 'Updates',
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

  // School positions — Phase 35 (`CR-014`). A separate concept from the person
  // in charge above: a position grants nothing and never touches a PIC record.
  positions: {
    title: 'School positions',
    departmentTitle: 'School positions in this department',
    description:
      'The posts this person holds, and the capacities they may request in. A position grants no access.',
    departmentDescription:
      'The Kajur, the Toolman and the Jurusan teachers of this department. Separate from the person in charge.',
    teacherHeading: 'Teacher',
    teacherHint: 'Request contexts: the capacity a teacher asks in, not separate jobs.',
    otherHeading: 'Positions',
    codes: {
      COMMON_TEACHER: 'Teacher — common subjects',
      JURUSAN_TEACHER: 'Teacher — Jurusan {{department}}',
      TOOLMAN: 'Toolman — {{department}}',
      KAJUR: 'Kajur — {{department}}',
      WAKASEK_SARPRAS: 'Wakasek Sarpras',
      WAKASEK_KURIKULUM: 'Wakasek Kurikulum',
      WAKASEK_KESISWAAN: 'Wakasek Kesiswaan',
      KEPALA_SEKOLAH: 'Kepala Sekolah',
    },
    options: {
      COMMON_TEACHER: 'Teacher — common subjects (request context)',
      JURUSAN_TEACHER: 'Teacher — Jurusan (request context)',
      TOOLMAN: 'Toolman',
      KAJUR: 'Kajur',
      WAKASEK_SARPRAS: 'Wakasek Sarpras',
      WAKASEK_KURIKULUM: 'Wakasek Kurikulum',
      WAKASEK_KESISWAAN: 'Wakasek Kesiswaan',
      KEPALA_SEKOLAH: 'Kepala Sekolah',
    },
    now: 'now',
    assign: 'Assign position',
    assignTitle: 'Assign a school position',
    assignDescription:
      'The assignment starts today and is recorded. A post that is already held must be ended first.',
    position: 'Position',
    department: 'Department',
    departmentHint: 'Active departments of this institution only.',
    person: 'Person',
    personHint: 'Active users of this institution, except yourself.',
    end: 'End',
    endTitle: 'End this assignment?',
    endDescription:
      'The assignment closes today. The record of who held it, and until when, is kept.',
    assigned: 'Position assigned',
    ended: 'Assignment ended',
    assignedBy: 'Assigned by {{name}}',
    selfNote: 'You cannot assign or end your own school positions.',
    empty: 'No school positions',
    emptyDescription: 'Nothing has been assigned yet.',
    noInstitution: 'This user belongs to no institution, so they cannot hold a school position.',
  },

  // Workflow configuration — Phase 36 (`CR-014`). Positions reuse
  // `positions.options` above; a step names a position, never a person.
  workflows: {
    title: 'Workflow configuration',
    description:
      'The approval process for each request category, per requester context. A context with no active workflow cannot submit that category — there is no default.',
    institution: 'Institution',
    institutionHint: 'Each school configures its own workflows.',
    selectInstitution: 'Select an institution',
    noInstitutionTitle: 'No institution',
    noInstitutionDescription:
      'Your account belongs to no institution, so there are no workflows to configure.',
    chooseInstitutionDescription: 'Choose the institution whose workflows you want to see.',
    gridTitle: 'Workflows by category and requester',
    gridDescription:
      'Each cell is one exact combination. "Not configured" means requests of that category from that context cannot be submitted.',
    requesterContext: 'Requester context',
    categories: {
      COMMON: 'Common',
      JURUSAN: 'Jurusan',
      KBM: 'KBM (teaching)',
      EKSKUL: 'Ekskul (extracurricular)',
    },
    statuses: {
      DRAFT: 'Draft',
      ACTIVE: 'Active',
      RETIRED: 'Retired',
    },
    stepTypes: {
      DECIDE: 'Decide (approve or reject)',
      PROCURE: 'Acquisition',
      REGISTER: 'Register units',
    },
    modes: {
      INTERNAL: 'Internal — "Procurement completed"',
      EXTERNAL: 'External — "Acquisition completed"',
    },
    activeVersion: 'Version {{version}} active',
    draftVersion: 'Draft v{{version}}',
    notConfigured: 'Not configured',
    // P2 (§64.2): a request this position may never make — nothing to configure.
    notEligible: 'Not requestable in this capacity',
    createDraft: 'Create draft',
    createDraftFor: 'Create a draft for {{category}} from {{context}}',
    createTitle: 'Create a draft workflow',
    createDescription:
      '{{category}} requests from {{context}}. Nothing takes effect until published.',
    startFrom: 'Start from',
    sources: {
      empty: 'An empty list of steps',
      template: 'The confirmed template for this combination',
      active: 'A copy of active version {{version}}',
    },
    templatesTitle: 'Start from a template',
    templatesDescription:
      'Only the flows the school has confirmed. A template creates a draft; actors the school has not yet decided are left empty and must be chosen before publishing.',
    actorUndecided: 'actor not decided ({{question}})',
    useTemplate: 'Use template',
    draftExists: 'A draft already exists',
    draftCreated: 'Draft created',
    editorTitle: '{{category}} — requested as {{context}}',
    editorDescription: 'Version {{version}}',
    stepsTitle: 'Steps',
    stepsDescription:
      'Decisions first, then at most one acquisition step, then exactly one registration step. One position acts at each step.',
    stepNumber: 'Step {{number}}',
    stepType: 'Type',
    actor: 'Position',
    actorNotChosen: 'Not chosen yet',
    departmentBoundHint: "Acts within the request's department.",
    procurementMode: 'Acquisition',
    selfSkip: 'Skip when the requester holds this position',
    selfSkipOn: 'On',
    selfSkipOff: 'Off',
    addStep: 'Add step',
    moveUp: 'Move step {{number}} up',
    moveDown: 'Move step {{number}} down',
    removeStep: 'Remove step {{number}}',
    saveSteps: 'Save steps',
    saved: 'Steps saved',
    unsaved: 'You have unsaved changes. Save them to check whether the workflow can be published.',
    publishable: 'Every step is valid. This draft can be published.',
    notPublishableTitle: 'Not ready to publish',
    notPublishableDescription:
      'Problems to fix first: {{count}}. Each is listed on the page, against its step.',
    publish: 'Publish',
    publishTitle: 'Publish this workflow?',
    publishDescription:
      'Version {{version}} becomes the active workflow, and the current active version, if any, is retired. Published versions cannot be edited.',
    published: 'Workflow published',
    activeReadOnly:
      'This is the active version. It cannot be edited: create a new version to change the process.',
    retiredReadOnly: 'This version has been retired. It cannot be edited.',
    createNewVersion: 'Create new version',
    versionsTitle: 'Versions',
    versionLabel: 'Version {{version}}',
    publishedOn: 'published {{date}}',
  },

  // Requests — Phase 37 (`CR-014`), drafting only. Category labels reuse
  // `workflows.categories`; contexts reuse `positions.codes`.
  requests: {
    myTitle: 'My requests',
    myDescription: 'Requests you have made. A draft is visible only to you.',
    allTitle: 'All requests',
    allDescription:
      "Your own requests, and your institution's submitted requests. Other people's drafts are private to them.",
    updatesTitle: 'Updates',
    updatesDescription:
      'Requests you are involved in — as requester, or as an actor on a step — where something happened since you last looked. For information: nothing here asks you to act.',
    awaitingTitle: 'Needs my action',
    awaitingDescription:
      'Requests with something for you to do now — submit your draft, approve, declare the acquisition, register units, record receipt, or close a stranded remainder. Only what you can actually do is listed.',
    /**
     * P5 (`IMPLEMENTATION_PLAN.md` §64.5), REQ-REQUEST-016. What the caller
     * needs to do — never "something changed" (that is Request Updates, P6).
     */
    /**
     * P6 (`IMPLEMENTATION_PLAN.md` §64.6), REQ-REQUEST-017. What changed on a
     * request the user is involved in since they last looked — informational,
     * never an action (that is `actionsNeeded`).
     */
    updates: {
      title: 'Updates',
      description:
        'Requests you are involved in where something happened since you last looked. For information — nothing here asks you to act.',
      column: 'Updates',
      more: '+{{count}} more',
      sinceTitle: 'Since your last view',
      sinceDescription: 'What happened on this request since {{date}}.',
      someone: 'someone',
      events: {
        STEP_DECIDED_APPROVED: 'Approved by {{name}} as {{position}}',
        STEP_DECIDED_REJECTED: 'Rejected by {{name}} as {{position}}',
        STEP_DECIDED_RETURNED: 'Returned for revision by {{name}} as {{position}}',
        REQUEST_RESUBMITTED: 'Resubmitted by {{name}} — the approval starts again',
        ACQUISITION_DECLARED: 'Acquisition completed by {{name}}',
        REGISTRATION_COMPLETED: 'Registration completed by {{name}}',
        UNITS_REGISTERED_one: '{{count}} unit registered by {{name}}',
        UNITS_REGISTERED_other: '{{count}} units registered by {{name}}',
        RECEIPT_RECORDED_one: 'Receipt of {{count}} unit recorded by {{name}}',
        RECEIPT_RECORDED_other: 'Receipt of {{count}} units recorded by {{name}}',
        RECEIPT_REVERSED_one: 'Receipt of {{count}} unit reversed by {{name}}',
        RECEIPT_REVERSED_other: 'Receipt of {{count}} units reversed by {{name}}',
        DOCUMENT_ADDED: '{{type}} added by {{name}}',
        REMAINDER_CLOSED: 'Remainder closed by {{name}}: {{reason}}',
        REQUEST_ENDED: 'Request {{status}} — by {{name}}',
      },
    },
    actionsNeeded: {
      column: 'Your action',
      kinds: {
        SUBMIT: 'Submit draft',
        RESUBMIT: 'Revise and resubmit',
        DECIDE: 'Approve',
        PROCURE: 'Declare acquisition',
        REGISTER: 'Register units',
        RECEIVE: 'Record receipt',
        CLOSE: 'Close remainder',
      },
      blocked: "Can't submit yet",
      navCount: '{{count}} requests need your action',
      bannerTitle: 'Needs your action',
      bannerDescription: 'On this request, you can do this now:',
      submitBlocked: "Can't submit yet — what is missing is listed below.",
      goTo: 'Go there',
      closeHint: 'Registered units can no longer be received; close the remainder so the request can finish.',
    },
    new: 'New request',
    newTitle: 'New request',
    editTitle: 'Edit draft {{number}}',
    formDescription:
      'Saved as a draft. Add its items and documents here, and submit it from this page when it is ready. You can change it until it is submitted.',
    headerTitle: 'Request',
    empty: 'No requests',
    emptyDescription: 'Nothing to show yet.',
    number: 'Number',
    titleField: 'Title',
    category: 'Category',
    requestedAs: 'Requested as',
    requester: 'Requester',
    department: 'Department',
    destination: 'Intended destination',
    destinationHint:
      'Where the items are meant to go. Intent until receipt: at receipt, a unit with no location yet is placed here. It never makes anyone responsible for it.',
    noDestination: 'No destination',
    destinationStorageRoom: 'Proposed by default: your institution’s teacher storage room.',
    neededBy: 'Needed by',
    justification: 'Justification',
    status: 'Status',
    created: 'Created',
    contextHint: 'The capacity you are asking in. It decides which process applies.',
    departmentLocked: 'Fixed by the capacity you are asking in.',
    noDepartment: 'No department',
    unusualCategory:
      'This category is not typical for {{context}}. You can still use it; whether it can be submitted depends only on the configured process.',
    noProcess:
      'No process is currently configured for this category. You can save this as a draft, but it cannot be submitted yet.',
    contextEnded:
      'You no longer hold the position this draft was made in. The draft can still be edited; it will need a current position to be submitted.',
    notDraft: 'Only a draft, or a request returned for revision, can be edited.',
    noContextTitle: 'You hold no school position',
    noContextDescription:
      'A request is made in one of your current school positions, such as Teacher or Kajur. Ask an administrator to assign one.',
    saveDraft: 'Save draft',
    viewDraft: 'View draft',
    createdToast: 'Draft {{number}} created',
    saved: 'Draft saved',
    itemsTitle: 'Items',
    itemsDescription:
      'Each quantity is a whole number of asset units. Measured or consumable goods are not requested here.',
    addItem: 'Add item',
    editItem: 'Edit item',
    itemDialogDescription: 'One line of the request.',
    itemSaved: 'Item saved',
    itemRemoved: 'Item removed',
    noItems: 'No items yet',
    noItemsDescription: 'A request needs at least one item before it can be submitted.',
    removeItemTitle: 'Remove this item?',
    removeItemDescription: 'The remaining items are renumbered.',
    item: {
      description: 'Description',
      // §73 — a line is an asset line or a consumable line.
      kind: 'Kind of item',
      kinds: { asset: 'Asset (registered as units)', consumable: 'Consumable (issued from stock)' },
      consumable: 'Consumable',
      consumableHint: 'Its name and unit come from the consumable.',
      chooseConsumable: 'Choose a consumable…',
      consumableBadge: 'Consumable',
      issued: '{{count}} issued',
      quantityIn: 'Quantity ({{unit}})',
      consumableQuantityHint: 'How many, in the consumable’s own unit.',
      specification: 'Specification',
      // REQ-REQUEST-019.
      referenceUrl: 'Reference link',
      referenceUrlHint:
        'Optional. A product page for reference. The system does not open or check it.',
      referenceUrlOpen: 'Reference link: {{host}} (opens in a new tab)',
      referenceUrlUnsafe: 'Reference link (not a valid web address): {{value}}',
      quantity: 'Quantity',
      quantityHint: 'A whole number of asset units.',
      requested: 'Requested',
      cancelled: 'Cancelled',
      required: 'Required',
      registered: 'Registered',
      receiptRecorded: 'Receipt recorded',
      notYetReceived: 'Not yet received',
      unit: 'Unit',
      noUnit: 'No unit',
      estimatedPrice: 'Estimated unit price',
      classification: 'Classification hint',
      classificationFieldHint: 'Optional. A hint for whoever registers the items, never required.',
      classificationHint: 'Hint: {{name}}',
    },
    workflow: {
      title: 'Process',
      description:
        'The steps this request follows, copied from the process in force when it was submitted.',
      stepNumber: 'Step {{number}}',
      types: {
        DECIDE: 'Decision',
        REGISTER: 'Registration of units',
      },
      acquisition: {
        INTERNAL: 'Acquisition (internal procurement)',
        EXTERNAL: 'Acquisition (external)',
      },
      procure: {
        INTERNAL: 'Procurement completed',
        EXTERNAL: 'Acquisition completed',
      },
      states: {
        PENDING: 'Not reached',
        ACTIVE: 'Open',
        APPROVED: 'Approved',
        REJECTED: 'Rejected',
        RETURNED: 'Returned for revision',
        DONE: 'Done',
        SKIPPED: 'Skipped',
        CLOSED: 'Not completed',
      },
      vacantBadge: 'Position vacant',
      vacant:
        'Position vacant: nobody currently holds it. The step waits until someone is assigned; it is never skipped.',
      waitingFor: 'Waiting for {{names}}.',
      pending: 'Opens when the steps before it are finished.',
      skippedSelf:
        'Skipped — the requester holds this position, and this step is set to skip in that case.',
      closed: 'Not completed — the request ended before this step was finished.',
      closedByRemainder: 'Not completed — the remainder was closed, so nothing is left to register.',
      closedByRevision: 'Not reached — the request was returned for revision in this round.',
      actedBy: {
        APPROVED: 'Approved by {{name}} as {{position}} on {{date}}.',
        REJECTED: 'Rejected by {{name}} as {{position}} on {{date}}.',
        RETURNED: 'Returned for revision by {{name}} as {{position}} on {{date}}.',
        DONE: 'Declared by {{name}} as {{position}} on {{date}}.',
        COMPLETED: 'Completed by {{name}} as {{position}} on {{date}}.',
      },
      comment: 'Comment',
      note: 'Note',
      approve: 'Approve',
      reject: 'Reject',
      requestRevision: 'Request revision',
      decisionTitle: {
        APPROVE: 'Approve this request?',
        REJECT: 'Reject this request?',
        REQUEST_REVISION: 'Return this request for revision?',
      },
      decisionDescription: {
        APPROVE: 'Your approval is recorded with your position. The next step opens.',
        REJECT: 'A rejection ends the request. A comment is required.',
        REQUEST_REVISION:
          'The request goes back to the requester to change and resubmit. When it is resubmitted, approval starts again from the first step. Say what must change and why.',
      },
      commentRequired: 'A comment is required to reject.',
      revisionReason: 'What must change, and why',
      revisionReasonRequired: 'A reason is required to request a revision.',
      itemNotesTitle: 'Notes on items (optional)',
      itemNotesHint: 'Point the requester to a specific line. Leave the others empty.',
      decidedToast: {
        APPROVE: 'Approved',
        REJECT: 'Rejected',
        REQUEST_REVISION: 'Returned for revision',
      },
      completeDescription:
        'Declares that acquisition is finished. It does not register units and does not mean the request is fulfilled.',
      confirmComplete: 'Declare completed',
      completedToast: {
        INTERNAL: 'Procurement declared completed',
        EXTERNAL: 'Acquisition declared completed',
      },
      submit: 'Submit',
      submitTitle: 'Submit this request?',
      submitDescription:
        'It follows the process configured for this category and your position. You can no longer edit it.',
      submitted: 'Request submitted',
      submitRefused: 'This request could not be submitted',
      // P1 (§64): what stands between the draft and its submission, from the
      // same checks the server makes when it is submitted.
      submitSection: 'Submit',
      submitReady:
        'Ready to submit. Documents and the destination are optional, and documents can still be added after submitting.',
      submitBlocked: 'Can’t submit yet',
      submitAdmin: 'Administrator action needed',
      submitSaveFirst: 'Save your changes before submitting — Submit sends the saved draft.',
      // REQ-REQUEST-018: the same submission, after a revision.
      resubmit: 'Resubmit',
      resubmitTitle: 'Resubmit this request?',
      resubmitDescription:
        'Approval starts again from the first step, on the same process the request was submitted under. The earlier decisions stay in its history.',
      resubmitted: 'Request resubmitted',
      resubmitSection: 'Resubmit',
      resubmitReady: 'Ready to resubmit.',
      resubmitSaveFirst: 'Save your changes before resubmitting — Resubmit sends the saved request.',
      blockers: {
        NO_ITEMS: 'Add at least one item.',
        REQUESTER_CONTEXT_ENDED:
          'You no longer hold the position this draft was written in. Start a new draft under a position you hold.',
        DEPARTMENT_INACTIVE: 'The department has been deactivated. Choose another department and save.',
        DESTINATION_INACTIVE:
          'The intended destination has been deactivated. Choose another one, or none, and save.',
        CONSUMABLE_INACTIVE:
          'A line names a consumable that has been deactivated. Remove the line or choose another consumable, and save.',
        CATEGORY_NOT_ELIGIBLE:
          'This category can’t be requested in the capacity you are asking in. Choose another category and save.',
        NO_WORKFLOW:
          'No approval process is configured for {{category}} requests made as {{context}}. Ask your administrator to configure one — you can keep editing this draft meanwhile.',
      },
      discard: 'Discard draft',
      discardTitle: 'Discard this draft?',
      discardDescription:
        'The draft is kept as cancelled, with your reason. Its number is not reused.',
      discarded: 'Draft discarded',
      cancel: 'Cancel request',
      cancelTitle: 'Cancel this request?',
      cancelDescription: 'Every step not yet finished is closed. This cannot be undone.',
      cancelled: 'Request cancelled',
      reason: 'Reason',
      reasonRequired: 'A reason is required.',
      changeDestination: 'Change destination',
      destinationChanged: 'Destination changed',
      approvedNote:
        'Approved — acquisition and registration may proceed. The request is not fulfilled until receipt of the units is recorded.',
      ended: 'Ended on {{date}}.',
      endedWithReason: 'Ended on {{date}}: {{reason}}',
    },
    documents: {
      title: 'Documents',
      description:
        'Files filed with this request. None is required. A document never changes the request or its steps.',
      types: {
        PROPOSAL: 'Proposal',
        SUPPORTING: 'Supporting document',
        INVOICE: 'Invoice',
        RECEIPT: 'Payment receipt',
        BAST: 'BAST',
        OTHER: 'Other',
      },
      uploadForm: 'Add a document',
      type: 'Type',
      chooseType: 'Choose a type',
      typeFor: 'Type of {{name}}',
      titleLabel: 'Title (optional)',
      file: 'File',
      chooseFile: 'Choose file',
      noFile: 'No file chosen',
      limits: 'Up to {{size}} MB — {{types}}',
      upload: 'Upload document',
      uploaded: 'Document uploaded',
      removed: 'Document deleted',
      typeRequired: 'Choose a type for each document.',
      fileRequired: 'Choose a file.',
      empty: 'No documents yet',
      emptyDescription:
        'Proposals, invoices, payment receipts and BAST appear here. None is required.',
      meta: '{{file}} · {{size}} · uploaded by {{name}} on {{date}}',
      download: 'Download {{name}}',
      delete: 'Delete {{name}}',
      deleteTitle: 'Delete this document?',
      deleteDescription: '"{{name}}" will be removed permanently.',
      deleteConfirm: 'Delete',
      withDeclaration: 'Documents (optional)',
      withDeclarationHint:
        'Uploaded to this request before the declaration is made, for example an invoice, payment receipt or BAST.',
      addDocument: 'Add a document',
      removeAttached: 'Remove {{name}}',
    },
    registration: {
      title: 'Registration',
      description:
        'Units registered against each item. Registration is not receipt: it does not mean the requester has received anything.',
      progress: '{{registered}} of {{required}} registered',
      none: 'No units registered yet.',
      registerUnits: 'Register units',
      linkExisting: 'Link an existing unit',
      registerTitle: 'Register units — {{item}}',
      registerDescription: 'Creates the units and links them to this item. {{remaining}} remain to be registered. The units are not moved; record their location afterwards.',
      register: 'Register',
      assetChoice: 'Asset',
      newAsset: 'New asset',
      existingAsset: 'Existing asset',
      asset: 'Asset',
      assetPlaceholder: 'Search assets',
      assetRequired: 'Choose an asset.',
      name: 'Asset name',
      nameRequired: 'A name is required.',
      classification: 'Classification',
      classificationRequired: 'Choose a classification.',
      unitCount: 'Number of units',
      remaining: '{{remaining}} remain to be registered',
      countRange: 'Between 1 and {{max}}.',
      department: 'Department',
      noDepartment: 'No department',
      // P3 (§64.3): department-bound registration.
      departmentFixedHint:
        "Units registered in this step belong to the request's department — the Kajur or Toolman registers for it only.",
      outsideDepartment: '(another department — read only)',
      fundingSource: 'Funding source',
      fundingSourceHint:
        "Recorded on each unit and used in its inventory code. Required unless the asset's contract names one.",
      fundingSourceNoAccess:
        'Your account cannot list funding sources. Ask an administrator for funding-source:read, or register under an asset whose contract names one.',
      noFundingSource: 'Not recorded',
      notReceipt: 'Registering does not record that the requester received the units.',
      registered_one: '{{count}} unit registered',
      registered_other: '{{count}} units registered',
      linkTitle: 'Link an existing unit — {{item}}',
      linkDescription: 'Find the unit by its inventory code. It must be active, not disposed or deactivated, and not already linked to a request.',
      inventoryCode: 'Inventory code',
      find: 'Find',
      notFound: 'No unit you can see has that inventory code.',
      link: 'Link',
      linked: 'Unit linked',
      unitInactive: 'Inactive',
      unitEnded: 'This unit is {{state}}.',
      alreadyLinked: 'Already registered against {{number}}.',
      linkedBy: 'Registered by {{name}} on {{date}}',
      unlink: 'Unlink',
      unlinkTitle: 'Unlink this unit?',
      unlinkDescription: '{{code}} will no longer count for this item. The unit itself is not changed.',
      unlinked: 'Unit unlinked',
      doneNote: 'Registration is complete. Links can no longer be removed.',
      // REQ-REQUEST-021 — the existing attribute system, after registration.
      specifications: {
        action: 'Specifications',
        title: 'Specifications — {{code}}',
        description:
          "From this classification's attribute definitions. Values already recorded are shown read-only — change them on the asset or unit page. Empty ones can be filled in here.",
        assetSection: 'Asset specifications',
        assetHint: 'Shared by every unit of {{name}}.',
        assetNotOpen:
          'This asset also has units of another department, so its shared specifications are recorded by someone who registers for all of them.',
        unitSection: "This unit's specifications",
        unitHint: 'This physical unit only ({{code}}).',
        recorded: 'Already recorded — change it on the asset or unit page.',
        requiredNote: 'Fields marked * are required whenever that set of specifications is saved.',
        openAsset: 'Open asset',
        openUnit: 'Open unit',
        save: 'Save specifications',
        saved: 'Specifications saved',
      },
      // REQ-REQUEST-020 — evidence of what was registered, not of receipt.
      photos: {
        action: 'Registration photos',
        title: 'Registration photos — {{code}}',
        description:
          'Photos of what was registered, kept with the asset and its units. They are not proof of receipt.',
        unitSection: 'Photo of this unit',
        unitHint: 'This unit only ({{code}}).',
        assetSection: 'Photo of the asset (all its units)',
        assetHint: 'Shows the asset in general — {{name}}.',
        assetNotOpen:
          'This asset also has units of another department, so photos of the whole asset are added by someone who registers for all of them.',
        add: 'Add photo',
        rules: 'JPG or PNG, up to {{max}} MB.',
        none: 'No registration photos yet.',
        added: 'Photo added',
        badge: 'Registration photo',
        choose: 'Choose a photo — {{section}}',
        open: 'Preview {{name}}',
        errors: {
          type: 'Only JPG or PNG photos can be added.',
          size: 'The photo is larger than {{max}} MB.',
        },
      },
    },
    received: 'Received',
    receipt: {
      action: 'Record receipt',
      title: 'Record receipt',
      description: 'Confirm which registered units you have received. Received at the intended place, a unit with no location is placed there; nothing else about it changes.',
      submit: 'Record receipt',
      selectAll: 'Select every unit that can be received ({{count}})',
      chooseUnits: 'Choose at least one unit.',
      cannotReceive: 'Cannot be received',
      receivedOn: 'Date received',
      receivedOnHint: 'Not in the future, and not before the request was made.',
      // Receipt confirmation (migration 057).
      placement: 'Where are the units now?',
      intendedPlace: 'Intended place for this request: {{name}}',
      noIntendedPlace:
        'This request has no intended place recorded, so no placement is asked. Describe where the units are.',
      placements: {
        AT_INTENDED_PLACE: 'At the intended place',
        NOT_AT_INTENDED_PLACE: 'Not at the intended place',
      },
      placementRequired: 'Choose where the units are.',
      descriptionLabel: 'Description',
      descriptionHint: 'Describe what you received and where it is.',
      descriptionHintElsewhere:
        'Explain where the units are and why they are not at the intended place.',
      descriptionRequired: 'A description is required.',
      // REQ-REQUEST-022: these are the whole receipt's; a unit's own are beside it.
      photos: 'Photos of the whole receipt',
      photosHint:
        '1 to {{count}} photos in total as evidence — here for the whole receipt, or beside a unit for that unit only. {{types}}, up to {{size}} MB each.',
      addPhotos: 'Add photos',
      addUnitPhotos: 'Photos of this unit ({{code}})',
      removePhoto: 'Remove {{name}}',
      photosRequired: 'Add at least one photo.',
      photosMax: 'At most {{count}} photos.',
      photoType: '{{name}}: only JPG or PNG photos are accepted.',
      photoSize: '{{name}} is larger than {{size}} MB.',
      notMoved:
        'Recording receipt never changes a unit’s state; it only places a unit with no location at the intended place. The photos are kept as evidence and cannot be deleted.',
      recorded_one: 'Receipt recorded for {{count}} unit',
      recorded_other: 'Receipt recorded for {{count}} units',
      recordedLine: 'Receipt recorded — received on {{receivedOn}}, recorded by {{name}} on {{date}}',
      notRecorded: 'Receipt not yet recorded',
      reversedLine: 'Receipt of {{receivedOn}} reversed by {{name}} on {{date}}: {{reason}}',
      reverse: 'Reverse receipt',
      reverseTitle: 'Reverse the receipt of {{code}}?',
      reverseDescription: 'The receipt stays in the history, marked reversed. The unit can then be received again.',
      reason: 'Reason',
      reasonRequired: 'A reason is required.',
      reversed: 'Receipt reversed',
      // REQ-REQUEST-024: what receiving does to a unit's location.
      destinationInactive:
        '{{name}} has been deactivated: units received now will not be placed there, and will need placement.',
      outcome: {
        placed: 'Will be placed at {{name}}',
        stays: 'Stays at {{name}}',
        needsPlacement: 'Will not be placed — it will need placement',
      },
    },
    // Migration 057: the requester's receipt evidence on the request page.
    confirmations: {
      title: 'Receipt confirmations',
      description:
        'The requester’s statement and photos with each receipt — evidence they provided, not a verified location.',
      confirmedLine: 'Confirmed by {{name}} on {{date}} · received on {{receivedOn}}',
      placements: {
        AT_INTENDED_PLACE: 'At the intended place — {{name}}',
        NOT_AT_INTENDED_PLACE: 'Not at the intended place — {{name}}',
      },
      noIntendedPlace: 'No intended place was recorded',
      units: 'Units:',
      reversed: 'receipt reversed',
      placedAt: 'placed at {{name}}',
      needsPlacement: 'needs placement',
      // REQ-REQUEST-022.
      wholePhotos: 'Photos of the whole receipt',
      unitPhotos: 'Photos of unit',
      states: { ACTIVE: 'Active', SUPERSEDED: 'Superseded' },
    },
    // §73 — consumables handed over from stock.
    issue: {
      action: 'Issue consumables',
      title: 'Issue consumables',
      description:
        'Enter what is actually handed over now. Stock goes down by exactly this; a line issued short stays open.',
      submit: 'Issue',
      done: 'Consumables issued',
      remaining: '{{count}} {{unit}} still needed',
      onHand: '{{count}} {{unit}} on hand',
      note: 'Note',
      wholeNumber: 'Enter whole numbers only.',
      tooMuch: 'Line {{line}} needs only {{count}} more.',
      nothing: 'Enter a quantity for at least one line.',
    },
    close: {
      action: 'Close remainder',
      title: 'Close the remainder?',
      description: 'Cancels what can no longer, or will no longer, be received. Registered units that can still be received are kept.',
      submit: 'Close remainder',
      cancels_one: 'cancels {{count}} ({{unregistered}} not yet registered, {{blocked}} cannot be received)',
      cancels_other: 'cancels {{count}} ({{unregistered}} not yet registered, {{blocked}} cannot be received)',
      nothing: 'nothing to cancel',
      outcome: {
        later_one: 'The request stays open until {{count}} more receipt is recorded; it is then Closed.',
        later_other: 'The request stays open until {{count}} more receipts are recorded; it is then Closed.',
        closedNow: 'The request will be Closed now.',
        cancelledNow: 'Nothing was registered: the request will be Cancelled now.',
      },
      reason: 'Reason',
      reasonRequired: 'A reason is required.',
      done: 'Remainder closed',
      strandedTitle: 'Some units cannot be received',
      stranded_one: '{{count}} registered unit can no longer be received. Close the remainder to finish this request.',
      stranded_other: '{{count}} registered units can no longer be received. Close the remainder to finish this request.',
      historyTitle: 'Remainder closed',
      historyEntry: 'Closed by {{name}} on {{date}}: {{reason}}',
    },
    // REQ-REQUEST-018 — returned for revision, and the earlier approval rounds.
    revision: {
      title: 'Returned for revision',
      by: 'Returned by {{name}} as {{position}} on {{date}}.',
      reason: 'Reason',
      itemNotes: 'Notes on items',
      line: 'Line {{line}} — {{description}}',
      itemNote: 'Revision note: {{note}}',
      removedItem: '(since removed)',
      reviseHint: 'Revise the request, then resubmit it. Approval starts again from the first step.',
      editHint: 'Change what was asked for, save, then resubmit below. Approval starts again from the first step.',
      revise: 'Revise',
      editTitle: 'Revise {{number}}',
      formDescription:
        'Returned to you for revision. Change the information, items and documents as asked, then resubmit.',
      viewRequest: 'View request',
      categoryFixed: 'Fixed during a revision: the request keeps the process it was submitted under.',
      departmentFixed: 'Fixed during this revision: a step of its process is decided within this department.',
      earlierRounds: 'Earlier approval rounds',
      earlierRoundsDescription: 'Each round as it was decided, and why it was returned.',
      round: 'Round {{number}}',
      roundStarted: 'started {{date}}',
    },
    errors: {
      descriptionRequired: 'is required',
      wholeQuantity: 'must be a whole number of at least 1',
      consumableRequired: 'choose a consumable',
      // REQ-REQUEST-019 — the same rules as the server's.
      referenceUrl: {
        type: 'must be a web address',
        whitespace: 'must not contain spaces or control characters',
        scheme: 'must start with http:// or https://',
        credentials: 'must not contain a user name or password',
        malformed: 'is not a valid web address',
        host: 'must name a website',
        tooLong: 'must be at most {{max}} characters',
      },
    },
    statuses: {
      DRAFT: 'Draft',
      SUBMITTED: 'Submitted',
      REVISION_REQUESTED: 'Revision requested',
      APPROVED: 'Approved',
      PARTIALLY_FULFILLED: 'Partially fulfilled',
      FULFILLED: 'Fulfilled',
      CLOSED: 'Closed',
      REJECTED: 'Rejected',
      CANCELLED: 'Cancelled',
    },
  },

  // §73 — consumables: quantity-based stock, not Assets.
  consumables: {
    title: 'Consumables',
    description:
      'Stock items counted by quantity, such as paper or markers. They have no units, inventory codes or labels.',
    new: 'New consumable',
    searchPlaceholder: 'Search by name',
    empty: 'No consumables yet',
    emptyDescription: 'Create one to start keeping its stock.',
    created: 'Consumable created',
    saved: 'Consumable saved',
    columns: { name: 'Name', unit: 'Unit', onHand: 'On hand', status: 'Status' },
    fields: {
      name: 'Name',
      unit: 'Unit of measure',
      description: 'Description',
      onHand: 'On hand',
      quantity: 'Quantity ({{unit}})',
      reason: 'Reason',
      note: 'Note',
    },
    formDescription: 'A consumable is counted in one unit. Quantities are never converted.',
    unitHint: 'For example ream, box or pcs.',
    unitLocked: 'Fixed: stock has already moved in this unit.',
    chooseUnit: 'Choose a unit…',
    errors: {
      required: 'is required',
      positive: 'must be a whole number of at least 1',
      nonZero: 'must be a whole number other than 0',
      reasonRequired: 'A reason is required',
    },
    detailDescription: 'Stock on hand and every movement that changed it.',
    stockTitle: 'Stock',
    inactiveHint: 'Inactive: stock cannot be received, adjusted or issued until it is reactivated.',
    receive: 'Receive stock',
    adjust: 'Adjust stock',
    received: 'Stock received',
    adjusted: 'Stock adjusted',
    receiveTitle: 'Receive {{name}}',
    adjustTitle: 'Adjust {{name}}',
    receiveDescription: 'Adds to stock. Now on hand: {{onHand}} {{unit}}.',
    adjustDescription:
      'Corrects stock, for example after a physical count. Now on hand: {{onHand}} {{unit}}.',
    receiveQuantityHint: 'How many arrived.',
    adjustQuantityHint: 'Positive adds, negative removes. Stock never goes below zero.',
    reasonHint: 'Say why, for example "physical stock count".',
    editTitle: 'Edit consumable',
    deactivate: 'Deactivate',
    reactivate: 'Reactivate',
    deactivateTitle: 'Deactivate this consumable?',
    reactivateTitle: 'Reactivate this consumable?',
    deactivateDescription:
      'It can no longer be requested, received, adjusted or issued. Its history stays.',
    reactivateDescription: 'It can be requested and its stock changed again.',
    movementTypes: { RECEIPT: 'Received', ISSUE: 'Issued', ADJUSTMENT: 'Adjusted' },
    movements: {
      title: 'Stock history',
      description: 'Every change of stock, newest first, with the balance it left.',
      when: 'When',
      type: 'Movement',
      quantity: 'Quantity',
      balance: 'Balance',
      detail: 'Details',
      by: 'By',
      empty: 'No stock movements yet',
      forRequest: 'Request {{number}}, line {{line}}',
    },
  },

  // REQ-REQUEST-025: a Room PIC's reports, and their review.
  unitReports: {
    myRoomsTitle: 'My rooms',
    myRoomsDescription:
      'The units now in the rooms you are in charge of. Report what you see — a reviewer decides what changes.',
    unitsTitle: 'Units in my rooms',
    noUnits: 'No units in your rooms',
    noUnitsDescription: 'Only units currently in a room you are the person in charge of are listed here.',
    mineTitle: 'My reports',
    noReports: 'No reports yet',
    report: 'Report',
    reportTitle: 'Report on {{code}}',
    reportDescription:
      'In {{room}}. Your report changes nothing until a reviewer confirms it.',
    kind: 'What are you reporting?',
    kinds: {
      CONDITION: 'Its condition',
      MOVEMENT: 'It has moved',
      OBSERVATION: 'Something else',
    },
    reportedCondition: 'Condition you see',
    destination: 'Where it is now',
    choose: 'Choose…',
    narrative: 'What you see',
    narrativeHint: 'Describe it as you found it.',
    submit: 'Send report',
    filed: 'Report sent',
    required: 'Required.',
    columns: {
      unit: 'Unit',
      asset: 'Asset',
      room: 'Room',
      condition: 'Condition',
      what: 'Report',
      reporter: 'Reported by',
      reportedAt: 'Reported',
      status: 'Status',
    },
    statuses: { PENDING: 'Waiting for review', CONFIRMED: 'Confirmed', REJECTED: 'Rejected' },
    what: { condition: 'Condition: {{condition}}', movement: 'Moved to {{name}}' },
    noCondition: 'no condition recorded',
    noLocation: 'no location',
    state: '{{room}}, {{condition}}',
    queueTitle: 'Unit reports',
    queueDescription:
      'Reports from the people in charge of rooms. Confirming a condition or a move changes the unit; it is never an assessment.',
    queueEmpty: 'No reports',
    review: 'Review',
    reviewTitle: 'Review the report on {{code}}',
    reviewDescription:
      'Confirm to apply it — a condition or a move is recorded in the unit history — or reject it with a note.',
    reportedBy: 'Reported by {{name}} on {{date}}',
    whenReported: 'When reported:',
    now: 'Now:',
    stale: 'Changed since',
    staleWarning:
      'The unit has changed since this report was sent. Check that it still applies before confirming.',
    acknowledgeStale: 'I have checked; confirm it anyway',
    reviewNote: 'Note',
    reviewNoteHint: 'Optional when confirming; required to reject.',
    rejectNeedsNote: 'A note is required to reject.',
    confirm: 'Confirm',
    reject: 'Reject',
    confirmed: 'Report confirmed',
    rejected: 'Report rejected',
  },
  units: {
    title: 'Asset unit',
    // §73 — choosing units for one label sheet.
    labels: {
      selectPage: 'Select every unit on this page',
      selectUnit: 'Select {{code}} for printing',
      selected: '{{count}} selected',
      clear: 'Clear selection',
      print: 'Print labels ({{count}})',
      tooMany: 'At most {{max}} labels can be printed at once.',
    },
    heading: 'Unit {{id}}',
    noDescription: 'No description',
    backToAsset: 'Back to asset',
    information: 'Unit information',
    tabs: {
      overview: 'Overview',
      attributes: 'Attribute values',
      history: 'History',
      // REQ-REQUEST-020: the unit's own files.
      attachments: 'Attachments',
      borrowings: 'Borrowings',
      transactions: 'Transactions',
    },
    fields: {
      lifecycleState: 'Lifecycle state',
      currentCondition: 'Current condition',
      currentLocation: 'Current location',
      procurementItem: 'Procurement item',
      requestedVia: 'Requested via',
      fundingSource: 'Funding source',
      noProcurementItem: 'Not traced to a line item',
      departmentHint: "Only departments of this asset's institution can be assigned.",
      departmentScopedHint: 'Units you add belong to your own department.',
      chooseDepartment: 'Choose your department',
      noDepartment: 'Not assigned',
      // Used by the procurement Add-asset dialog only, which P4 (§64.4) leaves
      // as it is (procurement is deferred); registration uses `unitNumber`.
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
    /**
     * P4 (`IMPLEMENTATION_PLAN.md` §64.4). The UNIT NUMBER is what a registrar
     * types for one unit; the INVENTORY CODE is the permanent code built from it
     * and the parts the institution's format fills in. Never "next number":
     * unit numbers are free-form and nothing is computed from them.
     */
    unitNumber: {
      label: 'Unit number',
      unitN: 'Unit {{n}}',
      inventoryCode: 'Inventory code',
      hint: "Type the unit number for each unit. The rest of the inventory code is filled in from your institution's inventory code format — you do not type it.",
      batchHint:
        'One unit number for all {{total}} units — each unit gets its own sequence number when it is registered.',
      allocated: 'assigned at registration',
      checking: 'Checking…',
      unavailable: 'The inventory code cannot be previewed right now. Registration still checks it.',
      waitingForAsset: 'Choose the asset to see the inventory code.',
      waitingForClassification: 'Choose the classification to see the inventory code.',
      waitingForDepartment: 'Choose the department to see the inventory code.',
      problems: 'The inventory code cannot be formed yet:',
      recent: 'Recently used unit numbers',
      recentNone: 'None yet for codes like this one.',
      recentNote:
        'Most recently registered first, for reference only — unit numbers are not assigned in sequence.',
      legendTyped: 'the unit number you type',
      legendGenerated: "filled in from the institution's format",
      advisory:
        'Checked as you type. Nothing is reserved — registration makes the final check.',
      fixBeforeRegistering: 'Give every unit its own unit number.',
      status: {
        EMPTY: 'Type a unit number.',
        required: 'A unit number is required.',
        INVALID: 'Cannot be used in an inventory code: {{issue}}',
        DUPLICATE_IN_BATCH: 'Already typed for another unit in this registration.',
        ALREADY_ISSUED: 'This inventory code has already been issued. Choose another unit number.',
        INCOMPLETE: 'The rest of the code is not complete yet — see below.',
        OK: 'Not issued yet.',
        OK_BATCH: 'The sequence number is added at registration.',
      },
      parts: {
        NUMBER_COMPOSITION: 'Unit number',
        INSTITUTION_CODE: 'Institution code',
        REGISTRATION_YEAR: 'Registration year',
        REGISTRATION_YEAR_SHORT: 'Registration year (2-digit)',
        CLASSIFICATION_CODE: 'Classification code',
        CLASSIFICATION_LEAF_LABEL: 'Classification label',
        DEPARTMENT_CODE: 'Department code',
        FUNDING_SOURCE_CODE: 'Funding source code',
        SEQUENCE: 'Sequence',
      },
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
      systemPlacement: 'Placed on receipt',
      fromReport: 'From a report',
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
      placement: 'Placement',
      needsPlacement: 'Needs placement',
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
      // P3 (§64.3).
      sharedAsset:
        'Other departments also have units of this asset, so changes to the asset as a whole — its details, activity, attribute values and its own files — are made by Sarpras. You can work on your own units.',
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
      descriptionSelected: 'Printable labels for the {{count}} units you selected, laid out for cutting.',
      noSelectionTitle: 'No units selected',
      noSelectionDescription: 'Select units in the Asset units list, then choose Print labels.',
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
        '{{token}} is the only thing separating one unit from another. Add a sequence or a unit number first — a format with neither would give every unit registered the same code.',
      compositionPerUnit:
        'This format allocates no sequence, so the unit number is the only thing that separates one unit from another. A unit number must be typed for every unit registered, including every unit of a procurement batch, and no two units may share one.',
      // P4 (§64.4): who provides each part, in the administrator's terms.
      howTitle: 'Who provides each part',
      roleTyped: 'Typed by the person registering, for each unit',
      roleGenerated: 'Filled in automatically from {{source}}',
      roleAllocated: 'Assigned automatically at registration, counting up',
      sources: {
        INSTITUTION_CODE: "the institution's code",
        REGISTRATION_YEAR: 'the year the unit is registered',
        REGISTRATION_YEAR_SHORT: 'the year the unit is registered',
        CLASSIFICATION_CODE: "the asset's classification",
        CLASSIFICATION_LEAF_LABEL: "the asset's classification name",
        DEPARTMENT_CODE: "the unit's department",
        FUNDING_SOURCE_CODE: "the unit's funding source, or else the asset's contract",
      },
      exampleLabel: 'Example',
      exampleTyped: 'The person registering types',
      exampleResult: 'and the inventory code becomes',
      registrarNote:
        'People registering units see only a "Unit number" field and the finished inventory code beside it — never this format or its parts.',
      noTyped:
        'This format has no unit number: nothing is typed at registration, and every part is filled in or assigned automatically.',
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
    teacherStorageRoom: {
      tab: 'Teacher storage room',
      title: 'Teacher storage room',
      description:
        'One location of this institution, shared by all teachers. A new request from a teacher who is not a room PIC proposes it as the intended destination.',
      none: 'Not configured',
      inactive:
        '{{name}} has been deactivated, so it is offered to no one. Choose another location or clear it.',
      futureOnly:
        'Changing it affects only new requests. Existing request destinations, receipt records and unit locations never change.',
      needsLocationRead: 'Choosing a room also needs permission to view locations.',
      saved: 'Teacher storage room saved',
      noInstitutionTitle: 'No institution to configure',
      noInstitutionDescription:
        'Your account is not attached to one institution. Open the institution you want from Institutions and use its Teacher storage room tab.',
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
      // Chosen at creation only, which is why the required case says so plainly:
      // it cannot be corrected afterwards.
      institutionRequiredHint:
        'Required, and permanent. Your role is not scoped to one institution, so there is none to default to — and a department created without one can never hold an asset unit.',
      institutionDefaultHint: 'Defaults to your own institution. Cannot be changed later.',
      selectInstitution: 'Select an institution',
      defaultInstitution: 'Use my institution',
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
