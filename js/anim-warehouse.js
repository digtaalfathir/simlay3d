/* ============================================================
   Gudang · RFID → WMS
   Dua arah alur barang, keduanya lewat satu RFID gate tanpa berhenti:
     issue     — pallet diambil dari rak, keluar lewat gate, stok berkurang
     receiving — pallet masuk dari dock, gate membaca, WMS menentukan
                 lokasi simpan, pallet ditaruh ke rak
   Dirancang untuk pameran: alurnya harus terbaca tanpa dijelaskan.
   ============================================================ */
"use strict";
(function(S){
const C=S.C;
const ROOM={w:22,d:14,h:6.5};
const GATE_Z=ROOM.d/2-1.4;          // 5.6 — gate di dalam pintu dock
const DOOR_W=4.0;
const DOOR_H=4.4;
const ROWS=[-5.6,-2.2];             // dua baris rak pallet
const LIFT_X=-4.5;                  // posisi ambil/simpan pallet — harus tepat di tengah bay rak
const RACK_Z=ROWS[1]+.45;           // pallet duduk di tepi depan bay
const WMS_POS=[6.4,2.5,3.4];        // layar WMS: dekat gate, menghadap kamera default
const READ_BAND=1.2;                // jarak dari gate saat tag mulai terbaca

/* resource yang dipakai ulang antar build */
const beamGeo =S.shared(new THREE.BoxGeometry(.12,.12,2.6));
const uprGeo  =S.shared(new THREE.BoxGeometry(.14,4.6,.14));
const boxGeo  =S.shared(new THREE.BoxGeometry(.52,.42,.36));
const rackMat =S.shared(new THREE.MeshStandardMaterial({color:0x2F5C8C,roughness:.5,metalness:.35}));
const uprMat  =S.shared(new THREE.MeshStandardMaterial({color:0xE07A18,roughness:.55,metalness:.25}));
const boxMat  =S.shared(new THREE.MeshStandardMaterial({color:C.box,roughness:.85}));
const boxMat2 =S.shared(new THREE.MeshStandardMaterial({color:C.boxDark,roughness:.85}));
const palMat  =S.shared(new THREE.MeshStandardMaterial({color:C.pallet,roughness:.9}));
const tagMat  =S.shared(new THREE.MeshBasicMaterial({color:0xF4F6F8}));
const dummy=new THREE.Object3D();

/* isi WMS yang dibawa satu pallet — juga dipakai untuk teks status */
const LOAD=[
  {sku:'SKU-A120', name:'Karton 40x30', qty:2, loc:'A-02-1'},
  {sku:'SKU-B450', name:'Karton 40x30', qty:2, loc:'A-02-2'},
  {sku:'SKU-C077', name:'Karton 40x30', qty:2, loc:'A-03-1'}
];
const TAG_TOTAL=LOAD.reduce((s,r)=>s+r.qty,0);   // 6
const SLOT='A-02-1';

/* ================= jalur per skenario =================
   issue     : mulai di depan rak, keluar lewat gate
   receiving : mulai di luar dock, masuk lewat gate, berakhir di rak
   Diletakkan di satu const supaya bisa diperiksa test-path.js. */
const WPS = {
  issue: [
    {x:LIFT_X, z:ROWS[1]+1.9, face:Math.PI, dwell:2.6, event:'pick'},  // garpu masuk ke bay
    {x:LIFT_X, z:ROWS[1]+4.4, reverse:true},       // mundur, tetap menghadap rak
    {x:-1.6, z:4.0},
    {x:0, z:5.0},
    {x:0, z:ROOM.d/2+3.0}                          // lurus melewati gate lalu keluar
  ],
  receiving: [
    {x:0, z:ROOM.d/2+4.0, face:Math.PI},           // menunggu di luar pintu dock
    {x:0, z:4.4},                                  // masuk, melewati pintu lalu gate
    {x:-1.6, z:3.4},
    {x:LIFT_X, z:ROWS[1]+4.4},
    {x:LIFT_X, z:ROWS[1]+1.9, dwell:3.2, event:'store'},   // menghadap rak, simpan pallet
    {x:LIFT_X, z:ROWS[1]+4.4, reverse:true}        // mundur keluar dari bay
  ]
};

let gate=null, wms=null, dots=null, beacon=null, slotMark=null;
let palletOnFork=null, palletOnRack=null, carriage=null;
let scenId='issue';
const st={ readAt:null, rows:-1 };

/* ================= pallet + karton ber-tag ================= */
function makePallet(){
  const g=new THREE.Group();
  const deck=new THREE.Mesh(new THREE.BoxGeometry(1.25,.09,.85),palMat);
  deck.position.y=.12; g.add(deck);
  for(const sx of [-.5,0,.5]){
    const blk=new THREE.Mesh(new THREE.BoxGeometry(.16,.12,.85),palMat);
    blk.position.set(sx*1.0,.06,0); g.add(blk);
  }
  // 6 karton = 6 tag RFID, tag digambar sebagai label putih kecil di sisi karton
  let n=0;
  for(let r=0;r<3;r++) for(let c=0;c<2;c++){
    const b=new THREE.Mesh(boxGeo, n%2 ? boxMat2 : boxMat);
    b.position.set(-.38+r*.38, .38, -.2+c*.4); g.add(b);
    const tag=new THREE.Mesh(new THREE.PlaneGeometry(.16,.1),tagMat);
    tag.position.set(b.position.x, .40, b.position.z + (c ? .181 : -.181));
    tag.rotation.y = c ? 0 : Math.PI; g.add(tag);
    n++;
  }
  return g;
}

/* ================= rak pallet ================= */
function makeRacks(){
  const g=new THREE.Group();
  const LVL=[.6,2.0,3.4];
  ROWS.forEach(z=>{
    for(let i=0;i<7;i++){
      const x=-9+i*3;
      for(const sz of [-1,1]){
        const u=new THREE.Mesh(uprGeo,uprMat);
        u.position.set(x,2.3,z+sz*1.25); g.add(u);
      }
      if(i<6) LVL.forEach(y=>{
        for(const sz of [-1,1]){
          const b=new THREE.Mesh(beamGeo,rackMat);
          b.position.set(x+1.5,y,z+sz*1.25); b.rotation.y=Math.PI/2;
          b.scale.z=3.0/2.6; g.add(b);
        }
      });
    }
  });
  // karton di rak, instanced supaya murah
  const spots=[];
  ROWS.forEach(z=>{ LVL.forEach(y=>{
    for(let i=0;i<6;i++){
      const bx=-9+i*3+1.5;
      for(let k=0;k<2;k++) for(let c=0;c<2;c++){
        // sisakan slot kosong tepat di tempat pallet diambil / disimpan
        if(Math.abs(bx-LIFT_X)<.1 && z===ROWS[1] && y===LVL[0]) continue;
        spots.push([bx-.45+k*.9, y+.42, z-.2+c*.4]);
      }
    }
  });});
  const im=new THREE.InstancedMesh(boxGeo,boxMat,spots.length);
  spots.forEach((p,i)=>{ dummy.position.set(p[0],p[1],p[2]); dummy.rotation.set(0,0,0);
    dummy.updateMatrix(); im.setMatrixAt(i,dummy.matrix); });
  g.add(im);
  return g;
}

/* ================= forklift ================= */
function makeForklift(){
  // core memakai yaw = atan2(dx,dz), jadi sisi DEPAN model harus di local +z.
  // Model di bawah dibangun menghadap -z, lalu seluruhnya diputar 180°.
  const outer=new THREE.Group();
  const g=new THREE.Group(); g.rotation.y=Math.PI; outer.add(g);
  const body =new THREE.MeshStandardMaterial({color:C.fork,roughness:.5,metalness:.3});
  const dark  =new THREE.MeshStandardMaterial({color:C.forkDark,roughness:.6,metalness:.3});
  const steel =new THREE.MeshStandardMaterial({color:C.steelDark,roughness:.45,metalness:.6});
  const tyre  =new THREE.MeshStandardMaterial({color:C.tyre,roughness:.9});

  // badan + penyeimbang di belakang
  const chassis=new THREE.Mesh(new THREE.BoxGeometry(1.15,.55,2.0),body);
  chassis.position.set(0,.62,.35); g.add(chassis);
  const counter=new THREE.Mesh(new THREE.BoxGeometry(1.05,.7,.6),dark);
  counter.position.set(0,.72,1.25); g.add(counter);
  const hood=new THREE.Mesh(new THREE.BoxGeometry(1.0,.42,.85),body);
  hood.position.set(0,1.06,.85); g.add(hood);
  const seat=new THREE.Mesh(new THREE.BoxGeometry(.5,.4,.45),dark);
  seat.position.set(0,1.12,.42); g.add(seat);

  // roda
  [[-.62,-.55],[.62,-.55],[-.52,1.05],[.52,1.05]].forEach(([x,z],i)=>{
    const r=i<2?.34:.26;
    const w=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.22,14),tyre);
    w.rotation.z=Math.PI/2; w.position.set(x,r,z); g.add(w);
  });

  // atap pelindung operator
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const p=new THREE.Mesh(new THREE.BoxGeometry(.07,1.35,.07),steel);
    p.position.set(sx*.52,1.85,sz===-1?-.15:1.05); g.add(p);
  }
  const roof=new THREE.Mesh(new THREE.BoxGeometry(1.2,.08,1.35),steel);
  roof.position.set(0,2.55,.45); g.add(roof);

  // mast di depan
  for(const sx of [-1,1]){
    const rail=new THREE.Mesh(new THREE.BoxGeometry(.11,2.9,.13),steel);
    rail.position.set(sx*.42,1.48,-.72); g.add(rail);
  }
  const mastTop=new THREE.Mesh(new THREE.BoxGeometry(.95,.1,.13),steel);
  mastTop.position.set(0,2.9,-.72); g.add(mastTop);

  // carriage + garpu (naik-turun)
  carriage=new THREE.Group(); g.add(carriage);
  const plate=new THREE.Mesh(new THREE.BoxGeometry(.95,.5,.08),steel);
  plate.position.set(0,.3,-.78); carriage.add(plate);
  for(const sx of [-1,1]){
    const f=new THREE.Mesh(new THREE.BoxGeometry(.12,.05,1.15),steel);
    f.position.set(sx*.28,.07,-1.35); carriage.add(f);
  }
  palletOnFork=makePallet();
  palletOnFork.position.set(0,.08,-1.42);
  palletOnFork.visible=false; carriage.add(palletOnFork);

  // operator duduk
  const torso=new THREE.Mesh(new THREE.BoxGeometry(.36,.5,.28),
    new THREE.MeshStandardMaterial({color:0xC9A227,roughness:.8}));
  torso.position.set(0,1.55,.3); g.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.14,10,8),
    new THREE.MeshStandardMaterial({color:C.officer,roughness:.6}));
  head.position.set(0,1.9,.3); g.add(head);

  // lampu rotari — penanda visual paling cepat dikenali sebagai forklift
  beacon=new THREE.Mesh(new THREE.SphereGeometry(.1,10,8),
    new THREE.MeshStandardMaterial({color:0xF0A21C,emissive:0xF0A21C,emissiveIntensity:1}));
  beacon.position.set(0,2.68,.45); g.add(beacon);

  return outer;
}

