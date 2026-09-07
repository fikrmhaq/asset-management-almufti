# Lembar Serah Terima — Sistem Manajemen Aset

Untuk pengelola server institusi. Berisi seluruh kebutuhan sistem, apa saja yang
terbuka ke jaringan, dan data yang kami perlukan dari Anda sebelum instalasi.

Panduan instalasinya sendiri ada pada `README.md`.

---

## 1. Tentang sistem ini

Aplikasi web untuk manajemen aset institusi, berjalan sepenuhnya pada satu
server di jaringan Anda. Terdiri dari empat container:

| Container | Image | Peran |
| --- | --- | --- |
| `api` | `asset-management/api` | Express API dan worker penjadwalan, dalam satu proses Node |
| `web` | `asset-management/web` | Nginx yang melayani aplikasi React hasil build |
| `postgres` | `postgres:16-alpine` | Basis data |
| `redis` | `redis:7-alpine` | Sesi login dan antrean pekerjaan |

**Tidak ada ketergantungan eksternal saat sistem berjalan.** Tanpa SMTP, tanpa
LDAP atau Active Directory, tanpa penyimpanan cloud, tanpa API pihak ketiga,
tanpa CDN maupun web font. Setelah image dimuat, server tidak memerlukan
koneksi internet untuk menjalankan sistem.

---

## 2. Kebutuhan server

| | |
| --- | --- |
| Sistem operasi | Linux dengan Docker Engine 24+ dan Compose v2 (diasumsikan Ubuntu 22.04 / 24.04 LTS) |
| Paket pada host | `docker`, `docker compose`, `nginx`, `cron`, `openssl`, `rsync` |
| Tidak perlu pada host | Node.js, PostgreSQL, Redis — seluruhnya berjalan di dalam container |
| CPU / RAM | 2 vCPU, 4 GB (untuk 15–50 pengguna) |
| Disk | 40 GB sebagai awal; pertumbuhan ditentukan oleh berkas lampiran |
| Waktu | NTP ke sumber mana pun yang dapat dijangkau |

---

## 3. Akses jaringan

Hanya port **80** dan **443** yang dapat diakses dari jaringan. Port 80 ada
semata-mata untuk mengalihkan ke 443.

- Container web hanya dipublikasikan ke `127.0.0.1`; Nginx di depannya adalah
  satu-satunya pintu masuk.
- **PostgreSQL (5432) dan Redis (6379) tidak dipublikasikan sama sekali** —
  keduanya hanya dapat dijangkau dari jaringan internal Docker. Ini ketentuan
  desain keamanan sistem, bukan pengaturan bawaan yang dapat kami longgarkan.
  Bila Anda memerlukan akses basis data untuk kebutuhan tooling atau pelaporan,
  jalurnya adalah SSH tunnel dari komputer administrator, bukan membuka port.

Koneksi keluar tidak diperlukan. Bila kebijakan Anda memblokir seluruh koneksi
keluar, hal itu bukan masalah — image container kami serahkan sebagai berkas,
bukan diunduh dari registry.

---

## 4. HTTPS wajib, termasuk di jaringan lokal

Bagian ini layak dibaca dua kali.

Cookie sesi aplikasi ditandai `Secure`, sehingga browser menolak menyimpannya
melalui HTTP biasa. Bila dilayani melalui HTTP, sistem gagal dengan gejala yang
tampak seperti bug alih-alih masalah konfigurasi: **pengguna berhasil masuk,
lalu dikembalikan ke halaman login setiap kali menyegarkan halaman.**

Anda **tidak** memerlukan domain publik maupun otoritas sertifikat publik. Salah
satu dari dua cara berikut sudah memadai:

1. **CA internal institusi**, bila Anda memilikinya (misalnya AD Certificate
   Services). Ini pilihan yang kami sarankan — komputer klien sudah
   memercayainya, sehingga tidak muncul peringatan browser dan tidak ada yang
   perlu dipasang.
2. **Sertifikat self-signed**, yang dibuat oleh skrip `scripts/make-cert.sh`
   dalam hitungan detik. Sertifikat mencakup hostname sekaligus alamat IP.
   Sesudahnya, sertifikat sebaiknya dipasang ke Trusted Root store pada
   komputer klien, idealnya melalui GPO.

Tanpa langkah pemasangan tersebut sistem tetap berjalan dengan benar — pengguna
cukup menutup peringatan sertifikat satu kali per browser — namun kami lebih
memilih tidak membiasakan staf mengabaikan peringatan semacam itu.

---

## 5. Data yang bertahan dan wajib dicadangkan

Ada tiga. Selebihnya, isi container bersifat sementara dan dibangun ulang pada
setiap penerapan ulang.

| Data | Lokasi | Bila hilang |
| --- | --- | --- |
| Basis data | Docker volume `postgres-data` | Seluruh data |
| Sesi login | Docker volume `redis-data` | Semua pengguna keluar; tidak ada data yang hilang |
| Lampiran | Direktori host, bind-mount (mis. `/srv/asset-management/storage`) | Seluruh dokumen yang pernah diunggah |

