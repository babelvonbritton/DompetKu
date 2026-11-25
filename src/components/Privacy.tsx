// DompetKu v1.0.2 — privacy policy page, in plain Indonesian.

export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen-scroll">
      <header className="page-head">
        <button type="button" className="text-button" onClick={onBack}>
          ‹ Kembali
        </button>
        <h1>Kebijakan Privasi</h1>
        <p>Terakhir diperbarui: 24 November 2026.</p>
      </header>

      <section className="policy">
        <h2>Data tersimpan di perangkatmu</h2>
        <p>
          DompetKu menyimpan dompet, anggaran, pengeluaran, kategori, dan
          riwayat chat di perangkatmu sendiri (penyimpanan lokal peramban).
          Tidak ada akun, tidak ada server DompetKu, dan tidak ada data yang
          kami kumpulkan.
        </p>

        <h2>Apa yang dikirim ke Google</h2>
        <p>
          Hanya kalau kamu memasang kunci API Gemini sendiri. Kalau kunci
          terpasang, setiap pesan chat dikirim ke Gemini untuk dipahami —
          pesan itu dan paling banyak satu balasan terakhir sebagai konteks,
          ditambah nama dompet dan kategorimu supaya Gemini bisa
          membedakannya. Bukan seluruh riwayat chat, bukan daftar
          transaksimu, bukan jumlah anggaranmu.
        </p>
        <p>
          Koneksi ke Gemini selalu terenkripsi (HTTPS), dan kunci API dikirim
          sebagai header permintaan — bukan di alamat, jadi kunci tidak
          tercatat di riwayat peramban atau di log. Aplikasi ini juga
          membatasi sendiri dengan siapa ia boleh berbicara: hanya ke Gemini
          dan ke Google Drive untuk cadangan, tidak ke situs lain. Font
          aplikasi tersimpan di aplikasi sendiri, jadi membuka aplikasi tidak
          mengirim permintaan apa pun ke pihak ketiga.
        </p>
        <p>
          Pada paket gratis Google, pesan yang dikirim bisa dipakai Google
          untuk meningkatkan layanannya. Karena itu, jangan menulis nomor
          rekening, kata sandi, atau data sensitif lainnya di chat ini. Chat
          ini hanya butuh jumlah, dompet, dan kategori.
        </p>

        <h2>Kunci API</h2>
        <p>
          Kunci API Gemini yang kamu tempel hanya tersimpan di perangkat ini.
          Kunci tidak ikut dicadangkan saat kamu mengunduh cadangan — kamu
          perlu mengaturnya lagi setelah memulihkan cadangan.
        </p>

        <h2>Cadangan</h2>
        <p>
          Cadangan yang kamu unduh berupa arsip ZIP berisi data dalam format
          NDJSON, tiap file dienkripsi dengan kata sandi pilihanmu dan
          dilengkapi checksum — jadi cadangan yang rusak atau berubah
          ketahuan sebelum dipulihkan, bukan sesudah. Tanpa kata sandi itu,
          isi cadangan tidak bisa dibuka, termasuk oleh kami. Simpan kata
          sandinya baik-baik; kalau hilang, cadangan tidak bisa dipulihkan.
        </p>

        <h2>Cadangan Google Drive</h2>
        <p>
          Kalau kamu menghubungkan Google Drive, cadangan yang sama disimpan di
          folder aplikasi Google Drive-mu. DompetKu hanya bisa melihat folder
          itu, bukan file Drive-mu yang lain. Yang tersimpan di sana adalah
          file terenkripsi yang sama, jadi Google pun tidak bisa membaca isi
          anggarannya tanpa kata sandimu. Token akses Drive hanya tersimpan di
          perangkat ini dan tidak pernah ikut dicadangkan.
        </p>

        <h2>Yang tidak pernah kami minta</h2>
        <p>
          DompetKu tidak pernah meminta nomor rekening, kata sandi, PIN, atau
          akses ke rekening bankmu. Dompet di aplikasi ini adalah wadah
          anggaran yang kamu isi sendiri, bukan rekening bank.
        </p>

        <h2>Perubahan kebijakan ini</h2>
        <p>
          Kalau kebijakan ini berubah, versi baru akan tampil di aplikasi
          sebelum berlaku.
        </p>
      </section>
    </div>
  );
}