/* ================= layar WMS ================= */
function drawWMS(rows){
  const recv = scenId==='receiving';
  const {cx,cv}=wms, W=cv.width, H=cv.height;
  cx.fillStyle='#0F1424'; cx.fillRect(0,0,W,H);
  cx.fillStyle='#1B2540'; cx.fillRect(0,0,W,72);
  cx.fillStyle='#3ED0C2'; cx.font='700 40px "Segoe UI",sans-serif';
  cx.textAlign='left'; cx.textBaseline='middle';
  cx.fillText(recv ? 'WMS  ·  GOODS RECEIPT' : 'WMS  ·  GOODS ISSUE', 28, 38);
  cx.fillStyle='#98A0B3'; cx.font='500 26px "Segoe UI",sans-serif';
  cx.fillText((recv?'GRN-1174':'DO-2481')+'  ·  Dock 1', W-330, 38);

  cx.font='600 27px ui-monospace,Consolas,monospace';
  cx.fillStyle='#5B6478';
  cx.fillText('SKU',28,108); cx.fillText('ITEM',250,108);
  cx.fillText('QTY',640,108); cx.fillText(recv?'PUTAWAY':'STATUS',740,108);
  cx.strokeStyle='#2A3358'; cx.lineWidth=2;
  cx.beginPath(); cx.moveTo(28,128); cx.lineTo(W-28,128); cx.stroke();

  LOAD.forEach((r,i)=>{
    if(i>=rows) return;
    const y=170+i*54;
    cx.fillStyle='#E8EAF2'; cx.font='600 28px ui-monospace,Consolas,monospace';
    cx.fillText(r.sku,28,y);
    cx.fillStyle='#98A0B3'; cx.fillText(r.name,250,y);
    cx.fillStyle='#E8EAF2'; cx.fillText('x'+r.qty,640,y);
    cx.fillStyle='#46C46E'; cx.fillText(recv ? r.loc : '✓ OK', 740, y);
  });

  const done = rows>=LOAD.length;
  cx.fillStyle = done ? '#46C46E' : '#5B6478';
  cx.font='700 30px "Segoe UI",sans-serif';
  cx.fillText(done
      ? TAG_TOTAL+' tag terbaca  ·  0 input manual  ·  '+(recv?'lokasi simpan ditentukan':'stok ter-update')
      : 'menunggu pallet melewati gate…', 28, H-42);
  wms.flush();
}