Tugas cron harian pukul 02.00 membuat dump basis data dan mengarsipkan lampiran,
dengan retensi 14 salinan harian dan 4 salinan mingguan.

**Basis data, cadangannya, dan lampiran berada pada disk yang sama.** Satu
kegagalan disk menghancurkan ketiganya pada saat yang bersamaan, sehingga
salinan harian wajib ditulis ke tempat lain — disk kedua, mount NAS, atau mesin
lain melalui rsync. Mohon tentukan tujuan penyimpanannya.

---

## 6. Data yang kami perlukan dari Anda

| No. | Keterangan | Nilai |
| --- | --- | --- |
| 1 | Hostname untuk aplikasi (mis. `assets.example.local`) | |
| 2 | Dapatkah DNS internal memuat catatan tersebut? Bila tidak, kami sebarkan entri `hosts` | |
| 3 | Alamat IP server (statis atau reservasi DHCP) | |
| 4 | Apakah port 80 dan 443 tersedia pada host ini? | |
| 5 | Apakah institusi memiliki CA internal, atau kami buatkan self-signed? | |
| 6 | Bagaimana sertifikat didistribusikan ke komputer klien (GPO / manual)? | |
| 7 | Direktori penyimpanan lampiran | |
| 8 | Direktori penyimpanan cadangan | |
| 9 | Tujuan salinan cadangan di luar server (path NAS atau tujuan rsync) | |
| 10 | Siapa yang memegang kata sandi basis data dan kunci penanda tangan token? | |
| 11 | Siapa yang akan hadir pada langkah pembuatan pengguna pertama? | |
| 12 | Bagaimana image container dikirim ke server (USB / scp / berbagi berkas)? | |
| 13 | Apakah ada sumber NTP yang dapat dijangkau dari host ini? | |

---

## 7. Catatan operasional

**Instalasi memakan waktu sekitar 30 menit**, di luar distribusi sertifikat ke
komputer klien. Satu langkah — pembuatan akun administrator pertama — bersifat
interaktif dan memerlukan seseorang di depan terminal; kata sandi diketik pada
prompt dan tidak pernah dilewatkan sebagai argumen perintah maupun variabel
lingkungan.

**Endpoint health:** `https://<host>/api/health`. Tanpa autentikasi, melaporkan
status basis data dan Redis secara terpisah. Arahkan sistem pemantauan yang
sudah Anda miliki ke alamat ini.

**Log:** `docker compose logs api`, berformat JSON terstruktur. Riwayat audit
aplikasi terpisah dari ini, tersimpan di basis data dan dapat dilihat melalui
antarmuka aplikasi.

**Restart** aman dilakukan kapan saja; container diatur untuk hidup kembali
secara otomatis bersama host.

**Pembaruan** dikirim berupa berkas image baru disertai satu langkah migrasi
basis data. Perintah persisnya kami sertakan pada setiap rilis.

---

## 8. Keterbatasan yang perlu diketahui sejak awal

Bukan cacat, melainkan keputusan yang tercatat dalam desain sistem — tetapi
masing-masing berdampak operasional bagi Anda atau helpdesk:

- **Tidak ada reset kata sandi maupun penggantian kata sandi mandiri.** Pengguna
  yang lupa kata sandinya memerlukan administrator untuk menetapkan yang baru.
  Bila helpdesk Anda mengharapkan reset mandiri, sampaikan kepada kami sekarang.
- **Visibilitas log audit bersifat menyeluruh** bagi siapa pun yang diberi izin
  baca audit — tidak dibatasi per institusi. Berikan izin ini secara sadar.
- **Ekspor laporan berupa CSV di sisi klien**, berisi baris yang sedang tampil
  di layar, bukan ekspor seluruh hasil dari sisi server.
- **Lampiran dibatasi 10 MB** per berkas, dengan tipe terbatas pada PDF, JPG,
  PNG, DOCX, dan XLSX. Keduanya dapat dikonfigurasi; menaikkan batas ukuran juga
  menuntut perubahan pada Nginx, yang akan kami kerjakan bersama Anda.

---

## 9. Yang belum dapat kami uji

Aplikasi, container, migrasi basis data, dan pengisian data referensi seluruhnya
telah diuji. **Instalasi on-premises itu sendiri belum** — tidak ada server,
hostname, maupun sertifikat di lingkungan pengembangan kami, sehingga
konfigurasi Nginx dan skrip pembuatan sertifikat disusun berdasarkan
spesifikasi lalu ditinjau, bukan dijalankan dari ujung ke ujung.

Kami memperkirakan instalasi pertama memerlukan satu atau dua penyesuaian, dan
panduan instalasi memuat langkah verifikasi khusus untuk menangkapnya sebelum
pengguna diberi akses.
