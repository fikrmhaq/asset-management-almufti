/**
 * Bahasa Indonesia — for an Indonesian school or educational institution.
 *
 * TERMINOLOGY. The register is the one used in school asset administration
 * (administrasi sarana dan prasarana / BMD), not a literal rendering of the
 * English. The glossary below is fixed and used consistently everywhere; the
 * same domain concept never changes word between screens.
 *
 *   Asset            → Aset
 *   Asset Unit       → Unit Aset          (the individually tracked item)
 *   Quantity         → Jumlah
 *   Unit of measure  → Satuan             (NEVER "Unit" — that is the item)
 *   Location         → Lokasi
 *   Floor plan       → Denah
 *   Floor plan area  → Area denah
 *   Classification   → Klasifikasi
 *   Institution      → Instansi
 *   Department       → Bagian
 *   Procurement      → Pengadaan
 *   Contract         → Kontrak
 *   Contract item    → Rincian kontrak
 *   Supplier         → Penyedia
 *   Vendor           → Vendor
 *   Borrowing        → Peminjaman
 *   Transaction      → Transaksi
 *   Condition        → Kondisi
 *   Lifecycle state  → Status siklus
 *   Report           → Laporan
 *   Audit log        → Log audit
 *
 * "Satuan" versus "Unit Aset" is the distinction the English UI was failing to
 * make, and Indonesian makes it naturally: 10 buah is a quantity, and each
 * Unit Aset is a separate tracked item.
 */
