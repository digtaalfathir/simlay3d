/* Pemeriksaan jalur, timeline, dan konfigurasi. Jalankan: node test-path.js
   Logika & angka diambil langsung dari sumber supaya tidak ada duplikasi yang bisa basi. */
const fs = require('fs');
const assert = require('assert');

const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
const coreSrc = read('js/core.js');
const vaultSrc = read('js/anim-vault.js');
const whSrc = read('js/anim-warehouse.js');
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
const registered = [coreSrc, vaultSrc, whSrc]
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

console.log('OK — konfigurasi, vault (2 skenario x 2 konsep), dan gudang ('
  + Object.keys(WPS).length + ' arah alur) lolos semua pemeriksaan');
