# simlay3d

Simulator tata letak 3D berbasis web. Satu file HTML, tanpa build step — buka
`index.html` di browser dan jalan.

Studi kasus yang ada saat ini: **Stechoq 3D — Gold Vault RFID**, membandingkan dua
konsep penempatan rak emas dan antena RFID di ruang 12 × 8 × 3.2 m, plus simulasi
alur petugas dari scan SPK sampai verifikasi keluar.

## Menjalankan

```sh
xdg-open index.html
```

Butuh koneksi internet saat pertama buka — Three.js diambil dari CDN. Kalau CDN
tidak bisa diakses, header status bawah akan menampilkan "Gagal memuat Three.js".

Untuk pakai offline, unduh Three.js ke repo dan arahkan tag `<script>` ke file lokal:

```sh
curl -o three.min.js https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
```

## Kontrol

| Aksi | Cara |
|---|---|
| Rotasi kamera | drag mouse |
| Zoom | scroll |
| Ganti konsep | segmented button **Konsep 1 / Konsep 2** |
| Denah atas | segmented button **Denah (atas)** |
| Jalankan simulasi | **▶ Play** / **■ Stop** |
| Tema | toggle **Dark / Light** di kanan header (default: Dark) |

Checkbox di panel kiri: cakupan antena RFID, jalur petugas, label ruangan.

## Dua konsep

**Konsep 1 — Satu sisi.** 7 rak di dinding belakang, 4 antena langit-langit
diarahkan ke rak, 1 reader 4-port. Antena langit-langit = pemantauan area; kontrol
akses sepenuhnya lewat SPK dan verifikasi di station.

**Konsep 2 — Penuh rak.** 15 rak (3 baris × 5), 24 antena (2 per level × 4 level ×
3 baris), 3 reader 8-port. Zona baca terfokus per level rak, risiko cross-read
antar baris kecil.

## Struktur

```
index.html      # semuanya: markup, CSS, scene Three.js, timeline simulasi
```

Konsep didefinisikan di object `CONCEPTS` — tiap konsep punya `stats`, `note`, dan
`build()` yang mengembalikan array waypoint petugas. Menambah konsep ke-3 berarti
menambah satu entry di situ plus satu tombol di `#segConcept`.

Tema 3D (warna background, lantai, dinding, grid, intensitas cahaya) ada di object
`T3D`, terpisah dari CSS variable untuk UI.

## Catatan

- Nama repo sengaja generic; branding "Stechoq 3D" hanya ada di `<title>` dan
  elemen `#brand`, tinggal ganti dua tempat itu untuk dipakai proyek lain.
- Three.js masih r128 (2021). Cukup untuk kebutuhan sekarang; upgrade perlu
  penyesuaian karena `outputEncoding` dan `sRGBEncoding` sudah dihapus di versi baru.
- Belum ada bundler. Tambahkan Vite kalau satu file sudah susah dinavigasi, bukan
  sebelum itu.
```