export const id = {
  common: {
    actions: {
      add: 'Tambah',
      cancel: 'Batal',
      clear: 'Kosongkan',
      close: 'Tutup',
      confirm: 'Konfirmasi',
      create: 'Buat',
      deactivate: 'Nonaktifkan',
      delete: 'Hapus',
      edit: 'Ubah',
      rename: 'Ubah nama',
      reactivate: 'Aktifkan kembali',
      remove: 'Hapus',
      retry: 'Coba lagi',
      save: 'Simpan',
      saveChanges: 'Simpan perubahan',
      search: 'Cari',
      view: 'Lihat',
    },
    states: {
      loading: 'Memuat…',
      empty: 'Belum ada data',
      noResults: 'Tidak ada hasil',
      notRecorded: 'Belum dicatat',
      notAssigned: 'Belum ditentukan',
      none: 'Tidak ada',
      createFirst: 'Buat yang pertama untuk memulai.',
      noMatches: 'Tidak ada yang cocok dengan filter ini.',
    },
    errors: {
      title: 'Terjadi kesalahan',
      forbidden: 'Anda tidak memiliki izin untuk melakukan tindakan ini.',
      notFound: 'Data tidak ditemukan.',
      conflict: 'Tindakan ini bertentangan dengan kondisi data saat ini.',
      validation: 'Sebagian data yang diisi belum valid.',
      internal: 'Terjadi kesalahan pada server.',
      network: 'Server tidak dapat dihubungi. Periksa koneksi Anda.',
      unauthorized: 'Sesi Anda telah berakhir. Silakan masuk kembali.',
      cancelled: 'Permintaan dibatalkan.',
      requestFailed: 'Permintaan gagal.',
    },
    fields: {
      name: 'Nama',
      description: 'Keterangan',
      status: 'Status',
      notes: 'Catatan',
      date: 'Tanggal',
      from: 'Dari',
      to: 'Sampai',
      classification: 'Klasifikasi',
      institution: 'Instansi',
      department: 'Bagian',
    },
    filters: {
      all: 'Semua',
      searchPlaceholder: 'Cari…',
      status: 'Status',
    },
    select: {
      placeholder: 'Pilih…',
      search: 'Cari…',
    },
    table: {
      sortBy: 'Urutkan menurut {{field}}',
    },
    pagination: {
      label: 'Navigasi halaman',
      range: '{{first}}–{{last}} dari {{total}}',
      page: 'Halaman {{page}} dari {{totalPages}}',
      pageEmpty: 'Halaman 0 dari 0',
      previous: 'Halaman sebelumnya',
      next: 'Halaman berikutnya',
    },
    date: {
      pick: 'Pilih tanggal',
      clear: 'Kosongkan tanggal',
    },
    language: {
      label: 'Bahasa',
      change: 'Ganti bahasa',
    },
    theme: {
      label: 'Tema',
      light: 'Terang',
      dark: 'Gelap',
      system: 'Sistem',
    },
    toast: {
      created: '{{label}} berhasil dibuat',
      updated: '{{label}} berhasil diperbarui',
      deactivated: '{{label}} dinonaktifkan',
      reactivated: '{{label}} diaktifkan kembali',
      deleted: '{{label}} dihapus',
    },
  },

  operations: {
    borrowings: {
      extendDescription:
        'Catatan ini ditutup sebagai dikembalikan dan draf baru dibuka atas unit yang sama, sehingga keduanya mempertahankan tanggal aslinya.',
      unitsEditable:
        'Unit yang tercakup dalam peminjaman ini. Terkunci setelah peminjaman diaktifkan.',
      unitsFixed: 'Unit yang tercakup dalam peminjaman ini. Isinya sudah terkunci.',
      title: 'Peminjaman',
      description: 'Catatan resmi unit aset yang sedang dipinjam.',
      searchPlaceholder: 'Nama atau kontak peminjam…',
      overdue: 'Terlambat',
      empty: 'Peminjaman tidak ditemukan',
      newTitle: 'Peminjaman baru',
      newDescription: 'Dibuat sebagai draf. Tambahkan unit yang dipinjam, lalu aktifkan.',
      section: 'Peminjaman',
      discardTitle: 'Buang perubahan?',
      discardDescription: 'Perubahan pada peminjaman ini belum disimpan dan akan hilang.',
      discard: 'Buang',
      borrower: 'Peminjam',
      borrowerContact: 'Kontak peminjam',
      borrowerContactHint: 'Cara menghubungi peminjam selama barang dipinjam.',
      borrowDate: 'Tanggal pinjam',
      expectedReturn: 'Rencana kembali',
      responsiblePerson: 'Penanggung jawab',
      responsiblePersonHint: 'Staf yang bertanggung jawab atas peminjaman ini.',
      units: 'Unit',
      noUnits: 'Belum ada unit',
      noUnitsDescription: 'Peminjaman harus memuat minimal satu unit sebelum dapat diaktifkan.',
      addUnit: 'Tambah unit ke peminjaman ini',
      timeline: 'Lini masa',
      timelineDescription:
        'Dicatat pada peminjaman itu sendiri. Catatan yang selesai mempertahankan tanggal aslinya.',
      borrowed: 'Dipinjam',
      actualReturn: 'Tanggal kembali',
      pastDue: 'Lewat tenggat',
      activateTitle: 'Aktifkan peminjaman ini?',
      activate: 'Aktifkan',
      cancelTitle: 'Batalkan peminjaman ini?',
      cancelDescription:
        'Draf yang dibatalkan tidak dapat dibuka kembali. Tidak ada unit yang berubah status — draf belum pernah memegangnya.',
      cancelConfirm: 'Batalkan peminjaman',
      returnTitle: 'Catat pengembalian',
      returnDescription:
        'Setiap unit yang masih dipinjam kembali menjadi digunakan. Tindakan ini tidak dapat dibatalkan.',
      returnSubmit: 'Catat pengembalian',
      actualReturnDate: 'Tanggal kembali',
      defaultsToday: 'Standarnya hari ini.',
      note: 'Catatan',
      extendTitle: 'Perpanjang peminjaman ini',
      extend: 'Perpanjang',
      newExpectedReturn: 'Rencana kembali baru',
      newExpectedReturnHint: 'Kapan peminjaman lanjutan harus dikembalikan.',
      closingDate: 'Tanggal penutupan catatan ini',
    },
    transactions: {
      affectedUnitsDetail:
        'Unit yang dicatat dalam transaksi ini. Status siklus menunjukkan kondisi sekarang, bukan saat transaksi.',
      title: 'Transaksi',
      description: 'Peristiwa operasional yang dicatat pada masing-masing unit aset.',
      type: 'Jenis',
      contract: 'Kontrak',
      anyStartDate: 'Tanpa tanggal awal',
      anyEndDate: 'Tanpa tanggal akhir',
      empty: 'Transaksi tidak ditemukan',
      newTitle: 'Transaksi baru',
      newDescription:
        'Catatan historis. Setelah dibuat, transaksi tidak dapat diubah atau dihapus.',
      section: 'Transaksi',
      transactionDate: 'Tanggal transaksi',
      supplier: 'Penyedia',
      procurementOnlyHint: 'Hanya untuk transaksi yang berasal dari pengadaan.',
      institutionHint: 'Standarnya instansi Anda sendiri.',
      affectedUnits: 'Unit yang terpengaruh',
      affectedUnitsDescription: 'Unit fisik mana yang mengalami transaksi ini.',
      notePlaceholder: 'Catatan (opsional)',
      addUnits: 'Tambah unit ke transaksi ini',
      discardTitle: 'Buang transaksi ini?',
      discardDescription: 'Belum ada yang tercatat, dan rincian ini akan hilang.',
      discard: 'Buang',
      noUnits: 'Belum ada unit',
    },
    vendors: {
      deactivateActive:
        'Aset yang sudah ada tetap merujuk padanya; hanya aset baru yang kehilangan pilihan ini.',
      deactivateInactive: 'Vendor dapat dipilih kembali pada aset baru.',
      title: 'Vendor',
      description: 'Produsen dan merek yang menjadi asal aset.',
      searchPlaceholder: 'Nama…',
      empty: 'Vendor tidak ditemukan',
      newTitle: 'Vendor baru',
      contactInformation: 'Informasi kontak',
      address: 'Alamat',
      details: 'Rincian',
      assets: 'Aset',
      assetsDescription: 'Aset yang berasal dari vendor ini, dalam cakupan organisasi Anda.',
      noAssets: 'Belum ada aset',
      noAssetsDescription: 'Belum ada aset yang berasal dari vendor ini.',
    },
  },

  resources: {
    asset: 'Aset',
    location: 'Lokasi',
    borrowing: 'Peminjaman',
    transaction: 'Transaksi',
    institution: 'Instansi',
    department: 'Bagian',
    user: 'Pengguna',
    role: 'Peran',
    attributeDefinition: 'Definisi atribut',
    category: 'Kategori',
    measurementUnit: 'Satuan',
    contractType: 'Jenis kontrak',
    fundingSource: 'Sumber dana',
    transactionType: 'Jenis transaksi',
    accountCode: 'Kode rekening',
    supplier: 'Penyedia',
    contract: 'Kontrak',
    vendor: 'Vendor',
  },

  patterns: {
    derived: {
      pending: 'Belum ditentukan',
    },
    createRelated: {
      action: 'Tambah baru',
    },
    dependent: {
      placeholder: 'Isi kolom di atas terlebih dahulu',
      unavailable: 'Pilih kolom di atas untuk melihat pilihan yang tersedia di sini.',
      empty: 'Tidak ada pilihan untuk data yang dipilih.',
    },
    scope: {
      label: 'Cakupan',
      all: 'Termasuk di dalamnya',
      direct: 'Di sini saja',
    },
    timeline: {
      empty: 'Belum ada catatan',
    },
    locationSelector: {
      title: 'Pilih lokasi',
      description:
        'Cari berdasarkan nama, atau buka sebuah lokasi untuk melihat isinya. Semua lokasi dapat dipilih.',
      placeholder: 'Pilih lokasi…',
      searchLabel: 'Cari lokasi',
      searchPlaceholder: 'Cari lokasi…',
      clearSearch: 'Hapus pencarian',
      clear: 'Hapus lokasi',
      trail: 'Jalur lokasi',
      top: 'Semua lokasi',
      loading: 'Memuat lokasi…',
      noMatches: 'Lokasi tidak ditemukan',
      noMatchesHint: 'Coba nama lain, atau telusuri dengan membuka sebuah lokasi.',
      nothingHere: 'Tidak ada apa pun di dalam lokasi ini',
      openInside: 'Buka {{name}}',
    },
  },

  states: {
    error: {
      forbidden: 'Anda tidak memiliki akses ke data ini',
      notFound: 'Tidak ditemukan',
      conflict: 'Bertentangan dengan kondisi data saat ini',
      unauthorized: 'Sesi Anda telah berakhir',
      network: 'Server tidak dapat dihubungi',
      default: 'Terjadi kesalahan',
    },
  },

  nav: {
    groups: {
      dashboard: 'Beranda',
      assets: 'Aset',
      procurement: 'Pengadaan',
      operations: 'Operasional',
      organization: 'Organisasi',
      reportsAudit: 'Laporan & Audit',
    },
    items: {
      dashboard: 'Beranda',
      assets: 'Aset',
      assetUnits: 'Unit aset',
      locations: 'Lokasi',
      classifications: 'Klasifikasi',
      suppliers: 'Penyedia',
      contracts: 'Kontrak',
      vendors: 'Vendor',
      borrowings: 'Peminjaman',
      transactions: 'Transaksi',
      institutions: 'Instansi',
      inventoryCodeFormat: 'Format kode inventaris',
      departments: 'Bagian',
      users: 'Pengguna',
      roles: 'Peran',
      attributeDefinitions: 'Definisi atribut',
      lookups: 'Data referensi',
      reports: 'Laporan',
      auditLog: 'Log audit',
    },
    mainNavigation: 'Navigasi utama',
    toggle: 'Tampilkan/sembunyikan menu',
    closeMenu: 'Tutup menu',
    breadcrumb: 'Navigasi lokasi halaman',
    noModules: 'Tidak ada modul yang tersedia untuk akun Anda.',
  },

  crumbs: {
    home: 'Beranda',
    assets: 'Aset',
    assetUnits: 'Unit aset',
    labels: 'Label',
    scan: 'Pindai',
    locations: 'Lokasi',
    classifications: 'Klasifikasi',
    reference: 'Referensi',
    attributeDefinitions: 'Definisi atribut',
    lookups: 'Data referensi',
    procurement: 'Pengadaan',
    suppliers: 'Penyedia',
    contracts: 'Kontrak',
    operations: 'Operasional',
    vendors: 'Vendor',
    borrowings: 'Peminjaman',
    transactions: 'Transaksi',
    organization: 'Organisasi',
    institutions: 'Instansi',
    inventoryCodeFormat: 'Format kode inventaris',
    departments: 'Bagian',
    users: 'Pengguna',
    roles: 'Peran',
    reports: 'Laporan',
    audit: 'Log audit',
    new: 'Baru',
    edit: 'Ubah',
    floorPlan: 'Denah',
  },

  /**
   * Sign-in screen.
   *
   * "Masuk", not "Login": the Indonesian verb is what school staff read on every
   * other government and school portal, and the loanword reads as developer copy.
   * "Nama pengguna" over "Username" for the same reason.
   */
  auth: {
    title: 'Masuk',
    subtitle: 'Gunakan akun instansi Anda untuk melanjutkan.',
    username: 'Nama pengguna',
    password: 'Kata sandi',
    submit: 'Masuk',
    help: 'Mengalami kendala saat masuk? Hubungi administrator aset Anda.',
    session: {
      restoring: 'Memulihkan sesi Anda…',
      unavailableTitle: 'Server tidak dapat dihubungi',
      unavailableDescription:
        'Sesi Anda belum diakhiri — kami hanya belum dapat memastikannya. Periksa koneksi Anda lalu coba lagi.',
    },
    errors: {
      usernameRequired: 'Masukkan nama pengguna Anda.',
      usernameTooLong: 'Nama pengguna maksimal 25 karakter.',
      passwordRequired: 'Masukkan kata sandi Anda.',
    },
  },

  shell: {
    /* "Manajemen Aset" is the term Indonesian school administration actually
       uses for this; "Pengelolaan Barang" belongs to a different (BMN/BMD)
       regime and would imply reporting obligations this system does not have. */
    appName: 'Manajemen Aset',
    searchAssets: 'Cari aset',
    searchAssetsPlaceholder: 'Cari aset…',
    signOut: 'Keluar',
    signOutTitle: 'Keluar dari aplikasi?',
    signOutDescription: 'Anda perlu masuk kembali untuk melanjutkan.',
    noRoles: 'Tanpa peran',
  },

  enums: {
    active: 'Aktif',
    inactive: 'Nonaktif',
    lifecycle: {
      REGISTERED: 'Terdaftar',
      ACTIVE: 'Digunakan',
      IN_STORAGE: 'Di gudang',
      BORROWED: 'Dipinjam',
      UNDER_MAINTENANCE: 'Dalam perbaikan',
      DISPOSED: 'Dihapuskan',
      DEACTIVATED: 'Dinonaktifkan',
    },
    condition: {
      GOOD: 'Baik',
      FAIR: 'Cukup',
      POOR: 'Kurang baik',
      DAMAGED: 'Rusak',
      UNSERVICEABLE: 'Rusak berat',
    },
    borrowing: {
      DRAFT: 'Draf',
      ACTIVE: 'Berjalan',
      RETURNED: 'Dikembalikan',
      OVERDUE: 'Terlambat',
      CANCELLED: 'Dibatalkan',
    },
    attributeType: {
      TEXT: 'Teks',
      NUMBER: 'Angka',
      BOOLEAN: 'Ya atau tidak',
      DATE: 'Tanggal',
      SELECTION: 'Pilihan',
      REFERENCE: 'Referensi',
    },
    attributeScope: {
      ASSET: 'Aset',
      ASSET_UNIT: 'Unit aset',
    },
    auditAction: {
      CREATE: 'Dibuat',
      UPDATE: 'Diubah',
      DELETE: 'Dihapus',
      STATUS_CHANGE: 'Status diubah',
    },
  },

  audit: {
    title: 'Log audit',
    description:
      'Catatan hanya-baca atas perubahan pada data bisnis penting. Mencakup seluruh instansi.',
    empty: 'Belum ada catatan audit',
    when: 'Waktu',
    actor: 'Pelaku',
    action: 'Tindakan',
    entity: 'Entitas',
    entityId: 'ID entitas',
    entityType: 'Jenis entitas',
    entityTypePlaceholder: 'Asset, Borrowing…',
    entityIdPlaceholder: 'ID persis',
    anyStartDate: 'Tanpa tanggal awal',
    anyEndDate: 'Tanpa tanggal akhir',
    clearStartDate: 'Kosongkan tanggal awal',
    clearEndDate: 'Kosongkan tanggal akhir',
    system: 'Sistem',
    entryTitle: 'Catatan audit',
    entryDescription:
      'Satu perubahan yang tercatat. Catatan audit tidak pernah dapat diubah atau dihapus.',
    ipAddress: 'Alamat IP',
    request: 'Permintaan',
    field: 'Kolom',
    before: 'Sebelum',
    after: 'Sesudah',
    changed: 'berubah',
    emptyValue: '(kosong)',
    noValues: 'Tidak ada nilai kolom yang tercatat.',
  },

  locations: {
    title: 'Lokasi',
    description:
      'Tempat unit aset berada secara fisik. Lokasi tersusun bertingkat sesuai cakupannya.',
    new: 'Lokasi baru',
    namePlaceholder: 'Nama lokasi…',
    emptyList: 'Lokasi tidak ditemukan',
    emptyRoots: 'Belum ada lokasi tingkat teratas',
    treeView: 'Tampilkan sebagai struktur',
    listView: 'Tampilkan sebagai daftar',
    expand: 'Buka {{name}}',
    collapse: 'Tutup {{name}}',
    nothingInside: 'Tidak ada lokasi di dalam lokasi ini.',
    columns: {
      inside: 'Berada di',
    },
    topLevel: 'Tingkat teratas',
    parentUnavailable: 'Lokasi yang tidak dapat Anda akses',
    formDescription: 'Gedung, lantai, atau ruang tempat unit aset ditempatkan.',
    create: 'Buat lokasi',
    parentHint: 'Kosongkan untuk lokasi tingkat teratas seperti situs atau gedung.',
    institutionDefault: 'Ikuti instansi saya',
    insideAnother: 'Berada di dalam lokasi lain',
    details: 'Detail lokasi',
    classificationHint: 'Ditetapkan saat lokasi dibuat.',
    children: {
      title: 'Lokasi di dalamnya',
      empty: 'Belum ada lokasi tercatat di dalam lokasi ini.',
    },
    units: {
      title: 'Unit aset',
      descriptionAll:
        'Seluruh unit di lokasi ini dan di semua lokasi di dalamnya. Kolom Lokasi menunjukkan tempat unit sebenarnya berada.',
      descriptionDirect: 'Hanya unit yang tercatat di {{name}} itu sendiri.',
      scopeLabel: 'Unit yang ditampilkan',
      scopeAll: 'Termasuk di dalamnya',
      scopeDirect: 'Di sini saja',
      here: 'Di sini',
      inside: 'Di dalamnya',
      emptyTitle: 'Belum ada unit aset',
      emptyAll: 'Tidak ada unit aset tercatat di lokasi ini maupun di dalamnya.',
      emptyDirect:
        'Tidak ada unit aset tercatat di lokasi ini sendiri. Coba “Termasuk di dalamnya”.',
    },
    deactivate: {
      title: 'Nonaktifkan lokasi ini?',
      description:
        'Riwayat lokasi unit aset tetap tersimpan; lokasi ini tidak lagi ditawarkan untuk penempatan baru.',
      reactivateTitle: 'Aktifkan kembali lokasi ini?',
      reactivateDescription: 'Lokasi ini dapat dipilih kembali untuk penempatan.',
    },
    tabs: {
      info: 'Informasi',
      units: 'Unit aset',
      floorPlan: 'Denah',
    },
  },

  floorPlan: {
    title: 'Denah',
    pageTitle: 'Denah — {{name}}',
    editDescription: 'Gambarkan ruangan-ruangan di dalam lokasi ini pada denahnya.',
    belongsTo: 'Denah ini milik {{name}}.',
    backToLocation: 'Kembali ke lokasi',
    goToLocation: 'Buka lokasi tersebut',
    whereUnitIs: 'Posisi unit aset',
    unitLocation: 'Lokasi unit aset',
    planBelongsTo: 'Denah milik lokasi',
    highlighted: '{{name}} ditandai pada denah ini.',
    notMapped:
      'Denah ini tidak menandai lokasi persisnya — belum ada area yang digambar untuk lokasi tersebut. Lokasi itu berada di dalam lokasi yang digambarkan denah ini.',
    highlightedTag: '— ditandai',
    none: 'Belum ada denah',
    noneDescription: 'Unggah gambar denah untuk mulai menandai ruangan di dalamnya.',
    upload: 'Unggah denah',
    replace: 'Ganti denah',
    chooseImage: 'Pilih gambar denah',
    uploaded: 'Denah berhasil diunggah',
    replaced: 'Denah berhasil diganti',
    removed: 'Denah dihapus',
    remove: 'Hapus denah',
    draw: 'Gambar area',
    saveArea: 'Simpan area',
    areaAdded: 'Area ditambahkan',
    areaRemoved: 'Area dihapus',
    drawHint:
      'Klik denah untuk menempatkan titik sudut. {{count}} titik ditempatkan — minimal {{min}} titik.',
    areaLocation: 'Ruangan yang diwakili area ini',
    selectLocation: 'Pilih lokasi…',
    addByCoordinate: 'Tambah titik lewat koordinat (0–1)',
    pointX: 'Titik X',
    pointY: 'Titik Y',
    addPoint: 'Tambah titik',
    undoPoint: 'Batalkan titik',
    areasHere: 'Area pada denah ini',
    noAreas:
      'Belum ada area yang ditentukan. Ruangan di dalam lokasi ini dapat digambar pada denah.',
    points: '{{count}} titik',
    imageAlt: 'Denah lokasi ini: {{fileName}}',
    loadingImage: 'Memuat denah…',
    deleteArea: 'Hapus area untuk {{name}}',
    confirmRemovePlan: 'Hapus denah ini?',
    confirmRemovePlanDescription:
      'Denah beserta seluruh area yang digambar di atasnya akan dihapus. Lokasi yang diwakilinya tidak terpengaruh.',
    confirmRemoveArea: 'Hapus area ini?',
    confirmRemoveAreaDescription: 'Lokasi yang diwakili area ini tidak terpengaruh.',
  },

  /**
   * Penanggung jawab — Phase 21 (`CR-003`).
   *
   * "Penanggung jawab" is the register used in school asset administration, and
   * the legacy column was literally `penanggung_jawab`. Not "PIC": the English
   * initialism is not what the paperwork says.
   */
  pic: {
    title: 'Penanggung jawab',
    description: 'Siapa yang bertanggung jawab sekarang, dan siapa sebelumnya.',
    current: 'Saat ini',
    none: 'Belum ada',
    now: 'sekarang',
    assign: 'Tetapkan',
    assignTitle: 'Tetapkan penanggung jawab',
    assignDescription: 'Yang bersangkutan bertanggung jawab mulai hari ini. Perubahan dicatat.',
    handOver: 'Serah terima',
    handOverTitle: 'Serahkan kepada orang lain',
    handOverDescription:
      'Masa tugas penanggung jawab saat ini ditutup hari ini dan masa tugas baru dimulai. Kedua catatan tetap tersimpan.',
    clear: 'Kosongkan',
    clearTitle: 'Kosongkan penanggung jawab?',
    clearDescription:
      'Jabatan dibiarkan kosong. Catatan siapa yang pernah memegangnya, dan sampai kapan, tetap disimpan.',
    person: 'Orang',
    personHint: 'Hanya pengguna aktif dari instansi ini.',
    assigned: 'Penanggung jawab diperbarui',
    cleared: 'Penanggung jawab dikosongkan',
    assignedBy: 'Ditetapkan oleh {{name}}',
    empty: 'Belum ada penanggung jawab',
    emptyDescription: 'Tetapkan seseorang untuk memulai catatan tanggung jawab.',
    noInstitution:
      'Data ini belum dimiliki instansi mana pun, sehingga belum ada yang dapat ditetapkan sebagai penanggung jawab.',
  },

  units: {
    title: 'Unit aset',
    heading: 'Unit {{id}}',
    noDescription: 'Tanpa keterangan',
    backToAsset: 'Kembali ke aset',
    information: 'Informasi unit aset',
    tabs: {
      overview: 'Ringkasan',
      attributes: 'Nilai atribut',
      history: 'Riwayat',
      borrowings: 'Peminjaman',
      transactions: 'Transaksi',
    },
    fields: {
      lifecycleState: 'Status siklus',
      currentCondition: 'Kondisi saat ini',
      currentLocation: 'Lokasi saat ini',
      procurementItem: 'Rincian pengadaan',
      noProcurementItem: 'Tanpa rincian pengadaan',
      departmentHint: 'Hanya bagian dari instansi aset ini yang dapat dipilih.',
      noDepartment: 'Belum ditetapkan',
      numberComposition: 'Komposisi nomor',
      numberCompositionHint:
        'Menjadi bagian dari kode inventaris permanen unit ini, persis seperti yang Anda ketik — tidak pernah disesuaikan. Hanya huruf, angka, tanda hubung, garis bawah, dan titik, maksimal {{max}} karakter menurut format instansi ini.',
      numberCompositions: 'Komposisi nomor',
      numberCompositionsHint:
        'Satu per baris, {{total}} seluruhnya — format instansi ini tidak memakai nomor urut, sehingga setiap unit perlu komposisinya sendiri. Maksimal {{max}} karakter per baris, dan tidak boleh ada yang sama.',
      numberCompositionsCount: '{{entered}} dari {{expected}} terisi',
    },
    location: {
      unrecorded: 'Belum dicatat — lokasi ditetapkan melalui pencatatan perubahan status.',
      planTrail: 'Denah yang menunjukkan unit ini',
      planTrailHint: 'Setiap denah menandai satu langkah lebih ke dalam.',
      viewPlanOf: 'Lihat denah {{name}}',
      planHere: 'Lokasi ini memiliki denah sendiri.',
      planAbove: 'Ditampilkan pada denah milik {{name}}',
      planAboveMapped: ', dan lokasinya ditandai di sana.',
      planAboveUnmapped: ', namun lokasinya belum ditandai di sana.',
      planUnknownOwner: 'lokasi di atasnya',
      noPlan: 'Tidak ada denah untuk lokasi ini maupun lokasi di atasnya.',
    },
    history: {
      title: 'Riwayat',
      description: 'Kondisi, lokasi, dan status siklus dari waktu ke waktu, terbaru di atas.',
      record: 'Catat perubahan',
      recordTitle: 'Catat perubahan status',
      recordDescription: 'Isian yang dikosongkan akan mengikuti kondisi saat ini.',
      recorded: 'Riwayat berhasil dicatat',
      submit: 'Catat',
      empty: 'Belum ada riwayat',
      emptyDescription:
        'Mencatat kondisi dan lokasi adalah langkah yang menjadikan unit aset mulai digunakan.',
      unchanged: 'Tidak diubah',
      locationHint: 'Kosongkan untuk membiarkan unit tetap di tempatnya.',
      lifecycleHint: 'Hanya perpindahan status yang diizinkan yang dapat dicatat.',
      now: 'sekarang',
    },
    edit: {
      title: 'Ubah unit aset',
      description:
        'Kondisi, lokasi, dan status siklus adalah catatan riwayat dan hanya dapat diubah melalui tab Riwayat.',
      updated: 'Unit aset berhasil diperbarui',
      itemHint: 'Hanya rincian dari kontrak aset ini yang dapat dipilih.',
      noItem: 'Tanpa rincian pengadaan',
    },
    columns: {
      unit: 'Unit aset',
      asset: 'Aset',
      department: 'Bagian',
      location: 'Lokasi',
      lifecycle: 'Status siklus',
      condition: 'Kondisi',
      borrower: 'Peminjam',
      dates: 'Tanggal',
      type: 'Jenis',
    },
    unassignedDepartment: 'Belum ditetapkan',
    noLocation: 'Lokasi belum dicatat',
    list: {
      title: 'Unit aset',
      description: 'Barang fisik yang dilacak satu per satu di balik setiap aset.',
      descriptionPic: 'Unit pada bagian yang saat ini Anda tanggung jawabi.',
      searchPlaceholder: 'Kode inventaris atau deskripsi…',
      empty: 'Unit aset tidak ditemukan',
      emptyDescription: 'Tidak ada yang cocok dengan filter ini.',
      emptyDescriptionPic:
        'Tidak ada yang cocok dengan filter ini. Anda hanya melihat unit pada bagian yang saat ini Anda tanggung jawabi.',
    },
    emptyBorrowings: 'Belum pernah dipinjam',
    emptyTransactions: 'Belum ada transaksi',
  },

  assets: {
    list: {
      title: 'Aset',
      searchPlaceholder: 'Nama atau keterangan…',
      location: 'Lokasi',
      vendor: 'Vendor',
      contract: 'Kontrak',
      condition: 'Kondisi',
      empty: 'Aset tidak ditemukan',
      emptyDescription: 'Tidak ada yang cocok dengan filter ini.',
      filterByClassification: 'Saring menurut klasifikasi',
    },
    detail: {
      information: 'Informasi aset',
      vendor: 'Vendor',
      procurement: 'Pengadaan',
      attributes: 'Nilai atribut',
      attributesDescription: 'Kolom tambahan yang diatur untuk klasifikasi ini.',
      attachments: 'Lampiran',
    },
    form: {
      newTitle: 'Aset baru',
      editTitle: 'Ubah aset',
      newDescription: 'Unit fisik ditambahkan setelah aset dibuat.',
      editDescription: 'Mengubah klasifikasi juga mengubah atribut yang berlaku.',
      create: 'Buat aset',
      section: 'Rincian aset',
      classificationHint: 'Hanya tingkat paling rinci yang dapat dipilih.',
      institutionDefault: 'Ikuti instansi saya',
      vendor: 'Vendor',
      vendorHint: 'Produsen atau merek dari aset ini.',
      noVendor: 'Tanpa vendor',
      contract: 'Kontrak',
      contractHint:
        'Kontrak pengadaan yang menjadi dasar pembelian aset ini. Kosongkan untuk aset hibah, buatan sendiri, atau hasil migrasi.',
      noContract: 'Tanpa catatan pengadaan',
      discardTitle: 'Buang perubahan?',
      discardDescription: 'Perubahan pada aset ini belum disimpan dan akan hilang.',
      discard: 'Buang',
    },
    attributes: {
      yes: 'Ya',
      none: 'Belum ada atribut yang diatur untuk klasifikasi ini.',
      selectionHint: 'Pilihan nilai belum dapat diatur; isian ini disimpan sebagai teks bebas.',
      selectionNote:
        'Satu atau beberapa atribut di sini bertipe pilihan. Belum tersedia tempat untuk menyimpan daftar nilainya, sehingga untuk sementara diisi sebagai teks bebas.',
    },
    label: {
      title: 'Label unit',
      descriptionOne: 'Label siap cetak untuk unit ini. Tempelkan pada barangnya.',
      descriptionMany: 'Label siap cetak untuk semua unit aset ini, tersusun untuk dipotong.',
      print: 'Cetak',
      labelFor: 'Label untuk {{code}}',
      emptyTitle: 'Tidak ada yang dapat dicetak',
      emptyDescription:
        'Belum ada unit di sini yang memiliki nomor inventaris. Nomor dibentuk dari instansi pemilik, jadi tetapkan instansinya pada aset terlebih dahulu.',
      printLabel: 'Cetak label',
      printAllLabels: 'Cetak semua label',
      inventoryCode: 'Nomor inventaris',
      noCode: 'Belum ada',
      noCodeHint: 'Nomor inventaris dibentuk dari instansi pemilik. Aset ini belum memilikinya.',
    },
    scan: {
      title: 'Label yang dipindai',
      description: 'Mencari {{code}}…',
      resolving: 'Mencari kode yang dipindai…',
      notFoundTitle: 'Tidak ada unit untuk kode ini',
      notFoundDescription:
        'Tidak ada yang cocok dengan {{code}} di instansi Anda. Periksa kembali kodenya pada label, atau label tersebut mungkin milik instansi lain.',
      browseAssets: 'Telusuri aset',
      browseUnits: 'Telusuri unit aset',
    },
    units: {
      title: 'Unit aset',
      description: 'Barang fisik yang dicatat satu per satu dan merupakan bagian dari aset ini.',
      add: 'Tambah unit aset',
      addTitle: 'Tambah unit aset',
      addDescription:
        'Unit aset baru berstatus Terdaftar tanpa kondisi maupun lokasi yang tercatat.',
      created: 'Unit aset berhasil dibuat',
      empty: 'Belum ada unit aset',
      emptyDescription: 'Aset tanpa unit berarti barangnya belum diterima.',
      notRecordedCondition: 'Belum dicatat',
      itemHint: 'Rincian kontrak yang menjadi asal unit aset ini.',
      noItem: 'Tanpa rincian pengadaan',
    },
  },

  procurement: {
    list: {
      title: 'Kontrak',
      description: 'Catatan pengadaan yang menjadi asal-usul aset.',
      searchPlaceholder: 'Nomor kontrak…',
      supplier: 'Penyedia',
      type: 'Jenis',
      empty: 'Kontrak tidak ditemukan',
    },
    detail: {
      information: 'Informasi kontrak',
      contractNumber: 'Nomor kontrak',
      supplier: 'Penyedia',
      contractType: 'Jenis kontrak',
      contractDate: 'Tanggal kontrak',
      contractValue: 'Nilai kontrak',
      fundingSource: 'Sumber dana',
      accountCode: 'Kode rekening',
      receivingDocument: 'Dokumen penerimaan',
      receivingDate: 'Tanggal penerimaan',
      assets: 'Aset',
    },
    form: {
      newTitle: 'Kontrak baru',
      editTitle: 'Ubah kontrak',
      newDescription: 'Rincian kontrak ditambahkan setelah kontrak dibuat.',
      editDescription:
        'Rincian kontrak dan aset yang tercatat di dalamnya tidak terpengaruh perubahan ini.',
      create: 'Buat kontrak',
      section: 'Kontrak',
      valueHint: 'Angka, dua digit di belakang koma.',
      institutionHint: 'Instansi penerima. Standarnya instansi Anda sendiri.',
      noSupplier: 'Tanpa penyedia',
      noType: 'Tanpa jenis',
      noFundingSource: 'Tanpa sumber dana',
      noAccountCode: 'Tanpa kode rekening',
      institutionDefault: 'Ikuti instansi saya',
      notReceived: 'Belum diterima',
      createSupplier: 'Tambah penyedia',
      createSupplierDescription:
        'Hanya nama yang wajib diisi; sisanya dapat dilengkapi nanti di halaman penyedia.',
      createContractType: 'Tambah jenis kontrak',
      createFundingSource: 'Tambah sumber dana',
      discardTitle: 'Buang perubahan?',
      discardDescription: 'Perubahan pada kontrak ini belum disimpan dan akan hilang.',
      discard: 'Buang',
    },
    suppliers: {
      title: 'Penyedia',
      description: 'Pihak yang menjadi rekanan dalam kontrak pengadaan.',
      searchPlaceholder: 'Nama…',
      empty: 'Penyedia tidak ditemukan',
      newTitle: 'Penyedia baru',
      contactInformation: 'Informasi kontak',
      address: 'Alamat',
      details: 'Rincian',
      contracts: 'Kontrak',
      contractsDescription: 'Kontrak pengadaan yang dilaksanakan dengan penyedia ini.',
      noContracts: 'Belum ada kontrak',
      noContractsDescription: 'Belum ada pengadaan dari penyedia ini.',
    },
    lineItems: {
      title: 'Rincian kontrak',
      description:
        'Barang yang dibeli dalam kontrak ini. Setiap baris dapat didaftarkan sebagai aset.',
      empty: 'Belum ada rincian',
      emptyDescription: 'Tambahkan barang yang dibeli, lalu daftarkan setiap baris sebagai aset.',
      deleteTitle: 'Hapus rincian ini?',
    },
    items: {
      quantity: 'Jumlah',
      quantityHint: 'Banyaknya barang yang dipesan.',
      quantityOrdered: 'Jumlah dipesan',
      unitOfMeasure: 'Satuan',
      unitOfMeasureHint: 'Satuan yang dihitung untuk jumlah tersebut.',
      unitOfMeasurePlaceholder: 'buah, kotak, set…',
      unitPrice: 'Harga satuan',
      total: 'Jumlah harga',
      item: 'Barang',
      itemName: 'Nama barang',
      specification: 'Spesifikasi',
      addLineItem: 'Tambah rincian',
      editLineItem: 'Ubah rincian',
      lineItemDescription: 'Satu baris rincian pembelian pada kontrak ini.',
      addItem: 'Tambah rincian',
      assetUnits: 'Unit aset',
      assetUnitsDescription:
        'Barang fisik yang dicatat satu per satu dari rincian ini. Masing-masing adalah catatan tersendiri, terpisah dari jumlah yang dipesan di atas.',
      nothingRegistered: 'Belum ada yang dicatat',
      nothingRegisteredDescription: 'Gunakan “Tambah aset” pada baris ini untuk mendaftarkannya.',
    },
    addAsset: {
      title: 'Tambah aset',
      submit: 'Buat aset',
      classificationHint:
        'Rincian kontrak tidak memuat klasifikasi, jadi dipilih di sini. Hanya tingkat paling rinci.',
      vendor: 'Vendor',
      unitCount: 'Unit aset yang didaftarkan',
      unitCountHintOrdered:
        'Dipesan {{quantity}}. Setiap unit yang didaftarkan dicatat satu per satu. Mendaftarkan lebih sedikit adalah hal biasa — penerimaan bertahap memang lazim.',
      unitCountHint: 'Banyaknya barang fisik yang diterima dan dicatat satu per satu.',
    },
  },

  organization: {
    institutions: {
      title: 'Instansi',
      description: 'Unit organisasi yang memiliki aset, kontrak, dan pengguna.',
      new: 'Instansi baru',
      searchPlaceholder: 'Nama atau kode…',
      empty: 'Instansi tidak ditemukan',
      code: 'Kode',
      codeHint: 'Pengenal singkat yang unik, dipakai di seluruh laporan.',
      codeLabel: 'Kode: {{code}}',
      address: 'Alamat',
      details: 'Rincian',
      deactivateTitle: 'Nonaktifkan instansi ini?',
      deactivateDescription:
        'Aset, kontrak, dan pengguna miliknya tetap tersimpan dan tetap merujuk padanya.',
      reactivateTitle: 'Aktifkan kembali instansi ini?',
      reactivateDescription: 'Instansi ini kembali dapat dipilih untuk catatan baru.',
    },
    /** Fase 25 (`CR-006`), REQ-ORG-007. */
    inventoryCodeFormat: {
      tab: 'Kode inventaris',
      title: 'Format kode inventaris',
      description:
        'Cara kode inventaris disusun untuk unit yang didaftarkan di instansi ini mulai sekarang.',
      pageDescription: 'Format kode inventaris unit aset untuk instansi Anda.',
      formatLabel: 'Format',
      addToken: 'Tambah nilai',
      addSeparator: 'Tambah pemisah',
      choose: 'Pilih nilai…',
      moveLeft: 'Pindah ke depan',
      moveRight: 'Pindah ke belakang',
      remove: 'Hapus',
      previewLabel: 'Pratinjau',
      previewNote:
        'Hanya contoh. Tidak ada kode yang dibuat sampai sebuah unit didaftarkan. Batas: {{max}}.',
      requiresValue:
        'Karena format memakai {{tokens}}, setiap unit yang didaftarkan mulai sekarang harus memilikinya — pendaftaran tanpa nilai tersebut ditolak, bukan diberi kode yang tidak lengkap.',
      unresolved:
        'Tidak ada nilai untuk mempratinjau {{tokens}}. Format tetap dapat disimpan, tetapi periksa dengan pendaftaran nyata sebelum mencetak label.',
      cannotRemoveLast:
        '{{token}} adalah satu-satunya pembeda antara satu unit dan unit lainnya. Tambahkan nomor urut atau komposisi nomor terlebih dahulu — format tanpa keduanya akan memberi kode yang sama untuk setiap unit yang didaftarkan.',
      compositionPerUnit:
        'Format ini tidak memakai nomor urut, sehingga komposisi nomor menjadi satu-satunya pembeda antar unit. Nilainya harus diketik untuk setiap unit yang didaftarkan, termasuk setiap unit dalam satu batch pengadaan, dan tidak boleh ada dua unit yang memakai nilai yang sama.',
      sharedNumbering:
        'Format ini tidak memuat kode instansi, sehingga penomorannya dipakai bersama instansi lain yang memakai bentuk yang sama. Kode tetap unik; nomor urut tidak lagi per instansi.',
      futureOnly:
        'Perubahan format hanya berlaku untuk unit yang didaftarkan setelahnya. Kode yang sudah terbit, dan label yang memuatnya, tidak pernah berubah.',
      reset: 'Pakai format bawaan',
      saved: 'Format kode inventaris tersimpan',
      noInstitutionTitle: 'Tidak ada instansi untuk diatur',
      noInstitutionDescription:
        'Akun Anda tidak terikat pada satu instansi. Buka instansi yang dimaksud dari menu Instansi lalu gunakan tab Kode inventaris.',
    },
    departments: {
      title: 'Bagian',
      description: 'Bagian dimiliki oleh instansi. Dua instansi boleh memakai kode yang sama.',
      new: 'Bagian baru',
      empty: 'Bagian tidak ditemukan',
      code: 'Kode',
      codeHint: 'Maksimal 8 karakter. Unik dalam satu instansi.',
      codeLabel: 'Kode: {{code}}',
      institutionReadOnlyHint:
        'Ditetapkan saat bagian dibuat dan tidak diubah lagi: memindahkannya akan mengosongkan bagian pada setiap unit yang ditugaskan padanya.',
      noInstitution: 'Belum ditetapkan pada instansi',
      details: 'Rincian',
      deactivateTitle: 'Nonaktifkan bagian ini?',
      deactivateDescription: 'Unit aset yang sudah ditugaskan padanya tetap seperti semula.',
      reactivateTitle: 'Aktifkan kembali bagian ini?',
      reactivateDescription: 'Bagian ini kembali dapat dipilih untuk penugasan baru.',
    },
    users: {
      title: 'Pengguna',
      description: 'Akun yang dapat masuk, beserta peran yang menentukan apa yang boleh dilakukan.',
      new: 'Pengguna baru',
      newDescription: 'Peran dapat diberikan setelah akun dibuat.',
      searchPlaceholder: 'Nama pengguna atau nama…',
      empty: 'Pengguna tidak ditemukan',
      username: 'Nama pengguna',
      usernameHint: 'Tetap. Nama ini menandai akun pada jejak audit.',
      password: 'Kata sandi',
      passwordHint: 'Minimal 12 karakter.',
      firstName: 'Nama depan',
      lastName: 'Nama belakang',
      contactInfo: 'Informasi kontak',
      institutionHint:
        'Membatasi apa yang dapat dilihat pengguna ini, kecuali salah satu perannya berlaku menyeluruh.',
      noInstitution: 'Tanpa instansi',
      profile: 'Profil',
      roles: 'Peran',
      rolesDescription:
        'Peran membawa izin yang dimiliki akun ini. Menghapus semuanya membuat pengguna tetap dapat masuk tetapi tidak dapat melakukan apa pun.',
      noRoles: 'Belum ada peran',
      noRolesDescription: 'Akun ini belum memiliki izin apa pun.',
      removeRole: 'Hapus {{name}}',
      selectRole: 'Pilih peran…',
      noFurtherRoles: 'Tidak ada peran lain yang tersedia',
      assignRole: 'Berikan peran',
      roleAssigned: 'Peran diberikan',
      roleRemoved: 'Peran dihapus',
      deactivateTitle: 'Nonaktifkan pengguna ini?',
      deactivateDescription:
        'Pengguna langsung dikeluarkan dan tidak dapat masuk lagi sampai diaktifkan kembali.',
      reactivateTitle: 'Aktifkan kembali pengguna ini?',
      reactivateDescription: 'Pengguna dapat masuk lagi dengan kata sandi yang sudah ada.',
    },
    roles: {
      title: 'Peran',
      description:
        'Setiap peran adalah sekumpulan izin bernama. Pengguna memegang peran, bukan izin secara langsung.',
      new: 'Peran baru',
      newDescription: 'Izin diberikan setelah peran dibuat.',
      empty: 'Peran tidak ditemukan',
      scope: 'Cakupan',
      systemWide: 'Menyeluruh',
      institutionScoped: 'Terbatas instansi',
      permissions: 'Izin',
      details: 'Rincian',
      systemWideHint:
        'Melepas batas instansi pada izin peran ini. Diperlukan untuk mengelola instansi, peran, dan izin. Peran ini sendiri tidak memberikan izin apa pun.',
      systemWideEditHint:
        'Melepas batas instansi pada izin peran ini. Mematikannya ditolak selama masih ada izin instansi, peran, atau izin yang diberikan.',
      institutionAssignable: 'Dapat diberikan instansi',
      institutionAssignableHint:
        'Memungkinkan admin instansi memberikan peran ini kepada pengguna di instansinya sendiri.',
      institutionAssignableBlocked:
        'Tidak tersedia selama peran ini menyeluruh. Peran menyeluruh melampaui batas instansi, sehingga tidak pernah bisa diserahkan kepada admin instansi.',
      institutionAssignableWarning:
        'Ini memberikan izin peran tersebut kepada setiap admin instansi. Siapa pun yang membuat akun pengguna juga menetapkan kata sandinya dan dapat masuk sebagai akun itu — jadi peran apa pun yang dapat mereka berikan, dapat mereka ambil untuk diri sendiri. Nyalakan hanya bila Anda bersedia memberikan izin-izin ini langsung kepada setiap admin instansi.',
      /** Tingkat cakupan ketiga — Phase 22 (`CR-003`), REQ-ROLE-011. */
      picScoped: 'Terbatas pada bagiannya sendiri',
      picScopedHint:
        'Pemegang peran ini hanya menjangkau unit aset dari bagian yang saat ini menjadi tanggung jawabnya.',
      picScopedBlocked:
        'Peran menyeluruh sudah menjangkau seluruh instansi, kebalikan dari hanya menjangkau bagian yang menjadi tanggung jawab Anda.',
      picScopedWarning:
        'Ini mempersempit akses, bukan memberikannya, dan hanya berlaku bila SELURUH peran pengguna menyandangnya — siapa pun yang juga memegang peran biasa tetap memiliki akses penuh se-instansi. Unit tanpa bagian sama sekali tidak terjangkau, dan pemegang peran ini tidak dapat memindahkan unit antar bagian.',
      permissionsGranted: '{{granted}} dari {{total}} izin diberikan.',
      savePermissions: 'Simpan izin',
      permissionsUpdated: 'Izin diperbarui',
      delete: 'Hapus peran',
      deleteTitle: 'Hapus peran ini?',
      deleteDescription:
        'Tindakan ini tidak dapat dibatalkan. Penghapusan ditolak jika masih ada pengguna yang memegang peran ini.',
    },
    permissions: {
      none: 'Tidak ada izin yang tersedia.',
      selectAll: 'Pilih semua',
      selectAllIn: 'Pilih semua izin {{group}}',
      requiresSystemWide: 'Memerlukan peran menyeluruh',
      notEffectiveForPic: 'Tidak berlaku untuk peran lingkup PIC',
    },
  },

  reference: {
    classifications: {
      title: 'Klasifikasi',
      description:
        'Hierarki acuan yang dipakai untuk mengklasifikasikan setiap aset dan lokasi. Rincian dari pemerintah bersifat tetap; instansi Anda dapat menambah sendiri pada tingkat paling rinci.',
      browse: 'Telusuri klasifikasi',
      emptyTitle: 'Belum ada klasifikasi dipilih',
      emptyDescription:
        'Telusuri atau cari hierarkinya untuk melihat sebuah klasifikasi beserta atribut yang disiapkan untuknya.',
      code: 'Kode',
      parent: 'Induk',
      rootLevel: 'Tingkat teratas',
      origin: 'Sumber',
      category: 'Kategori',
      originValue: {
        1: 'Data referensi pemerintah',
        2: 'Warisan dari sistem sebelumnya',
        3: 'Ditambahkan di aplikasi ini',
      },
      manage: {
        localBadge: 'Tambahan lokal',
        global: 'Semua instansi',
        ownedByInstitution: 'Satu instansi',
        add: 'Tambah rincian',
        addTitle: 'Tambah klasifikasi',
        addDescription:
          'Rincian baru berada di bawah "{{parent}}" sebagai klasifikasi paling rinci. Kodenya diberikan otomatis.',
        addHint:
          'Rincian hanya dapat ditambahkan pada tingkat paling rinci. Telusuri terus hingga daftarnya menampilkan barang satu per satu.',
        renameTitle: 'Ubah nama klasifikasi',
        renameDescription:
          'Hanya namanya yang berubah. Kodenya tetap, sehingga aset dan lokasi yang sudah memakainya tidak terpengaruh.',
        nameLabel: 'Nama',
        ownerLabel: 'Tersedia untuk',
        ownerGlobal: 'Semua instansi',
        ownerMine: 'Hanya instansi saya',
        ownerHint:
          'Rincian milik satu instansi tidak terlihat oleh instansi lain. Nanti dapat dibagikan ke semua, tetapi tidak dapat dibatalkan.',
        promote: 'Bagikan ke semua',
        promoteTitle: 'Bagikan ke semua instansi?',
        promoteDescription:
          '"{{name}}" akan tersedia untuk semua instansi. Tindakan ini tidak dapat dibatalkan karena instansi lain dapat mulai memakainya.',
        deleteTitle: 'Hapus klasifikasi ini?',
        deleteDescription:
          '"{{name}}" dihapus permanen. Ini hanya bisa dilakukan selama belum ada yang memakainya.',
        created: 'Klasifikasi ditambahkan',
        renamed: 'Nama klasifikasi diubah',
        deleted: 'Klasifikasi dihapus',
        promoted: 'Klasifikasi dibagikan ke semua instansi',
      },
      attributes: {
        title: 'Definisi atribut',
        description: 'Kolom tambahan yang disiapkan untuk klasifikasi ini.',
        empty: 'Belum ada atribut',
        emptyDescription: 'Aset dengan klasifikasi ini tidak memiliki atribut tambahan.',
        required: 'Wajib',
      },
    },
    picker: {
      title: 'Pilih klasifikasi',
      description:
        'Cari klasifikasi tertentu, atau persempit satu tingkat demi satu tingkat. Hanya tingkat paling rinci yang dapat dipilih.',
      placeholder: 'Pilih klasifikasi…',
      searchLabel: 'Cari klasifikasi',
      searchPlaceholder: 'Cari klasifikasi…',
      clearSearch: 'Hapus pencarian',
      trail: 'Jalur klasifikasi',
      top: 'Semua',
      select: 'Pilih',
      loading: 'Memuat klasifikasi…',
      noMatches: 'Tidak ada klasifikasi yang cocok',
      noMatchesHint: 'Coba kata lain, atau telusuri dengan mempersempit tingkat.',
      nothingHere: 'Tidak ada apa pun di tingkat ini',
      useThis: 'Buka "{{name}}"',
      local: 'Lokal',
    },
    attributeDefinitions: {
      title: 'Definisi atribut',
      description:
        'Kolom tambahan yang disiapkan per klasifikasi, untuk aset atau untuk unit tersendiri.',
      new: 'Definisi baru',
      empty: 'Belum ada definisi atribut',
      emptyDescription:
        'Aset hanya memakai kolom bawaannya sampai sebuah definisi disiapkan di sini.',
      yes: 'Ya',
      no: 'Tidak',
      filters: {
        classification: 'Klasifikasi',
        anyClassification: 'Semua klasifikasi',
        clearClassification: 'Hapus filter klasifikasi',
        scope: 'Cakupan',
      },
      columns: {
        classification: 'Klasifikasi',
        editTitle: 'Ubah definisi atribut',
        editDescription: 'Klasifikasi dan cakupan bersifat tetap. Selebihnya dapat diubah.',
        fixedHint: 'Ditetapkan saat definisi dibuat.',
        type: 'Tipe',
        scope: 'Cakupan',
        required: 'Wajib',
      },
      form: {
        title: 'Definisi atribut baru',
        description:
          'Klasifikasi dan cakupan bersifat tetap setelah ada nilai yang tercatat untuk definisi ini.',
        type: 'Tipe',
        scope: 'Cakupan',
        required: 'Wajib diisi',
        selectionNote:
          'Daftar nilai yang diperbolehkan belum dapat diatur. Belum ada tempat untuk menyimpannya, jadi untuk sementara nilai atribut ini diperiksa sebagai teks bebas.',
        usesUnit: 'Memiliki satuan ukur',
        measurementUnit: 'Satuan ukur',
        noUnit: 'Tanpa satuan',
        createUnit: 'Buat satuan ukur',
        createUnitDescription:
          'Hanya nama yang diperlukan. Satuan itu langsung tersedia untuk setiap atribut yang memakai ukuran.',
      },
      deactivate: {
        title: 'Nonaktifkan definisi ini?',
        description:
          'Nilai yang sudah tercatat tetap tersimpan; definisi ini berhenti ditawarkan pada catatan baru.',
        reactivateTitle: 'Aktifkan kembali definisi ini?',
        reactivateDescription: 'Definisi ini kembali tersedia pada formulir klasifikasinya.',
      },
    },
    lookups: {
      title: 'Data acuan',
      description: 'Daftar ringkas yang dipakai pada kontrak, transaksi, dan atribut.',
      id: 'ID',
      code: 'Kode',
      codeHint: 'Maksimal 12 karakter. Tetap setelah dibuat.',
      businessCodeHint:
        'Singkatan yang benar-benar dipakai instansi Anda — "Dana Bos" disebut BOS. Tidak diturunkan dari namanya. Maksimal 8 karakter, dan dapat menjadi bagian dari kode inventaris, jadi gunakan huruf, angka, tanda hubung, garis bawah, atau titik.',
      codeMissing: 'Belum ada kode',
      new: 'Tambah {{name}}',
      edit: 'Ubah {{name}}',
      empty: 'Belum ada {{name}}',
      emptyDescription: 'Belum ada isian pada daftar ini.',
      deleteTitle: 'Hapus {{name}} ini?',
      deleteDescription:
        'Tindakan ini tidak dapat dibatalkan. Penghapusan ditolak jika masih ada catatan yang memakainya.',
      categories: {
        tab: 'Kategori',
        note: 'Kategori adalah data acuan yang dikelola di luar aplikasi ini dan tidak dapat diubah di sini.',
        empty: 'Belum ada kategori',
      },
      types: {
        'measurement-units': {
          tab: 'Satuan ukur',
          singular: 'satuan ukur',
          plural: 'satuan ukur',
        },
        'contract-types': {
          tab: 'Jenis kontrak',
          singular: 'jenis kontrak',
          plural: 'jenis kontrak',
        },
        'funding-sources': {
          tab: 'Sumber dana',
          singular: 'sumber dana',
          plural: 'sumber dana',
        },
        'transaction-types': {
          tab: 'Jenis transaksi',
          singular: 'jenis transaksi',
          plural: 'jenis transaksi',
        },
        'account-codes': {
          tab: 'Kode rekening',
          singular: 'kode rekening',
          plural: 'kode rekening',
        },
      },
    },
  },

  dashboard: {
    title: 'Dasbor',
    description: 'Ringkasan registri, dalam cakupan organisasi Anda.',
    assets: 'Aset',
    activeCount: '{{n}} aktif',
    assetUnits: 'Unit aset',
    loansOut: 'Sedang dipinjam',
    pastDue: 'Lewat tenggat',
    pastDueHint: 'Masih memegang unit melewati rencana pengembalian',
    byLifecycle: 'Unit menurut status siklus',
    byCondition: 'Unit menurut kondisi',
    byClassification: 'Aset menurut klasifikasi',
    byClassificationHint:
      '{{n}} klasifikasi dengan aset terbanyak. Laporan lengkap memuat seluruhnya.',
    fullReport: 'Laporan lengkap',

    descriptionScoped: 'Ringkasan jurusan yang menjadi tanggung jawab Anda.',
    noCards: 'Tidak ada yang dapat ditampilkan untuk hak akses Anda.',

    assessment: {
      month: 'Bulan',
      coverageTitle: 'Cakupan penilaian bulanan',
      coverageHint:
        'Unit aset yang memiliki setidaknya satu penilaian dari jurusan pada bulan ini.',
      coverage: 'Cakupan',
      responsible: 'Penanggung jawab',
      unassessed: 'Belum dinilai',
      lastActivity: 'Aktivitas terakhir',
      unassignedPic: 'Belum ditetapkan',
      noResponsibleUser: 'Tanpa penanggung jawab',
      noUnits: 'Tidak ada unit',
      noDepartments: 'Tidak ada jurusan untuk dilaporkan.',
      byOthersHint:
        '{{n}} unit lain dinilai oleh selain penanggung jawab jurusan, sehingga tidak dihitung dalam cakupan.',

      activityTitle: 'Aktivitas penilaian',
      activityHint: '{{n}} unit tercakup bulan ini. Entri dan unit adalah hitungan yang berbeda.',
      entries: 'Entri',
      uniqueUnits: 'Unit',
      notDepartmentPic: 'bukan penanggung jawab jurusan',
      noActivity: 'Belum ada penilaian pada bulan ini.',

      unassignedTitle: 'Unit tanpa jurusan',
      unassignedHint:
        'Tidak ada yang bertanggung jawab atas unit ini, sehingga penilaian tidak dapat diharapkan. Tetapkan ke sebuah jurusan.',
      unassignedLooked: '{{n}} di antaranya telah dinilai oleh seseorang.',
      assignDepartment: 'Tinjau unit',
    },

    locationCondition: {
      title: 'Unit menurut lokasi dan kondisi',
      hint: 'Di mana unit berada, dan dalam keadaan apa.',
      scopeLabel: 'Tampilkan',
      scopeDirect: 'Di setiap lokasi',
      scopeAll: 'Termasuk seluruh isinya',
      totals: '{{units}} unit di {{locations}} lokasi; {{unlocated}} tanpa lokasi.',
    },
  },

  reports: {
    title: 'Laporan',
    description:
      'Tampilan hanya-baca atas registri. Setiap laporan mengikuti cakupan organisasi Anda.',
    notFound: 'Laporan tidak ditemukan',
    noReport: 'Tidak ada laporan bernama “{{slug}}”',
    noReportHint: 'Mungkin namanya telah diubah.',
    back: 'Kembali ke laporan',
    export: 'Ekspor CSV',
    exportNote: 'Ekspor memuat baris yang tampil di atas.',
    exportNotePaged: 'Ekspor memuat baris yang tampil di atas pada halaman ini.',
    exportWorkbook: 'Ekspor lembar kerja',
    exportNoteWhole:
      'Ekspor memuat seluruh baris yang sesuai dengan filter ini, bukan hanya halaman ini, sebagai lembar kerja beserta foto.',
    totals: 'Total',
    breakdown: 'Rincian',
    chartEmpty: 'Belum ada yang dapat digambarkan.',
    empty: 'Tidak ada yang dilaporkan',
    emptyDescription: 'Tidak ada data yang cocok dengan tampilan ini.',
    anyClassification: 'Semua klasifikasi',
    clearClassification: 'Kosongkan klasifikasi',
    filterByClassification: 'Saring menurut klasifikasi',
    overdue: 'Terlambat',
    pastDueOnly: 'Hanya yang lewat tenggat',
    procurement: 'Pengadaan',
    tracedToContract: 'Tertelusur ke kontrak',
    anyStartDate: 'Tanpa tanggal awal',
    anyEndDate: 'Tanpa tanggal akhir',
    clearStartDate: 'Kosongkan tanggal awal',
    clearEndDate: 'Kosongkan tanggal akhir',
    items: {
      inventory: {
        title: 'Inventaris',
        description: 'Setiap aset beserta jumlah unit fisik yang terdaftar padanya.',
        searchPlaceholder: 'Nama atau keterangan…',
      },
      inventoryUnits: {
        title: 'Inventaris (per unit)',
        description:
          'Setiap barang fisik satuan, satu baris masing-masing. Ekspor menghasilkan lembar RPS lengkap, beserta foto bila unit atau asetnya memilikinya.',
        searchPlaceholder: 'Kode inventaris atau deskripsi…',
      },
      status: {
        title: 'Status',
        description: 'Unit aset menurut status siklus, beserta pembagian aset aktif/nonaktif.',
      },
      byClassification: {
        title: 'Menurut klasifikasi',
        description: 'Aset dikelompokkan menurut klasifikasi tempatnya terdaftar.',
      },
      byOrganization: {
        title: 'Menurut organisasi',
        description: 'Unit aset menurut instansi dan bagian yang bertanggung jawab atasnya.',
      },
      byLocation: {
        title: 'Menurut lokasi',
        description:
          'Unit aset menurut keberadaannya saat ini, termasuk yang belum tercatat lokasinya.',
      },
      byLocationCondition: {
        title: 'Menurut lokasi dan kondisi',
        description:
          'Di mana unit aset berada, disilangkan dengan keadaannya. Kedua sumbu sekaligus.',
      },
      assessmentCoverage: {
        title: 'Cakupan penilaian bulanan',
        description:
          'Jurusan mana yang telah menilai unit asetnya bulan ini, dan unit mana yang belum.',
      },
      assessmentActivity: {
        title: 'Aktivitas penilaian',
        description: 'Siapa yang mencatat penilaian dalam sebulan. Entri dan unit dihitung terpisah.',
      },
      byCondition: {
        title: 'Menurut kondisi',
        description: 'Unit aset menurut kondisi yang tercatat.',
      },
      borrowings: {
        title: 'Peminjaman',
        description: 'Peminjaman berjalan dan riwayatnya, dengan penanda yang terlambat.',
      },
      procurementTraceability: {
        title: 'Ketertelusuran pengadaan',
        description:
          'Aset mana yang tertelusur ke kontrak, dan berapa unitnya yang membawa rincian kontrak.',
      },
    },
    columns: {
      asset: 'Aset',
      assetUnits: 'Unit aset',
      tracedUnits: 'Unit tertelusur',
      classification: 'Klasifikasi',
      institution: 'Instansi',
      department: 'Bagian',
      location: 'Lokasi',
      condition: 'Kondisi',
      lifecycleState: 'Status siklus',
      inventoryCode: 'Kode inventaris',
      count: 'Jumlah',
      borrower: 'Peminjam',
      contact: 'Kontak',
      borrowed: 'Dipinjam',
      due: 'Jatuh tempo',
      returned: 'Dikembalikan',
      contract: 'Kontrak',
      supplier: 'Penyedia',
      contractDate: 'Tanggal kontrak',
    },
    totalLabels: {
      assets: 'Aset',
      activeAssets: 'Aset aktif',
      inactiveAssets: 'Aset nonaktif',
      units: 'Unit',
      classifications: 'Klasifikasi terpakai',
      institutions: 'Instansi',
      locations: 'Lokasi terpakai',
      unlocated: 'Tanpa lokasi',
      unrecorded: 'Kondisi belum tercatat',
    },
    values: {
      unassigned: 'Belum ditentukan',
      noLocation: 'Lokasi belum tercatat',
      notRecorded: 'Belum tercatat',
      pastDue: 'Lewat tenggat',
      noProcurement: 'Tidak ada catatan pengadaan',
    },
  },

  notFound: {
    title: 'Halaman tidak ditemukan',
    description: 'Alamat itu tidak cocok dengan halaman mana pun di aplikasi ini.',
    back: 'Kembali ke dasbor',
    reload: 'Muat ulang halaman',
  },
};
