# simlay3d

Kumpulan animasi 3D berbasis web untuk peragaan sistem RFID. Tanpa build step —
buka `index.html` di browser dan jalan.

Branding UI-nya **Stechoq 3D**; nama repo sengaja generic supaya bisa dipakai ulang.

## Menjalankan

```sh
xdg-open index.html
```

Butuh koneksi internet saat pertama buka — Three.js diambil dari CDN. Kalau CDN
tidak bisa diakses, status bar bawah menampilkan pesan gagal muat.

Untuk pakai offline, unduh Three.js lalu arahkan tag `<script>` pertama ke file lokal:

```sh
curl -o three.min.js https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
```

## Animasi

Pilih lewat dropdown di kanan header, sebelah toggle tema.

**Gudang · RFID → WMS.** Satu RFID gate di pintu dock, dua arah alur barang. Dibuat
untuk pameran: alurnya harus terbaca tanpa perlu dijelaskan.

- *Barang keluar (delivery).* Forklift mengambil pallet berisi 3 SKU / 6 karton
  ber-tag dari rak, lalu melintas gate **tanpa berhenti**. Enam tag terbaca sekaligus
  dan WMS langsung mencatat pengeluaran stok.
- *Barang masuk (receiving) — putaway.* Pallet masuk dari dock, gate membaca enam tag
  saat melintas, WMS mencatat penerimaan **dan menentukan lokasi simpan** (A-02-1).
  Slot tujuan disorot di rak, forklift menyimpan pallet ke sana. Operator tidak
  mengetik apa pun dan tidak perlu menebak rak mana yang kosong.

Pembacaan gate dipicu dari jarak forklift ke gate, bukan dari jeda di timeline — jadi
berlaku untuk kedua arah dan tidak ada berhenti yang bisa disalahartikan sebagai scan.

**Gold Vault · RFID.** Studi tata letak rak emas dan antena RFID di ruang
12 × 8 × 3.2 m, dua konsep penempatan, plus simulasi alur petugas dari scan SPK
sampai verifikasi keluar. Punya dua skenario:

- *Normal — sesuai SPK.* SPK valid, ambil 2 batang, verifikasi di station, gate
  cocok, pintu terbuka.
- *Ambil lebih dari SPK — station dilewati.* Ambil 3 batang untuk SPK 2 batang lalu
  lewati RFID Station. Gate di ambang pintu tetap membaca semua tag → mismatch,
  pintu tidak pernah terbuka, petugas tertahan di dalam. Ini yang membenarkan adanya
  dua titik baca: station bisa dihindari, gate tidak.

## Memilih animasi yang tampil

Semua ada di [animations.js](animations.js):

```js
window.SIMLAY_CONFIG = {
  show: ['warehouse', 'vault']
};
```

Urutan array = urutan dropdown, item pertama yang terbuka saat halaman dimuat.
Sembunyikan animasi dengan menghapus atau memberi `//` di depannya. Kalau hanya satu
animasi aktif, dropdown-nya ikut disembunyikan.

Ini file `.js`, bukan `.json`, dengan alasan konkret: `fetch()` pada `file://`
diblokir CORS, jadi config JSON akan mematikan kemampuan buka `index.html` langsung
tanpa server. Isinya objek biasa — pengalaman editnya sama.

## Kontrol

| Aksi | Cara |
|---|---|
| Rotasi kamera | drag mouse |
| Zoom | scroll |
| Ganti animasi | dropdown di header |
| Ganti tema | toggle **Dark / Light** di kanan header (default: Dark) |
| Ganti konsep | segmented button (hanya animasi yang punya varian) |
| Denah atas | segmented button **Denah (atas)** |
| Ganti skenario | dropdown di panel kiri (muncul kalau > 1 skenario) |
| Jalankan | **▶ Play** / **■ Stop** |
| Mode pameran | centang **Ulang otomatis** — animasi loop terus |

Checkbox lain: zona baca RFID, jalur & pelaku, label ruangan.

## Struktur

```
index.html              # shell: header, panel, legenda, status bar, CSS
animations.js           # daftar animasi yang tampil — satu-satunya file konfigurasi
js/core.js              # renderer, kamera, orbit, tema, label, gate, timeline, UI
js/anim-warehouse.js    # animasi gudang
js/anim-vault.js        # animasi gold vault
test-path.js            # pemeriksaan jalur & konfigurasi — node test-path.js
```

