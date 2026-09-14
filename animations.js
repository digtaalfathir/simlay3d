/* ============================================================
   DAFTAR ANIMASI YANG DITAMPILKAN

   Ini satu-satunya file yang perlu disentuh untuk memilih animasi
   mana yang muncul di dropdown header.

   - Urutan array = urutan dropdown.
   - Item pertama = animasi yang terbuka saat halaman dimuat.
   - Sembunyikan animasi dengan menghapusnya atau memberi // di depan.
   - id harus cocok dengan SIMLAY.register('<id>', ...) di js/anim-*.js

   Animasi yang tersedia:
     'warehouse' — Gudang: forklift lewat RFID gate, data ke WMS
     'injection' — Injection molding: hitung shot, robot takeout, label otomatis
     'picktolamp' — Pick to lamp: lampu di flow rack memandu kitting
     'tightening' — Tightening tool: job per VIN, hasil per baut, stopper
     'vault'     — Gold Vault: tata letak rak & antena RFID
   ============================================================ */
window.SIMLAY_CONFIG = {
  show: [
    'injection',
    'warehouse',
    'vault',
    'picktolamp',
    'tightening'
  ]
};
