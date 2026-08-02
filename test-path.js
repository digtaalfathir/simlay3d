/* Pemeriksaan jalur & timeline. Jalankan: node test-path.js
   Logika diambil langsung dari index.html supaya tidak ada duplikasi yang bisa basi. */
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/index.html', 'utf8');

function slice(from, to){
  const i = src.indexOf(from);
  assert.ok(i > 0, 'penanda hilang di index.html: ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'penanda penutup hilang: ' + to);
  return src.slice(i, j);
}

// toDoor & waypoint normal dibaca dari sumber, bukan ditulis ulang di sini
const toDoor = {};
[...src.matchAll(/toDoor:(\[.*?\])/g)].forEach((m, i) => { toDoor[i + 1] = eval(m[1]); });
const normal = {};
[...src.matchAll(/return \[\s*\{x:\.6,z:5\.0\}[\s\S]*?\];/g)]
  .forEach((m, i) => { normal[i + 1] = eval(m[0].replace(/^return /, '')); });

assert.strictEqual(Object.keys(toDoor).length, 2, 'harus ada 2 toDoor');
assert.strictEqual(Object.keys(normal).length, 2, 'harus ada 2 set waypoint normal');

const ctx = new Function(`
  const ROOM = { w:12, d:8, h:3.2 };
  const GATE_Z = ROOM.d/2 - .45;
  const CONCEPTS = { 1:{toDoor:${JSON.stringify(toDoor[1])}}, 2:{toDoor:${JSON.stringify(toDoor[2])}} };
  ${slice('function buildTimeline(', '\n/* ================= concepts')}
  ${slice('const SPK_QTY', '\n/* ================= simulation state')}
  return { buildTimeline, SCENARIOS, SPK_QTY, GATE_Z, ROOM };
`)();
const { buildTimeline, SCENARIOS, SPK_QTY, GATE_Z } = ctx;

/* ---------- jumlah batang ---------- */
assert.strictEqual(SCENARIOS.ok.bars, SPK_QTY, 'skenario normal bawa sesuai SPK');
assert.strictEqual(SCENARIOS.surplus.bars, SPK_QTY + 1, 'skenario surplus bawa 1 lebih');
assert.ok(SCENARIOS.surplus.bars <= 3, 'model officer hanya punya 3 batang');

/* ---------- rak: jalur tidak boleh menembus ---------- */
const MARGIN = .1, HALF_X = .62, HALF_Z = .25;
const racks = {
  1: Array.from({ length: 7 }, (_, i) => ({ x: -4.5 + i * 1.5, z: -3.55 })),
  2: [-3.55, -1.55, .45].flatMap(z => Array.from({ length: 5 }, (_, i) => ({ x: -3 + i * 1.5, z })))
};
function hitsRack(wps, c){
  for(let i = 1; i < wps.length; i++){
    const a = wps[i-1], b = wps[i];
    const steps = Math.ceil(Math.hypot(b.x-a.x, b.z-a.z) / .05) || 1;
    for(let s = 0; s <= steps; s++){
      const x = a.x + (b.x-a.x)*s/steps, z = a.z + (b.z-a.z)*s/steps;
      for(const r of racks[c])
        if(Math.abs(x-r.x) < HALF_X+MARGIN && Math.abs(z-r.z) < HALF_Z+MARGIN)
          return `segmen ${i} menembus rak (${r.x},${r.z}) di (${x.toFixed(2)},${z.toFixed(2)})`;
    }
  }
  return null;
}

for(const c of [1, 2]){
  for(const [name, scen] of Object.entries(SCENARIOS)){
    const wps = scen.wps(normal[c].map(p => ({...p})), c);
    const hit = hitsRack(wps, c);
    assert.strictEqual(hit, null, `konsep ${c} / ${name}: ${hit}`);

    const tl = buildTimeline(wps);
    assert.ok(tl.total > 0 && Number.isFinite(tl.total), `konsep ${c} / ${name}: total durasi tidak wajar`);
    tl.segs.forEach(s => assert.ok(Number.isFinite(s.t0) && s.t1 > s.t0,
      `konsep ${c} / ${name}: segmen ${s.type} punya durasi NaN atau nol`));
    // pintu masuk bergantung pada dua window ini di animate()
    assert.ok(tl.win.spk && tl.win.enterin, `konsep ${c} / ${name}: window masuk hilang`);
  }
}

/* ---------- skenario normal tidak berubah ---------- */
for(const c of [1, 2]){
  const wps = SCENARIOS.ok.wps(normal[c].map(p => ({...p})), c);
  assert.deepStrictEqual(wps, normal[c], `konsep ${c}: skenario normal harus identik`);
  const tl = buildTimeline(wps);
  assert.ok(tl.win.scan, `konsep ${c}: skenario normal harus punya window scan (pintu keluar terbuka)`);
  assert.ok(tl.win.waitdoor, `konsep ${c}: skenario normal harus punya waitdoor`);
}

/* ---------- surplus: station dilewati, gate menolak, pintu tetap tertutup ---------- */
for(const c of [1, 2]){
  const wps = SCENARIOS.surplus.wps(normal[c].map(p => ({...p})), c);
  const tl = buildTimeline(wps);

  // INI jaminan "petugas tidak bisa keluar": exitOpen di animate() = win.scan && ...
  assert.strictEqual(tl.win.scan, undefined, `konsep ${c}: surplus tidak boleh punya window scan`);
  assert.strictEqual(tl.win.waitdoor, undefined, `konsep ${c}: surplus tidak boleh punya waitdoor`);
  assert.ok(tl.win.denied, `konsep ${c}: surplus harus punya window denied`);
  assert.ok(tl.win.pick, `konsep ${c}: surplus harus tetap mengambil emas`);

  const last = wps[wps.length - 1];
  assert.strictEqual(last.event, 'denied', `konsep ${c}: waypoint terakhir harus denied`);
  assert.strictEqual(last.x, 0, `konsep ${c}: berhenti di tengah lorong gate`);
  assert.strictEqual(last.z, GATE_Z, `konsep ${c}: berhenti tepat di zona baca gate`);
  assert.ok(last.z < 4, `konsep ${c}: tidak boleh melewati bidang pintu (z=4)`);

  // tidak ada waypoint di luar pintu
  wps.forEach((p, i) => assert.ok(p.z <= 5.0, `konsep ${c}: waypoint ${i} keluar ruangan`));
  const afterEnter = wps.slice(wps.findIndex(p => p.event === 'enterin') + 1);
  afterEnter.forEach((p, i) => assert.ok(p.z < 4,
    `konsep ${c}: waypoint ${i} setelah masuk berada di luar pintu — petugas lolos`));
}

/* ---------- teks skenario surplus ---------- */
['pick', 'denied', 'idle'].forEach(k =>
  assert.ok(SCENARIOS.surplus.text[k], `teks surplus.${k} hilang`));
assert.ok(/DITOLAK/.test(SCENARIOS.surplus.end), 'teks akhir surplus harus menyatakan penolakan');

console.log('OK — ' + Object.keys(SCENARIOS).length + ' skenario x 2 konsep lolos semua pemeriksaan');
