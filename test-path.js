/* Pemeriksaan jalur, timeline, dan konfigurasi. Jalankan: node test-path.js
   Logika & angka diambil langsung dari sumber supaya tidak ada duplikasi yang bisa basi. */
const fs = require('fs');
const assert = require('assert');

const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
const coreSrc = read('js/core.js');
const vaultSrc = read('js/anim-vault.js');
const whSrc = read('js/anim-warehouse.js');
const injSrc = read('js/anim-injection.js');
const ptlSrc = read('js/anim-picktolamp.js');
const cfgSrc = read('animations.js');

function slice(src, from, to, what){
  const i = src.indexOf(from);
  assert.ok(i > 0, 'penanda hilang (' + what + '): ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'penanda penutup hilang (' + what + '): ' + to);
  return src.slice(i, j);
}
/* ambil deklarasi `const NAMA = <ekspresi aritmatika>;` apa adanya dari sumber */
function consts(src, names){
  return names.map(n => {
    const m = src.match(new RegExp('const ' + n + '\\s*=\\s*[^;]+;'));
    assert.ok(m, 'const ' + n + ' tidak ditemukan');
    return m[0];
  }).join('\n');
}

/* ============ buildTimeline diambil dari core ============ */
const buildTimeline = new Function(
  'const S={};\n' +
  slice(coreSrc, 'S.buildTimeline = function', '\nS.makePath', 'core') +
  '\nreturn S.buildTimeline;'
)();

/* ============================================================
   1. animations.js — setiap id harus benar-benar terdaftar
   ============================================================ */
const cfg = new Function('const window={};' + cfgSrc + 'return window.SIMLAY_CONFIG;')();
const registered = [coreSrc, vaultSrc, whSrc, injSrc, ptlSrc]
  .flatMap(s => [...s.matchAll(/S\.register\(\s*'([^']+)'/g)].map(m => m[1]));
assert.ok(cfg && Array.isArray(cfg.show), 'animations.js harus mengekspor show[]');
assert.ok(cfg.show.length > 0, 'animations.js: show[] kosong, tidak ada yang tampil');
cfg.show.forEach(id => assert.ok(registered.includes(id),
  `animations.js menyebut '${id}' tapi tidak ada SIMLAY.register('${id}') — dropdown akan melewatkannya`));
assert.strictEqual(new Set(cfg.show).size, cfg.show.length, 'animations.js: ada id ganda di show[]');

/* ============================================================
   2. Gold Vault — varian, skenario, jalur
   ============================================================ */
const toDoor = {};
[...vaultSrc.matchAll(/toDoor:(\[.*?\])/g)].forEach((m, i) => { toDoor[i + 1] = eval(m[1]); });
const normal = {};
[...vaultSrc.matchAll(/return \[\s*\{x:\.6,z:5\.0\}[\s\S]*?\];/g)]
  .forEach((m, i) => { normal[i + 1] = eval(m[0].replace(/^return /, '')); });

assert.strictEqual(Object.keys(toDoor).length, 2, 'vault: harus ada 2 toDoor');
assert.strictEqual(Object.keys(normal).length, 2, 'vault: harus ada 2 set waypoint normal');

const vault = new Function(`
  const GATE_Z = 8/2 - .45;
  const VARIANTS = { 1:{toDoor:${JSON.stringify(toDoor[1])}}, 2:{toDoor:${JSON.stringify(toDoor[2])}} };
  ${slice(vaultSrc, 'const SPK_QTY', "\nS.register('vault'", 'vault')}
  return { SCENARIOS, SPK_QTY, GATE_Z };
`)();
const { SCENARIOS, SPK_QTY, GATE_Z } = vault;

assert.strictEqual(SCENARIOS.ok.bars, SPK_QTY, 'vault: skenario normal bawa sesuai SPK');
assert.strictEqual(SCENARIOS.surplus.bars, SPK_QTY + 1, 'vault: skenario surplus bawa 1 lebih');
assert.ok(SCENARIOS.surplus.bars <= 3, 'vault: model petugas hanya punya 3 batang');

const MARGIN = .1, HALF_X = .62, HALF_Z = .25;
const racks = {
  1: Array.from({ length: 7 }, (_, i) => ({ x: -4.5 + i * 1.5, z: -3.55 })),
  2: [-3.55, -1.55, .45].flatMap(z => Array.from({ length: 5 }, (_, i) => ({ x: -3 + i * 1.5, z })))
};
function hitsRack(wps, v){
  for(let i = 1; i < wps.length; i++){
    const a = wps[i-1], b = wps[i];
    const steps = Math.ceil(Math.hypot(b.x-a.x, b.z-a.z) / .05) || 1;
    for(let s = 0; s <= steps; s++){
      const x = a.x + (b.x-a.x)*s/steps, z = a.z + (b.z-a.z)*s/steps;
      for(const r of racks[v])
        if(Math.abs(x-r.x) < HALF_X+MARGIN && Math.abs(z-r.z) < HALF_Z+MARGIN)
          return `segmen ${i} menembus rak (${r.x},${r.z}) di (${x.toFixed(2)},${z.toFixed(2)})`;
    }
  }
  return null;
}

function checkTimeline(tl, who){
  assert.ok(tl.total > 0 && Number.isFinite(tl.total), `${who}: total durasi tidak wajar`);
  tl.segs.forEach(s => assert.ok(Number.isFinite(s.t0) && s.t1 > s.t0,
    `${who}: segmen ${s.type} punya durasi NaN atau nol`));
}

for(const v of [1, 2]){
  for(const [name, scen] of Object.entries(SCENARIOS)){
    const wps = scen.wps(normal[v].map(p => ({...p})), v);
    const hit = hitsRack(wps, v);
    assert.strictEqual(hit, null, `vault konsep ${v} / ${name}: ${hit}`);
    const tl = buildTimeline(wps, 1.5);
    checkTimeline(tl, `vault konsep ${v} / ${name}`);
    assert.ok(tl.win.spk && tl.win.enterin, `vault konsep ${v} / ${name}: window masuk hilang`);
  }
}

/* skenario normal tidak boleh berubah */
for(const v of [1, 2]){
  const wps = SCENARIOS.ok.wps(normal[v].map(p => ({...p})), v);
  assert.deepStrictEqual(wps, normal[v], `vault konsep ${v}: skenario normal harus identik`);
  const tl = buildTimeline(wps, 1.5);
  assert.ok(tl.win.scan, `vault konsep ${v}: normal harus punya window scan (pintu keluar terbuka)`);
  assert.ok(tl.win.waitdoor, `vault konsep ${v}: normal harus punya waitdoor`);
}

/* surplus: station dilewati, gate menolak, pintu tetap tertutup */
for(const v of [1, 2]){
  const wps = SCENARIOS.surplus.wps(normal[v].map(p => ({...p})), v);
  const tl = buildTimeline(wps, 1.5);

  // INI jaminan "petugas tidak bisa keluar": exitOpen di tick() = win.scan && ...
  assert.strictEqual(tl.win.scan, undefined, `vault konsep ${v}: surplus tidak boleh punya window scan`);
  assert.strictEqual(tl.win.waitdoor, undefined, `vault konsep ${v}: surplus tidak boleh punya waitdoor`);
  assert.ok(tl.win.denied, `vault konsep ${v}: surplus harus punya window denied`);
  assert.ok(tl.win.pick, `vault konsep ${v}: surplus harus tetap mengambil emas`);

  const last = wps[wps.length - 1];
  assert.strictEqual(last.event, 'denied', `vault konsep ${v}: waypoint terakhir harus denied`);
  assert.strictEqual(last.x, 0, `vault konsep ${v}: berhenti di tengah lorong gate`);
  assert.strictEqual(last.z, GATE_Z, `vault konsep ${v}: berhenti tepat di zona baca gate`);

  const afterEnter = wps.slice(wps.findIndex(p => p.event === 'enterin') + 1);
  afterEnter.forEach((p, i) => assert.ok(p.z < 4,
    `vault konsep ${v}: waypoint ${i} setelah masuk berada di luar pintu — petugas lolos`));
}

['pick', 'denied', 'idle'].forEach(k =>
  assert.ok(SCENARIOS.surplus.text[k], `vault: teks surplus.${k} hilang`));
assert.ok(/DITOLAK/.test(SCENARIOS.surplus.end), 'vault: teks akhir surplus harus menyatakan penolakan');

/* ============================================================
   3. Gudang — dua arah alur, keduanya wajib melintas gate
   ============================================================ */
const whConstSrc = consts(whSrc, ['ROOM','GATE_Z','DOOR_W','DOOR_H','ROWS','LIFT_X','RACK_Z','READ_BAND']);
const wh = new Function(whConstSrc +
  '\nreturn {ROOM,GATE_Z,DOOR_W,DOOR_H,ROWS,LIFT_X,RACK_Z,READ_BAND};')();

const wpsSrc = whSrc.match(/const WPS = \{[\s\S]*?\n\};/);
assert.ok(wpsSrc, 'gudang: const WPS tidak ditemukan');
const WPS = new Function(whConstSrc + '\n' + wpsSrc[0] + '\nreturn WPS;')();

assert.ok(wh.GATE_Z < wh.ROOM.d / 2, 'gudang: gate harus di dalam ruangan, bukan di luar pintu');
assert.ok(wh.DOOR_H < wh.ROOM.h, 'gudang: pintu lebih tinggi dari ruangan');
assert.ok(wh.RACK_Z > wh.ROWS[1] - 1.25 && wh.RACK_Z < wh.ROWS[1] + 1.25,
  'gudang: pallet di rak harus berada di dalam bay');

/* setiap jalur wajib punya skenario dengan nama sama — build() memakai WPS[scen] */
const scenBlock = slice(whSrc, '  scenarios:{', '\n  flowText:', 'gudang');
const scenKeys = [...scenBlock.matchAll(/\n    (\w+):\{/g)].map(m => m[1]);
assert.deepStrictEqual(scenKeys.slice().sort(), Object.keys(WPS).sort(),
  `gudang: skenario [${scenKeys}] tidak cocok dengan jalur WPS [${Object.keys(WPS)}] — build() akan dapat wps undefined`);

const FORK_HALF = .62;   // setengah lebar forklift
function crossAt(wps, planeZ){
  for(let i = 1; i < wps.length; i++){
    const a = wps[i-1], b = wps[i];
    if((a.z - planeZ) * (b.z - planeZ) <= 0 && a.z !== b.z){
      const k = (planeZ - a.z) / (b.z - a.z);
      return { i, x: a.x + (b.x - a.x) * k };
    }
  }
  return null;
}

for(const [name, wps] of Object.entries(WPS)){
  const who = 'gudang/' + name;
  checkTimeline(buildTimeline(wps, 1.7), who);

  /* melintas zona gate DAN bidang pintu, keduanya harus lewat lubang pintu */
  const g = crossAt(wps, wh.GATE_Z);
  const d = crossAt(wps, wh.ROOM.d / 2);
  assert.ok(g, `${who}: jalur tidak pernah melewati zona baca gate — tag tidak akan terbaca`);
  assert.ok(d, `${who}: jalur tidak pernah melewati bidang pintu`);
  [[g,'gate'],[d,'pintu']].forEach(([c,what]) =>
    assert.ok(Math.abs(c.x) < wh.DOOR_W / 2 - FORK_HALF,
      `${who}: melintas ${what} di x=${c.x.toFixed(2)}, forklift menembus dinding/portal`));

  /* titik ambil / simpan harus di luar rak tapi terjangkau garpu */
  const ev = wps.find(p => p.event);
  assert.ok(ev, `${who}: tidak ada event dwell (pick / store)`);
  const gap = ev.z - (wh.ROWS[1] + 1.25);
  assert.ok(gap > 0, `${who}: titik ${ev.event} berada di dalam rak`);
  assert.ok(gap < 2.0, `${who}: titik ${ev.event} ${gap.toFixed(2)} m dari rak, garpu tidak menjangkau`);
  assert.strictEqual(ev.x, wh.LIFT_X, `${who}: titik ${ev.event} tidak sejajar bay rak`);

  /* pallet HARUS ada di garpu saat melintas gate, kalau tidak pembacaan tak pernah terpicu.
     issue: ambil dulu, baru lewat gate.  receiving: lewat gate dulu, baru simpan. */
  const evIdx = wps.indexOf(ev);
  if(ev.event === 'pick'){
    assert.ok(evIdx < g.i, `${who}: gate dilewati sebelum pallet diambil — tidak ada tag untuk dibaca`);
    assert.ok(wps[wps.length-1].z > wh.ROOM.d / 2, `${who}: forklift harus benar-benar keluar`);
  }else{
    assert.ok(evIdx > g.i, `${who}: pallet disimpan sebelum melewati gate — tidak ada tag untuk dibaca`);
    assert.ok(wps[0].z > wh.ROOM.d / 2, `${who}: forklift harus mulai di luar pintu dock`);
    assert.ok(wps[wps.length-1].z < wh.ROOM.d / 2, `${who}: forklift harus berakhir di dalam gudang`);
  }
}

/* ============================================================
   4. Injection — sinkronisasi mesin, robot, dan operator
   ============================================================ */
/* urutan penting: MACH_TOP butuh PLATEN_*, PICK_X butuh PLATEN_OPEN + PART_OFF */
const INJ_NAMES = ['PLATEN_W','PLATEN_Y','PLATEN_H','MACH_TOP','FIX_X','END_X','BED_X1',
  'PART_W','PART_H','PART_L',
  'PLATEN_CLOSED','PLATEN_OPEN','MOLD_T','MOLD_FIX_X','MOLD_MOVE_OFF','PART_OFF',
  'RAIL_Y','RAIL_X1','ARM_MIN','EFF_DROP','HOME_X','PICK_X',
  'CHUTE_X','CHUTE_W','CHUTE_Z0','CHUTE_Y0','CHUTE_Z1','CHUTE_Y1','CHUTE_ANG','DROP_X',
  'TABLE_X','TABLE_Z','TABLE_W','TABLE_D','TABLE_TOP','LAND_Z','PART_REST',
  'RACK','RACK_W','RACK_Y','PRINTER','PANEL','TV',
  'SHOTS','MACH_T','CHECK_T','STORE_T','PRINT_T','INJECT_END','COOL_END','OPEN_END',
  'GRIP_AT','RELEASE_AT','LAND_AT','STORE_AT','OP','FACE_TABLE','FACE_WAIT','RK'];
const inj = new Function(consts(injSrc, INJ_NAMES) + '\n' +
  slice(injSrc, 'function buildWps(){', '\n/* ================= registrasi', 'injection') +
  '\nreturn {' + INJ_NAMES.join(',') + ',buildWps};')();

/* urutan fase harus masuk akal secara fisik */
assert.ok(inj.INJECT_END < inj.COOL_END, 'injection: pendinginan sebelum injeksi selesai');
assert.ok(inj.COOL_END < inj.OPEN_END, 'injection: mold terbuka sebelum pendinginan selesai');
assert.ok(inj.OPEN_END < inj.GRIP_AT, 'injection: robot menjepit sebelum mold terbuka');
assert.ok(inj.GRIP_AT < inj.RELEASE_AT, 'injection: part dilepas sebelum dijepit');
assert.ok(inj.RELEASE_AT < inj.LAND_AT, 'injection: part sampai meja sebelum dilepas robot');
assert.ok(inj.STORE_AT < inj.STORE_T, 'injection: part ditaruh di rak setelah dwell store habis');
assert.ok(inj.PLATEN_OPEN > inj.PLATEN_CLOSED, 'injection: mold harus terbuka ke arah +x');

/* keyframe robot: waktu naik monoton, dan berakhir kembali ke posisi parkir */
inj.RK.forEach((k, i) => {
  if(i) assert.ok(k[0] >= inj.RK[i-1][0], `injection: keyframe robot ${i} waktunya mundur`);
  assert.ok(k[2] >= inj.ARM_MIN, `injection: keyframe robot ${i} arm lebih pendek dari ARM_MIN`);
});
const lastK = inj.RK[inj.RK.length - 1];
assert.strictEqual(lastK[1], inj.HOME_X, 'injection: robot tidak kembali ke posisi parkir');
assert.strictEqual(lastK[2], inj.ARM_MIN, 'injection: arm robot tidak tertarik penuh di akhir');
assert.ok(lastK[0] >= inj.LAND_AT, 'injection: keyframe robot habis sebelum part mendarat');
/* robot harus benar-benar berada di atas part saat menjepit, dan di seluncuran saat melepas */
const kAt = t => { const r = inj.RK.filter(k => k[0] <= t); return r[r.length-1]; };
assert.strictEqual(kAt(inj.GRIP_AT)[1], inj.PICK_X, 'injection: robot tidak di atas part saat GRIP_AT');
assert.strictEqual(kAt(inj.RELEASE_AT)[1], inj.DROP_X, 'injection: robot tidak di seluncuran saat RELEASE_AT');

/* ---- geometri mesin: dua paruh mold tidak boleh saling tembus saat tertutup ---- */
const fixFace = inj.FIX_X + inj.PLATEN_W/2;                 // muka platen tetap
const movFace = inj.PLATEN_CLOSED - inj.PLATEN_W/2;         // muka platen bergerak, tertutup
const moldFix = [inj.MOLD_FIX_X - inj.MOLD_T/2, inj.MOLD_FIX_X + inj.MOLD_T/2];
const moldMovC = [inj.PLATEN_CLOSED + inj.MOLD_MOVE_OFF - inj.MOLD_T/2,
                  inj.PLATEN_CLOSED + inj.MOLD_MOVE_OFF + inj.MOLD_T/2];
assert.ok(moldFix[1] <= moldMovC[0] + .02,
  `injection: dua paruh mold saling tembus ${(moldFix[1]-moldMovC[0]).toFixed(3)} m saat tertutup`);
assert.ok(moldFix[0] >= fixFace - .02, 'injection: paruh mold tetap menembus platen tetap');
assert.ok(moldMovC[1] <= movFace + .02, 'injection: paruh mold bergerak menembus platennya sendiri');
assert.ok(inj.PLATEN_OPEN > inj.PLATEN_CLOSED, 'injection: mold harus terbuka ke arah +x');
assert.ok(inj.PLATEN_OPEN + inj.PLATEN_W/2 < inj.END_X - inj.PLATEN_W/2,
  'injection: platen bergerak menabrak end plate saat terbuka');

/* part harus lepas dari paruh bergerak supaya bisa diangkat lurus ke atas */
assert.strictEqual(inj.PLATEN_OPEN + inj.PART_OFF, inj.PICK_X,
  'injection: PICK_X tidak sama dengan posisi part saat mold terbuka');
const moldMovOpenMin = inj.PLATEN_OPEN + inj.MOLD_MOVE_OFF - inj.MOLD_T/2;
assert.ok(inj.PICK_X + inj.PART_W/2 <= moldMovOpenMin + .02,
  'injection: part menembus paruh mold bergerak saat diangkat lurus ke atas');

/* ---- tinggi: jepit setinggi part, lepas di atas seluncuran, geser di atas mesin ---- */
const partY = len => inj.RAIL_Y - len - inj.EFF_DROP;
assert.ok(Math.abs(partY(kAt(inj.GRIP_AT)[2]) - inj.PLATEN_Y) < .06,
  `injection: robot menjepit di y=${partY(kAt(inj.GRIP_AT)[2]).toFixed(2)} tapi part di mold y=${inj.PLATEN_Y}`);
const relY = partY(kAt(inj.RELEASE_AT)[2]);
assert.ok(relY > inj.CHUTE_Y0 && relY < inj.CHUTE_Y0 + .6,
  `injection: part dilepas di y=${relY.toFixed(2)}, permukaan seluncuran y=${inj.CHUTE_Y0}`);
assert.ok(inj.RAIL_Y > inj.MACH_TOP, 'injection: rel robot di bawah puncak platen');
/* geser mendatar sambil membawa part: part wajib bebas di atas puncak platen */
inj.RK.forEach((k, i) => {
  if(!i) return;
  const prev = inj.RK[i-1];
  if(prev[1] === k[1]) return;                                  // tidak bergeser mendatar
  if(k[0] <= inj.GRIP_AT || prev[0] >= inj.RELEASE_AT) return;   // part tidak sedang dibawa
  [prev[2], k[2]].forEach(len => assert.ok(partY(len) - inj.PART_H/2 > inj.MACH_TOP,
    `injection: robot menggeser part di y=${partY(len).toFixed(2)}, menembus puncak platen ${inj.MACH_TOP}`));
});

/* ---- seluncuran: turun ke arah DEPAN, lepas dari mesin, cukup lebar ---- */
assert.ok(inj.CHUTE_Y1 < inj.CHUTE_Y0, 'injection: seluncuran tidak menurun');
assert.ok(inj.CHUTE_Z1 > inj.CHUTE_Z0, 'injection: seluncuran tidak turun ke arah depan (+z)');
assert.ok(inj.CHUTE_ANG > .1 && inj.CHUTE_ANG < .7,
  `injection: kemiringan seluncuran ${(inj.CHUTE_ANG*180/Math.PI).toFixed(0)}° di luar batas wajar`);
assert.strictEqual(inj.CHUTE_Z0, 0,
  'injection: ujung atas seluncuran harus di z=0, sejajar rel robot, kalau tidak robot melepas di udara');
assert.strictEqual(inj.DROP_X, inj.CHUTE_X, 'injection: robot melepas tidak di atas seluncuran');
/* kaki seluncuran ada di CHUTE_W/2-0.1 dari pusat — wajib lepas dari rangka mesin */
assert.ok(inj.CHUTE_X - (inj.CHUTE_W/2 - .1) > inj.BED_X1,
  'injection: kaki seluncuran menembus rangka mesin');
/* part meluncur MELEBAR, jadi lebar seluncuran/meja/rak harus menampung panjangnya */
[['seluncuran', inj.CHUTE_W], ['meja', inj.TABLE_W], ['rak', inj.RACK_W]].forEach(([what, w]) =>
  assert.ok(w >= inj.PART_L, `injection: ${what} (${w}) lebih sempit dari panjang part (${inj.PART_L})`));
/* pergelangan robot wajib sudah 90° saat melepas, supaya part masuk melebar */
assert.ok(Math.abs(kAt(inj.RELEASE_AT)[3] - Math.PI/2) < .01,
  'injection: part dilepas tanpa diputar 90°, tidak akan pas di seluncuran');
assert.strictEqual(inj.RK[0][3], 0, 'injection: pergelangan tidak lurus saat mulai');
assert.strictEqual(inj.RK[inj.RK.length-1][3], 0, 'injection: pergelangan tidak kembali lurus');
/* rel harus mencakup seluruh lintasan carriage */
assert.ok(inj.PICK_X > inj.FIX_X && inj.DROP_X < inj.RAIL_X1 - .3,
  'injection: lintasan carriage melewati ujung rel');

/* ---- tata letak depan: rak di KANAN operator, printer di KIRI, tidak tumpang tindih ---- */
const tableSpan = [inj.TABLE_X - inj.TABLE_W/2, inj.TABLE_X + inj.TABLE_W/2];
const rackSpan  = [inj.RACK[0] - inj.RACK_W/2, inj.RACK[0] + inj.RACK_W/2];
assert.ok(inj.RACK[0] > inj.TABLE_X, 'injection: rak harus di sisi +x (kanan operator yang menghadap -z)');
assert.ok(inj.PRINTER[0] < inj.TABLE_X, 'injection: printer harus di sisi -x (kiri operator)');
assert.ok(rackSpan[0] > tableSpan[1], 'injection: rak menabrak meja');
assert.ok(inj.PRINTER[0] + .35 < tableSpan[0], 'injection: printer menabrak meja');
/* operator menunggu & bekerja di DEPAN meja, bukan di belakangnya */
['wait','table','rack','print'].forEach(k =>
  assert.ok(inj.OP[k][1] > inj.TABLE_Z, `injection: posisi operator '${k}' tidak di depan meja`));
/* bumper mendarat di atas meja, bukan di luar tepinya */
assert.ok(inj.LAND_Z > inj.CHUTE_Z1 && inj.LAND_Z < inj.TABLE_Z + inj.TABLE_D/2,
  `injection: LAND_Z=${inj.LAND_Z} tidak berada di atas meja`);

/* waypoint operator tidak boleh ada dua berurutan di titik sama —
   segmen jalan berdurasi nol membuat timeline punya t1 === t0 */
const injWps = inj.buildWps();
injWps.forEach((p, i) => {
  if(!i) return;
  const q = injWps[i-1];
  assert.ok(Math.hypot(p.x-q.x, p.z-q.z) > .05,
    `injection: waypoint ${i-1} dan ${i} berada di titik yang sama`);
});

const injTl = buildTimeline(injWps, 1.9);
checkTimeline(injTl, 'injection');
assert.ok(injTl.win.p, 'injection: tidak ada event printer');

/* INTI sinkronisasi: bumper harus sudah sampai meja sebelum operator mulai memeriksa,
   kalau tidak operator memeriksa meja kosong */
for(let i = 0; i < inj.SHOTS; i++){
  const mw = injTl.win['m'+i], cw = injTl.win['c'+i], sw = injTl.win['s'+i];
  assert.ok(mw && cw && sw, `injection: shot ${i} kehilangan salah satu window m/c/s`);
  const margin = cw[0] - (mw[0] + inj.LAND_AT);
  assert.ok(margin >= .1,
    `injection: shot ${i} — bumper mendarat ${(-margin).toFixed(2)} s setelah operator tiba di meja`);
  /* part harus keluar dari tangan operator sebelum dia sampai printer */
  assert.ok(sw[0] + inj.STORE_AT < sw[1], `injection: shot ${i} — part ditaruh setelah dwell store habis`);
}
/* printer baru jalan setelah rak penuh */
assert.ok(injTl.win.p[0] > injTl.win['s'+(inj.SHOTS-1)][1] - .01,
  'injection: printer mencetak sebelum rak penuh');

/* ============================================================
   5. Pick to Lamp — lampu, operator, dan cart harus sinkron
   ============================================================ */
const PTL_NAMES = ['COLS','LEVELS','BAY_W','RACK_X0','COL_X','LEVEL_Y','RACK_FRONT','RACK_DEPTH','OP_Z',
  'HOME','END','CART_SLOTS','SPEED','ORDER','WRONG','DIGIT_MAX',
  'SCAN_T','SCAN_LIT','PICK_T','REACH_AT','PRESS_AT','PUT_AT','WRONG_T','WRONG_AT','DONE_T','RELEASE_AT'];
const ptl = new Function(consts(ptlSrc, PTL_NAMES) + '\n' +
  slice(ptlSrc, 'function lampWindow(', '\n/* ================= registrasi', 'picktolamp') +
  '\nreturn {' + PTL_NAMES.join(',') + ',lampWindow,buildWps};')();

/* urutan fase di dalam satu dwell */
assert.ok(ptl.REACH_AT < ptl.PRESS_AT && ptl.PRESS_AT < ptl.PUT_AT && ptl.PUT_AT < ptl.PICK_T,
  'picktolamp: urutan raih → tekan tombol → masuk cart tidak muat dalam PICK_T');
assert.ok(ptl.SCAN_LIT < ptl.SCAN_T, 'picktolamp: lampu pertama baru menyala setelah scan selesai');
assert.ok(ptl.WRONG_AT < ptl.WRONG_T, 'picktolamp: tombol bin salah ditekan setelah dwell-nya habis');
assert.ok(ptl.RELEASE_AT < ptl.DONE_T, 'picktolamp: cart dilepas setelah dwell done habis');

/* order harus valid terhadap rak dan perangkat */
const binKey = b => b.col + ':' + b.lvl;
assert.strictEqual(ptl.COL_X.length, ptl.COLS, 'picktolamp: jumlah posisi kolom tidak cocok dengan COLS');
assert.strictEqual(ptl.LEVEL_Y.length, ptl.LEVELS, 'picktolamp: jumlah level tidak cocok dengan LEVELS');
assert.strictEqual(new Set(ptl.ORDER.map(binKey)).size, ptl.ORDER.length, 'picktolamp: dua pick di bin yang sama');
ptl.ORDER.forEach((o, i) => {
  assert.ok(o.col >= 0 && o.col < ptl.COLS && o.lvl >= 0 && o.lvl < ptl.LEVELS, `picktolamp: pick ${i} di luar rak`);
  assert.ok(o.qty >= 1 && o.qty <= ptl.DIGIT_MAX, `picktolamp: qty pick ${i} (${o.qty}) tidak punya tampilan angka`);
});
assert.ok(ptl.ORDER.length <= ptl.CART_SLOTS, 'picktolamp: slot cart tidak cukup untuk semua pick');
assert.ok(!ptl.ORDER.some(o => binKey(o) === binKey(ptl.WRONG)), 'picktolamp: bin "salah" ternyata bin yang ada di order');
assert.ok(ptl.WRONG.before >= 1 && ptl.WRONG.before < ptl.ORDER.length, 'picktolamp: WRONG.before di luar urutan pick');
const ptlReach = ptl.OP_Z - ptl.RACK_FRONT;
assert.ok(ptlReach > .5 && ptlReach < 1.4,
  `picktolamp: operator berdiri ${ptlReach.toFixed(2)} m dari muka rak — terlalu dekat atau tidak terjangkau`);

for(const withWrong of [false, true]){
  const who = 'picktolamp/' + (withWrong ? 'salah-ambil' : 'normal');
  const wps = ptl.buildWps(withWrong);
  wps.forEach((p, i) => {
    if(i) assert.ok(Math.hypot(p.x-wps[i-1].x, p.z-wps[i-1].z) > .05, `${who}: waypoint ${i-1} dan ${i} di titik yang sama`);
  });
  const tl = buildTimeline(wps, ptl.SPEED);
  checkTimeline(tl, who);
  assert.ok(tl.win.scan && tl.win.done, `${who}: window scan / done hilang`);
  assert.strictEqual(!!tl.win.wrong, withWrong, `${who}: window wrong ${withWrong ? 'hilang' : 'muncul di skenario normal'}`);

  ptl.ORDER.forEach((o, i) => {
    const pw = tl.win['p'+i];
    assert.ok(pw, `${who}: window p${i} hilang`);
    assert.strictEqual(wps.find(p => p.event === 'p'+i).x, ptl.COL_X[o.col], `${who}: operator tidak berdiri di depan bin pick ${i}`);
    const [on, off] = ptl.lampWindow(i, tl.win);
    /* INTI: lampu sudah menyala sebelum operator tiba — operator mengikuti lampu, bukan sebaliknya */
    assert.ok(pw[0] - on >= .3, `${who}: lampu pick ${i} baru menyala ${(pw[0]-on).toFixed(2)} s sebelum operator tiba`);
    assert.ok(off > pw[0] && off < pw[1], `${who}: lampu pick ${i} padam di luar dwell pick-nya`);
    if(i) assert.ok(ptl.lampWindow(i-1, tl.win)[1] <= on + 1e-9, `${who}: dua lampu menyala bersamaan`);
  });

  if(withWrong){
    const ww = tl.win.wrong, b = ptl.WRONG.before;
    const [on, off] = ptl.lampWindow(b, tl.win);
    assert.ok(ww[0] > tl.win['p'+(b-1)][1] && ww[1] < tl.win['p'+b][0],
      `${who}: salah ambil tidak terjadi di antara pick ${b-1} dan ${b}`);
    /* lampu bin yang benar tetap hijau selama salah ambil, supaya operator tahu harus ke mana */
    assert.ok(on <= ww[0] && off >= ww[1], `${who}: lampu bin yang benar tidak menyala saat salah ambil`);
    assert.strictEqual(wps.find(p => p.event === 'wrong').x, ptl.COL_X[ptl.WRONG.col], `${who}: operator tidak di depan bin yang salah`);
  }
  assert.ok(tl.win.done[0] > tl.win['p'+(ptl.ORDER.length-1)][1], `${who}: cart dilepas sebelum pick terakhir selesai`);
}

console.log('OK — konfigurasi, vault (2 skenario x 2 konsep), gudang ('
  + Object.keys(WPS).length + ' arah alur), injection (' + inj.SHOTS
  + ' shot), pick to lamp (' + ptl.ORDER.length + ' pick x 2 skenario) lolos semua pemeriksaan');