function makeWMS(){
  wms=S.makeScreen(3.4,2.0,900,530);
  const g=new THREE.Group();
  g.position.set(WMS_POS[0],0,WMS_POS[2]);
  g.rotation.y=.72;                       // menghadap kamera default
  const steel=new THREE.MeshStandardMaterial({color:C.steelDark,roughness:.5,metalness:.6});
  // tiang berhenti di tepi bawah bezel dan berada di BELAKANG layar (z negatif),
  // kalau tidak ia menembus layar dan tampak sebagai garis vertikal di tengah
  const bezelY=WMS_POS[1]+1.0, poleH=bezelY-1.1;
  const pole=new THREE.Mesh(new THREE.BoxGeometry(.14,poleH,.14),steel);
  pole.position.set(0,poleH/2,-.08); g.add(pole);
  const foot=new THREE.Mesh(new THREE.BoxGeometry(.8,.06,.5),steel);
  foot.position.set(0,.03,-.08); g.add(foot);
  const bezel=new THREE.Mesh(new THREE.BoxGeometry(3.6,2.2,.1),
    new THREE.MeshStandardMaterial({color:C.station,roughness:.6}));
  bezel.position.y=bezelY; g.add(bezel);
  wms.mesh.position.set(0,bezelY,.06); g.add(wms.mesh);
  return g;
}