Plain `<script>` + global `SIMLAY`, bukan ES module: modul akan memaksa pemakaian
server lokal karena `file://` menolak `import`. Konsekuensinya urutan tag `<script>`
di `index.html` menentukan urutan muat — `core.js` harus lebih dulu dari `anim-*.js`.

### Menambah animasi baru

Buat `js/anim-<nama>.js`, daftarkan dirinya sendiri, tambahkan tag `<script>` di
`index.html`, lalu masukkan id-nya ke `animations.js`:

```js
SIMLAY.register('gudang2', {
  label:'Gudang 2',                 // teks dropdown
  title:'Gudang 2', sub:'...',      // judul panel kiri
  room:{w:20,d:12,h:5,doorW:3,doorH:4},
  cam:{theta:.7, phi:1.0, r:24, target:[0,1.4,0]},
  speed:1.6, smoothTurn:true,
  legend:[['#F0A21C','Forklift']],
  scenarios:{ ok:{label:'Normal', note:'...'} },
  flowText:{ walk:'...', idle:'...' },
  build(variant, scen){ /* isi S.groups.concept, set S.actor */ return {wps, stats}; },
  tick(ct, seg, win, actor){ /* animasi per frame */ },
  reset(){ /* kembalikan ke kondisi awal */ }
});
```

Yang wajib: `label`, `title`, `room`, `build()` yang mengembalikan `{wps}` dan
mengisi `S.actor`. Sisanya opsional. `variants` memunculkan segmented button,
`scenarios` memunculkan dropdown skenario.

Helper yang sudah ada di core dan tidak perlu ditulis ulang: `S.makeGate()`
(pedestal RFID, opsional palang atas), `S.makeAntenna()` (antena + kerucut zona
baca), `S.makeScreen()` (layar canvas yang bisa digambar ulang), `S.addLabel()`,
`S.shared()` untuk menandai geometry/material yang dipakai ulang antar build.

### Catatan teknis yang mudah terlanggar

- **Arah hadap model.** Core memakai `yaw = atan2(dx, dz)`, jadi sisi depan model
  harus di local **+z**. Model yang dibangun menghadap −z perlu dibungkus grup yang
  diputar 180°, seperti forklift.
- **Geometry sprite tidak boleh di-dispose.** Three r128 memakai satu
  `BufferGeometry` bersama untuk *semua* sprite; membuangnya merusak label yang
  dibuat sesudahnya. `disposeGroup()` sudah melewati sprite.
- **`applyTheme()` butuh ruangan sudah ada** — dipanggil dari dalam `rebuild()`,
  jangan sebelum `buildRoom()`.

## Pemeriksaan

```sh
node test-path.js
```

Membaca `SCENARIOS`, `buildTimeline`, konstanta layout, dan data waypoint langsung
dari sumber, jadi tidak ada logika yang diduplikasi di test. Yang dijaga:

- setiap id di `animations.js` benar-benar punya `SIMLAY.register()` — typo di config
  akan diam-diam menghilangkan animasi dari dropdown
- jalur petugas vault tidak menembus rak (sampling 5 cm terhadap AABB rak)
- skenario penolakan vault tidak punya window `scan`/`waitdoor` — itulah yang membuat
  pintu tetap terkunci, dan tidak ada waypoint di luar pintu setelah petugas masuk
- setiap arah alur gudang punya skenario dengan nama sama — kalau tidak, `build()`
  akan menerima `wps` undefined
- jalur forklift (kedua arah) benar-benar melintasi zona gate **dan** bidang pintu,
  keduanya masih di dalam lebar pintu dikurangi setengah lebar forklift
- pallet ada di garpu saat melintas gate: `pick` harus sebelum gate, `store` harus
  sesudahnya — kalau urutannya terbalik, pembacaan tag tidak pernah terpicu
- titik ambil/simpan pallet di luar rak, sejajar bay, dan terjangkau garpu
- tidak ada segmen timeline berdurasi NaN atau nol

## Catatan

- Three.js masih r128 (2021). Cukup untuk kebutuhan sekarang; upgrade perlu
  penyesuaian karena `outputEncoding` dan `sRGBEncoding` sudah dihapus di versi baru.
- Belum ada bundler. Tambahkan kalau jumlah animasi sudah membuat urutan tag
  `<script>` jadi susah dirawat, bukan sebelum itu.
