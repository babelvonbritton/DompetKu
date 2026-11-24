# DompetKu 0.2.1

Pelacak anggaran lewat chat. Mobile-first PWA, bahasa Indonesia penuh.
Semua data tersimpan di perangkat (IndexedDB) — tidak ada akun, tidak ada
server.

## v0.2.1

- **Setup cepat**: satu dompet + anggaran bulanan dulu, API key nanti.
- **Beranda (dashboard)**: sisa bulan ini, keluar hari ini, strip
  peringatan, kartu dompet, aktivitas terakhir.
- **Chat**: catat pengeluaran dengan kalimat biasa — "Makan siang 45rb" —
  atau tanya "Berapa pengeluaranku hari ini?" dan "Berapa sisa anggaranku?".
  Aturan lokal di perangkat yang memahami dulu; Gemini (API key sendiri,
  Flash-Lite) hanya dipanggil saat aturan lokal tidak paham; perintah
  berawalan `/` (mis. `/catat 50rb`, `/sisa`) sebagai cadangan. Kalau ada
  lebih dari satu dompet dan kamu tidak menyebut dompetnya, DompetKu bertanya
  dulu masuk ke dompet mana. Balasan muncul setelah jeda mengetik yang
  menyesuaikan panjang jawaban.
- **Dompet**: banyak dompet, masing-masing dengan anggaran bulanan,
  tanggal mulai siklus (1–28, mis. 25 untuk gajian tanggal 25) dan persen
  peringatan. Aplikasi mengingatkan kalau ada dompet yang belum punya
  anggaran.
- **Riwayat**: pengeluaran per hari, saring per dompet, hapus dengan
  konfirmasi dua ketuk.
- **Pengaturan**: API key Gemini + panduan mendapatkan kunci gratis,
  pilihan tab awal (Beranda atau Chat), cadangan terenkripsi dan pemulihan
  (file atau Google Drive), kebijakan privasi.
- **Cadangan**: arsip ZIP terkompresi (deflate) berisi data NDJSON
  (dompet, transaksi, kategori, pengaturan), dienkripsi AES-GCM dengan kata
  sandi. File cadangan versi lama (.json) masih bisa dipulihkan.
- **Google Drive**: sekali ketuk Hubungkan lalu pilih akun Google
  (single sign-on dengan Client ID bersama bawaan aplikasi), cadangkan ke
  folder aplikasi Drive, dan pulihkan dari sana. Cadangan di Drive memakai
  format yang sama dan kata sandi yang sama. Siapa pun tetap bisa memakai
  Client ID sendiri dari Pengaturan kalau mau.
- **PWA**: bisa dipasang di layar utama, bekerja offline.
- **Struktur data**: setiap tabel punya kelas store sendiri (WalletStore,
  TransactionStore, CategoryStore, SettingsStore, ChatMessageStore) dengan
  query berindeks — dompet dicari lewat indeks nama, pengeluaran per siklus
  lewat indeks gabungan dompet + tanggal.

## Cara test dan build

```bash
npm install
npm run dev        # pengembangan
npm test           # 61 unit test (vitest)
npm run build      # typecheck + build produksi ke dist/
npm run preview    # sajikan dist/ di http://localhost:4173
npm run gen-icons  # hasilkan ulang ikon PWA di public/icons/
```

## Google Drive SSO

Tombol Hubungkan di Pengaturan memakai satu Client ID bersama yang dikemas
di aplikasi (`DEFAULT_DRIVE_CLIENT_ID` di `src/lib/drive.ts`), jadi pengguna
tinggal masuk dengan akun Google masing-masing. Client ID ini disiapkan
sekali oleh pemilik aplikasi:

1. Di [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   buat proyek, aktifkan Google Drive API.
2. Di layar persetujuan OAuth, pilih tipe External dan isi data aplikasi
   (nama DompetKu).
3. Buat kredensial OAuth Client ID tipe Web application, dan daftarkan alamat
   situs sebagai Authorized JavaScript origin (tambah `http://localhost:5173`
   dan `http://localhost:4173` untuk pengembangan).
4. Salin Client ID-nya ke `DEFAULT_DRIVE_CLIENT_ID` di `src/lib/drive.ts`,
   lalu bangun ulang.
5. **Penting:** di layar persetujuan, ubah status publikasi dari Testing ke
   In production. Selama masih Testing, izin masuk pengguna kedaluwarsa
   setelah 7 hari dan aplikasi akan meminta hubungkan ulang tiap minggu.
   Scope yang dipakai hanya `drive.appdata` (non-sensitive), jadi pindah ke
   Production butuh proses verifikasi Google konsol, meminta
   tiga link dulu, jadi **terbitkan aplikasinya dulu**, lalu isi:
   - Beranda: alamat situs (mis. `https://dompetku.example/`)
   - Kebijakan privasi: `https://dompetku.example/privacy.html`
   - Syarat layanan: `https://dompetku.example/terms.html`

   Kedua halaman itu sudah ada di proyek ini (`public/privacy.html` dan
   `public/terms.html`, ikut build ke `dist/`), jadi setelah deploy
   tinggal menempelkan alamatnya. Jangan lupa daftarkan alamat situs yang
   sudah diterbitkan sebagai Authorized JavaScript origin juga — kalau
   hanya localhost yang terdaftar, tombol Hubungkan di situs live akan
   ditolak Google.

## Catatan keamanan dependensi

`npm audit` mungkin melaporkan beberapa kerentanan — semuanya ada di
perkakas pengembangan (Vite, Workbox, dan kawan-kawan). Situs yang
diterbitkan hanya berisi file statis, jadi kerentanan itu tidak sampai ke
pengguna. **Jangan jalankan `npm audit fix`**: ia mencoba menurunkan
vite-plugin-pwa ke 1.1.0, yang tidak cocok dengan Vite 8 (peer-nya berhenti
di Vite 7), dan gagal dengan ERESOLVE. Kalau ada pembaruan keamanan yang
perlu dipasang, perbarui paketnya satu per satu.

Smoke test browser asli (Playwright dari tree Brewfolio):

```bash
node scripts/smoke.mjs   # butuh vite preview berjalan di :4173
```

## Deploy (GitHub Pages)

1. Buat repo baru (mis. `dompetku`), push isi folder ini ke
   branch `main`.
2. Di repo: Settings → Pages → Build and deployment → **GitHub Actions**.
3. Workflow `.github/workflows/deploy-pages.yml` sudah ada — setiap push ke
   `main` membangun dan menerbitkan `dist/`.
4. Subdomain (opsional, seperti proyek lainnya): tambah CNAME
   `<subdomain-pilihanmu>` → `<username-github>.github.io` dan isi
   `public/CNAME` dengan nama subdomain itu. File `public/CNAME` adalah
   satu-satunya tempat nama domain ditulis.
5. Kalau deploy ke path proyek (`user.github.io/dompetku`) dan bukan domain
   sendiri, ubah `base` di `vite.config.ts` menjadi `'/dompetku/'`.

## Privasi

- Data hanya di perangkat. Pesan chat dikirim ke Google hanya saat rules yang diterapkan tidak dapat memahami konteks, paling banyak dua balasan terakhir sebagai konteks.
- Free tier Google bisa memakai pesan yang dikirim untuk meningkatkan layanan. Jadi, jangan tulis nomor rekening atau kata sandi di chat.
- API key tidak ikut dicadangkan. Kata sandi cadangan tidak tersimpan di mana pun; jika hilang, cadangan tidak bisa dibuka.