/* ================= titik data gate → WMS ================= */
function makeDots(){
  const g=new THREE.Group();
  const mat=new THREE.MeshBasicMaterial({color:C.screen});
  for(let i=0;i<6;i++){
    const d=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),mat);
    d.visible=false; g.add(d);
  }
  return g;
}
const DOT_A=new THREE.Vector3(0,2.9,GATE_Z);
const DOT_B=new THREE.Vector3(WMS_POS[0]-.35,WMS_POS[1]+1.0,WMS_POS[2]+.3);

function tickDots(el){
  const active = el>.25 && el<2.6;
  dots.children.forEach((d,i)=>{
    const t=(el*.8 - i*.13);
    if(!active || t<0 || t>1){ d.visible=false; return; }
    d.visible=true;
    d.position.lerpVectors(DOT_A,DOT_B,t);
    d.position.y += Math.sin(t*Math.PI)*.9;      // lengkung ke atas
    d.scale.setScalar(.7+Math.sin(t*Math.PI)*.6);
  });
}

/* ================= gerak garpu ================= */
/* issue: angkat pallet dari rak lalu turun ke ketinggian jalan */
function liftFromRack(ct, win){
  const pk=win.pick;
  if(!pk) return .35;
  if(ct < pk[0]+.7){                       // garpu masuk di ketinggian rak
    palletOnFork.visible=false; palletOnRack.visible=true;
    return .54;
  }
  if(ct < pk[1]){                          // pallet terangkat lepas dari rak
    palletOnFork.visible=true; palletOnRack.visible=false;
    return .54+Math.min(1,(ct-pk[0]-.7)/.9)*.45;
  }
  palletOnFork.visible=true; palletOnRack.visible=false;
  return .35;                              // turun ke ketinggian jalan
}
/* receiving: naik ke level rak, lepas pallet, lalu garpu kosong turun */
function putawayToRack(ct, win){
  const so=win.store;
  if(!so || ct < so[0]){                   // masih membawa pallet menuju rak
    palletOnFork.visible=true; palletOnRack.visible=false;
    return .35;
  }
  const el=ct-so[0];
  if(el < .9){                             // angkat ke level rak
    palletOnFork.visible=true; palletOnRack.visible=false;
    return .35+(el/.9)*.19;
  }
  const placed = el >= 1.2;                // pallet berpindah ke rak
  palletOnFork.visible=!placed; palletOnRack.visible=placed;
  if(slotMark) slotMark.visible=!placed;
  return placed ? .35 : .54;
}

/* ================= registrasi ================= */
S.register('warehouse',{
  label:'Gudang · RFID → WMS',
  title:'Gudang &middot; RFID &rarr; WMS',
  sub:'Forklift melintas gate, stok tercatat otomatis',
  room:{w:ROOM.w,d:ROOM.d,h:ROOM.h,doorW:DOOR_W,doorH:DOOR_H,markZ:GATE_Z,markW:4.2},
  cam:{theta:.66,phi:1.02,r:27,target:[0,1.4,.5],topR:24},
  speed:1.7,
  smoothTurn:true,
  theme:{ light:{floor:0xAEB4BE}, dark:{floor:0x22262F} },
  legend:[
    ['#E07A18','Rak pallet'],['#C9A46B','Karton ber-tag RFID'],
    ['#F0A21C','Forklift'],['#B9BEC9','Antena RFID gate'],
    ['#3ED0C2','WMS / aliran data'],['#2E9E57','Tag terbaca']
  ],
  scenarios:{
    issue:{
      label:'Barang keluar (delivery)',
      note:'Forklift <b>tidak berhenti</b> di gate. Enam tag terbaca sekaligus saat pallet melintas, lalu WMS mencatat pengeluaran stok seketika. Tidak ada scan manual, tidak ada salah ketik, tidak ada antrean di dock.'
    },
    receiving:{
      label:'Barang masuk (receiving) — putaway',
      note:'Pallet masuk dari dock. Gate membaca enam tag saat melintas, WMS langsung mencatat penerimaan <b>dan menentukan lokasi simpan</b> ('+SLOT+'). Operator tidak perlu mengetik apa pun, tidak perlu menebak rak mana yang kosong.',
      text:{
        walk:'Forklift membawa pallet masuk dari area dock',
        wmssend:'Data terkirim ke WMS &mdash; <b>penerimaan barang tercatat</b>',
        putaway:'WMS menentukan lokasi simpan &mdash; <b>'+SLOT+'</b>',
        store:'Menyimpan pallet ke rak sesuai arahan WMS',
        idle:'Selesai &mdash; <b>'+TAG_TOTAL+' tag, 0 scan manual, lokasi tercatat</b>'
      }
    }
  },
  flowText:{
    walk:'Forklift bergerak di area gudang',
    pick:'Mengambil pallet dari rak &mdash; <b>3 SKU, '+TAG_TOTAL+' karton ber-tag RFID</b>',
    gateread:'Melintas RFID gate <b>tanpa berhenti</b> &mdash; '+TAG_TOTAL+' tag terbaca sekaligus',
    wmssend:'Data terkirim ke WMS &mdash; <b>otomatis, tanpa input manual</b>',
    putaway:'WMS menentukan lokasi simpan',
    store:'Menyimpan pallet ke rak',
    out:'Barang keluar &mdash; <b>stok WMS sudah ter-update</b>',
    idle:'Selesai &mdash; <b>'+TAG_TOTAL+' tag, 0 scan manual, 0 salah input</b>'
  },

  build(variant, scen){
    scenId=scen;
    const recv = scen==='receiving';

    S.groups.concept.add(makeRacks());
    // h:2.9 — palang atas harus di atas lampu rotari forklift (puncak 2.78 m)
    gate=S.makeGate({z:GATE_Z,span:3.8,h:2.9,beam:true});
    S.groups.concept.add(gate.grp);
    S.groups.concept.add(makeWMS());
    dots=makeDots(); S.groups.concept.add(dots);

    palletOnRack=makePallet();
    palletOnRack.position.set(LIFT_X,.62,RACK_Z);
    S.groups.concept.add(palletOnRack);

    // penanda slot tujuan — hanya bermakna pada alur receiving
    slotMark=null;
    if(recv){
      slotMark=new THREE.Mesh(new THREE.BoxGeometry(1.35,.78,.95),
        new THREE.MeshBasicMaterial({color:C.screen,transparent:true,opacity:.18,
          side:THREE.DoubleSide,depthWrite:false}));
      slotMark.position.set(LIFT_X,.99,RACK_Z);
      S.groups.concept.add(slotMark);
      S.addLabel(SLOT,'#3ED0C2',LIFT_X,1.85,RACK_Z,1.1);
    }

    S.addLabel('RAK PALLET',null,-6.5,4.6,ROWS[0],1.3);
    S.addLabel('RFID GATE','#E9EBEE',-3.6,3.8,GATE_Z,1.3);
    S.addLabel('WMS','#3ED0C2',WMS_POS[0]-1.4,WMS_POS[1]+2.5,WMS_POS[2],1.3);
    S.addLabel('PINTU DOCK','#E8EAF2',0,DOOR_H+.6,ROOM.d/2,1.3);

    S.actor=makeForklift();
    st.readAt=null; st.rows=-1;

    return {
      wps:WPS[scen],
      stats:'<b>Rak</b> : 2 baris &times; 6 bay &times; 3 level<br>'
        +'<b>Gate</b> : 1 portal &middot; 2 antena samping + 1 atas<br>'
        +'<b>Reader</b> : 1 unit 4-port di gate<br>'
        +'<b>Muatan</b> : 3 SKU &middot; '+TAG_TOTAL+' karton ber-tag<br>'
        +'<b>Arah</b> : '+(recv?'masuk &mdash; GRN-1174':'keluar &mdash; DO-2481')+'<br>'
        +'<b>Gudang</b> : 22 &times; 14 &times; 6.5 m'
    };
  },

  reset(){
    const recv = scenId==='receiving';
    palletOnFork.visible = recv;            // receiving mulai dengan pallet di garpu
    palletOnRack.visible = !recv;           // issue mulai dengan pallet di rak
    carriage.position.y = recv ? .35 : 0;
    if(slotMark) slotMark.visible=true;
    gate.reset();
    st.readAt=null; st.rows=-1;
    dots.children.forEach(d=>d.visible=false);
    drawWMS(0);
  },

  tick(ct, seg, win, actor){
    beacon.material.emissiveIntensity = .4+.9*(Math.sin(ct*9)>0?1:0);

    const carY = scenId==='receiving' ? putawayToRack(ct,win) : liftFromRack(ct,win);
    carriage.position.y += (carY-carriage.position.y)*.12;

    /* --- gate membaca sambil pallet melintas, tanpa dwell --- */
    /* pakai jarak absolut supaya berlaku untuk arah masuk maupun keluar */
    if(palletOnFork.visible && st.readAt===null &&
       Math.abs(actor.position.z-GATE_Z) < READ_BAND){
      st.readAt=ct;
    }
    if(st.readAt===null) return null;

    const el=ct-st.readAt;
    gate.setState('ok', el<.5 ? (el%.16)<.08 : true);   // kedip singkat lalu hijau tetap
    tickDots(el);

    const rows=Math.max(0, Math.min(LOAD.length, Math.floor((el-.55)/.34)));
    if(rows!==st.rows){ st.rows=rows; drawWMS(rows); }

    // setelah data masuk WMS, biarkan mode segmen yang bicara (walk → store → idle)
    if(scenId==='receiving')
      return { flow: el<.55 ? 'gateread' : (el<1.7 ? 'wmssend' : (el<2.8 ? 'putaway' : null)) };
    return { flow: el<.55 ? 'gateread' : (el<2.6 ? 'wmssend' : 'out') };
  },

  idle(t){
    if(beacon) beacon.material.emissiveIntensity=.35+.25*Math.sin(t*3);
  }
});
})(window.SIMLAY);
