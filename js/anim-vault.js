/* ============================================================
   Gold Vault · RFID — studi tata letak rak & verifikasi keluar-masuk
   ============================================================ */
"use strict";
(function(S){
const C=S.C;
const ROOM={w:12,d:8,h:3.2};
const GATE_Z=ROOM.d/2-.45;

/* geometry & material yang dipakai ulang antar build */
const postGeo =S.shared(new THREE.BoxGeometry(.06,1.9,.06));
const shelfGeo=S.shared(new THREE.BoxGeometry(1.24,.05,.5));
const barGeo  =S.shared(new THREE.BoxGeometry(.24,.05,.08));
const rackMat =S.shared(new THREE.MeshStandardMaterial({color:C.rackBlue,roughness:.55,metalness:.3}));
const deckMat =S.shared(new THREE.MeshStandardMaterial({color:C.deck,roughness:.85}));
const goldMat =S.shared(new THREE.MeshStandardMaterial({color:C.gold,roughness:.3,metalness:1.0}));
const dummy=new THREE.Object3D();

let station=null, door=null, gate=null, goldInHand=null, curScen='ok';

function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

function buildRacks(origins){
  const posts=[], shelves=[], bars=[];
  const rng=mulberry(42);
  origins.forEach(o=>{
    for(const sx of [-1,1]) for(const sz of [-1,1]) posts.push([o.x+sx*.62,.95,o.z+sz*.24]);
    [.16,.62,1.08,1.54].forEach(y=>{
      shelves.push([o.x,y,o.z]);
      for(let i=0;i<4;i++) for(let j=0;j<2;j++){
        if(rng()<.9) bars.push([o.x-.51+.17+i*.28+(rng()-.5)*.02, y+.055,
                                o.z-.12+j*.24+(rng()-.5)*.02]);
      }
    });
  });
  const inst=(geo,mat,list)=>{
    const im=new THREE.InstancedMesh(geo,mat,list.length);
    list.forEach((p,i)=>{ dummy.position.set(p[0],p[1],p[2]); dummy.rotation.set(0,0,0);
      dummy.updateMatrix(); im.setMatrixAt(i,dummy.matrix); });
    return im;
  };
  const g=new THREE.Group();
  g.add(inst(postGeo,rackMat,posts));
  g.add(inst(shelfGeo,deckMat,shelves));
  g.add(inst(barGeo,goldMat,bars));
  return g;
}

function makeStation(x,z,rotY){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=rotY||0;
  const mat=new THREE.MeshStandardMaterial({color:C.station,roughness:.6});
  const base=new THREE.Mesh(new THREE.BoxGeometry(.5,.18,.4),mat); base.position.y=.14; g.add(base);
  const col=new THREE.Mesh(new THREE.BoxGeometry(.09,.7,.09),mat); col.position.y=.58; g.add(col);
  const scr=new THREE.Mesh(new THREE.BoxGeometry(.44,.32,.05),mat);
  scr.position.set(0,1.05,.06); scr.rotation.x=-.55; g.add(scr);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(.38,.26),
    new THREE.MeshStandardMaterial({color:C.screen,emissive:C.screen,emissiveIntensity:.7}));
  face.position.set(0,1.06,.095); face.rotation.x=-.55; g.add(face);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.72,.9,40),
    new THREE.MeshBasicMaterial({color:C.ring,transparent:true,opacity:.4,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2; ring.position.y=.02; g.add(ring);
  const pulse=new THREE.Mesh(new THREE.RingGeometry(.2,.26,40),
    new THREE.MeshBasicMaterial({color:C.ring,transparent:true,opacity:0,side:THREE.DoubleSide}));
  pulse.rotation.x=-Math.PI/2; pulse.position.y=.03; g.add(pulse);
  station={grp:g,ring,pulse};
  return g;
}

function makeDoor(){
  const g=new THREE.Group();
  const fmat=new THREE.MeshStandardMaterial({color:0x3A4368,roughness:.6});
  for(const sx of [-1,1]){
    const jamb=new THREE.Mesh(new THREE.BoxGeometry(.12,2.2,.16),fmat);
    jamb.position.set(sx*.86,1.1,ROOM.d/2); g.add(jamb);
  }
  const head=new THREE.Mesh(new THREE.BoxGeometry(1.9,.14,.16),fmat);
  head.position.set(0,2.24,ROOM.d/2); g.add(head);
  const panel=new THREE.Mesh(new THREE.BoxGeometry(1.6,2.15,.07),
    new THREE.MeshStandardMaterial({color:C.door,roughness:.5,metalness:.3}));
  panel.position.set(0,1.08,ROOM.d/2); g.add(panel);
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(.06,10,8),
    new THREE.MeshStandardMaterial({color:C.alert,emissive:C.alert,emissiveIntensity:1}));
  lamp.position.set(1.05,2.05,ROOM.d/2+.1); g.add(lamp);
  const spkBox=new THREE.Mesh(new THREE.BoxGeometry(.26,.34,.08),
    new THREE.MeshStandardMaterial({color:C.station,roughness:.6}));
  spkBox.position.set(1.35,1.25,ROOM.d/2+.06); g.add(spkBox);
  const spkScr=new THREE.Mesh(new THREE.PlaneGeometry(.2,.22),
    new THREE.MeshStandardMaterial({color:C.screen,emissive:C.screen,emissiveIntensity:.7}));
  spkScr.position.set(1.35,1.27,ROOM.d/2+.105); g.add(spkScr);
  door={panel,lamp,open:0};
  return g;
}

function makeOfficer(){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.16,.2,.85,10),
    new THREE.MeshStandardMaterial({color:0x3D4763,roughness:.7}));
  body.position.y=.55; g.add(body);
  const vest=new THREE.Mesh(new THREE.CylinderGeometry(.175,.2,.4,10),
    new THREE.MeshStandardMaterial({color:0xC9A227,roughness:.8}));
  vest.position.y=.7; g.add(vest);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.14,10,8),
    new THREE.MeshStandardMaterial({color:C.officer,roughness:.6}));
  head.position.y=1.12; g.add(head);
  goldInHand=new THREE.Group();          // 3 batang; jumlah tampil diatur skenario
  for(let i=0;i<3;i++){
    const b=new THREE.Mesh(new THREE.BoxGeometry(.22,.1,.14),goldMat);
    b.position.set(.22,.68+i*.115,.1); goldInHand.add(b);
  }
  goldInHand.visible=false; g.add(goldInHand);
  return g;
}

/* ================= varian tata letak ================= */
const VARIANTS={
  1:{
    label:'Konsep 1 · Satu sisi',
    stats:'<b>Rak</b> : 7 unit (dinding belakang)<br><b>Antena rak</b> : 4 langit-langit, diarahkan ke rak<br><b>Reader</b> : 1 unit &middot; 4 port<br><b>Station</b> : kiri-tengah &middot; masuk &amp; keluar via SPK',
    note:'Antena langit-langit = pemantauan area. Kontrol akses sepenuhnya lewat SPK &amp; verifikasi di station.',
    toDoor:[],                                  // dari rak ke pintu: lintasan bebas
    build(){
      const origins=[]; for(let i=0;i<7;i++) origins.push({x:-4.5+i*1.5,z:-3.55});
      S.groups.concept.add(buildRacks(origins));
      for(let i=0;i<4;i++){
        const x=-4.5+i*3;
        S.groups.concept.add(S.makeAntenna(new THREE.Vector3(x,ROOM.h-.15,-1.1),
          new THREE.Vector3(x,1.0,-3.55), 3.4, 1.5));
      }
      S.addLabel('RAK EMAS',null,0,2.6,-3.55);
      S.addLabel('ANTENA RFID','#E9EBEE',3.2,3.5,-1.1);
      return [
        {x:.6,z:5.0},{x:1.15,z:4.55,dwell:1.6,event:'spk'},
        {x:0,z:4.4},{x:0,z:3.3,dwell:.3,event:'enterin'},
        {x:-2.2,z:-2.5,dwell:1.4,event:'pick'},
        {x:-4.25,z:0,dwell:2.2,event:'scan'},
        {x:0,z:3.5,dwell:.6,event:'waitdoor'},{x:0,z:4.9}
      ];
    }
  },
  2:{
    label:'Konsep 2 · Penuh rak',
    stats:'<b>Rak</b> : 15 unit (3 baris &times; 5 rak)<br><b>Antena rak</b> : 24 (2 per level &times; 4 level &times; 3 baris)<br><b>Reader</b> : 3 unit 8-port (1 per baris)<br><b>Station</b> : kiri-tengah &middot; masuk &amp; keluar via SPK',
    note:'Antena kiri-kanan per level: zona baca terfokus per level rak, risiko cross-read antar baris kecil.',
    toDoor:[{x:4.5,z:-.55},{x:4.5,z:1.0},{x:2.0,z:1.6}],   // memutar lorong kanan, rak menghalangi
    build(){
      const rows=[-3.55,-1.55,.45];
      const origins=[];
      rows.forEach(z=>{ for(let i=0;i<5;i++) origins.push({x:-3+i*1.5,z}); });
      S.groups.concept.add(buildRacks(origins));
      const LVL_Y=[.36,.82,1.28,1.74];
      const poleMat=new THREE.MeshStandardMaterial({color:C.rackDark,roughness:.55,metalness:.3});
      rows.forEach(z=>{
        for(const sx of [-1,1]){
          const px=sx*4.05;
          const pole=new THREE.Mesh(new THREE.BoxGeometry(.05,1.95,.05),poleMat);
          pole.position.set(px,.975,z); S.groups.concept.add(pole);
          LVL_Y.forEach(y=>{
            S.groups.concept.add(S.makeAntenna(new THREE.Vector3(px,y,z),
              new THREE.Vector3(-sx*4.05,y,z), 8.0, .3, .09));
          });
        }
      });
      S.addLabel('RAK EMAS',null,0,2.6,-1.55);
      S.addLabel('ANTENA PER LEVEL','#E9EBEE',-4.05,2.35,.45);
      return [
        {x:.6,z:5.0},{x:1.15,z:4.55,dwell:1.6,event:'spk'},
        {x:0,z:4.4},{x:0,z:3.3,dwell:.3,event:'enterin'},
        {x:2.0,z:1.6},{x:4.5,z:1.0},{x:4.5,z:-.55},
        {x:-.5,z:-.55,dwell:1.4,event:'pick'},
        {x:-4.25,z:-.55},{x:-4.25,z:0,dwell:2.2,event:'scan'},
        {x:-4.25,z:1.4},{x:-1.5,z:2.4},{x:0,z:3.5,dwell:.6,event:'waitdoor'},{x:0,z:4.9}
      ];
    }
  }
};

/* ================= skenario =================
   wps() menerima waypoint normal milik varian dan mengembalikan versi skenario,
   jadi jalur khusus varian (memutar rak) tidak perlu ditulis dua kali. */
const SPK_QTY=2;
const SCENARIOS={
  ok:{
    label:'Normal — sesuai SPK',
    bars:SPK_QTY,
    wps:w=>w
  },
  surplus:{
    label:'Ambil lebih dari SPK — station dilewati',
    bars:SPK_QTY+1,
    note:'Ambil 3 batang untuk SPK 2 batang, lalu lewati RFID Station. Gate di ambang pintu tetap membaca semua tag &rarr; mismatch, pintu tidak terbuka. Sembunyi di kantong tidak menolong: UHF RFID tembus kain, plastik, dan kulit.',
    end:'<b>DITOLAK</b> &mdash; gate membaca 3 tag vs SPK 2 batang &middot; pintu terkunci, petugas tertahan di dalam',
    text:{
      pick:'Mengambil <b>3 batang</b> untuk SPK 2 batang &mdash; 1 di luar perintah',
      denied:'Gate membaca <b>3 tag</b> vs SPK <b>2 batang</b> &mdash; MISMATCH, pintu tidak terbuka',
      idle:'Pintu tetap terkunci &mdash; <b>petugas tidak bisa keluar</b>'
    },
    wps:(w,v)=>{
      const i=w.findIndex(p=>p.event==='pick');
      return w.slice(0,i)
        .concat([Object.assign({},w[i],{dwell:1.9})])       // ambil batang ekstra, sedikit lebih lama
        .concat(VARIANTS[v].toDoor)
        .concat([{x:0,z:GATE_Z,dwell:4.0,event:'denied'}]);
    }
  }
};

S.register('vault',{
  label:'Gold Vault · RFID',
  title:'Gold Vault &middot; RFID',
  sub:'Studi tata letak &amp; verifikasi keluar-masuk',
  room:{w:ROOM.w,d:ROOM.d,h:ROOM.h,doorW:1.6,doorH:2.2,markZ:GATE_Z,markW:2.2},
  cam:{theta:.72,phi:1.08,r:16.5,target:[0,.9,.4],topR:15.5},
  speed:1.5,
  variants:VARIANTS,
  scenarios:SCENARIOS,
  legend:[
    ['#2A3268','Rak emas'],['#C79A22','Emas / zona baca'],
    ['#B9BEC9','Antena RFID'],['#0FA3A3','RFID Station / SPK'],
    ['#2E9E57','Pintu terbuka'],['#D6373C','Pintu terkunci']
  ],
  flowText:{
    walk:'Petugas bergerak &mdash; <b>mengikuti jalur</b>',
    spk:'Scan SPK di panel masuk &mdash; <b>validasi surat perintah kerja</b>',
    enterin:'SPK valid &mdash; <b>petugas masuk, pintu menutup otomatis</b>',
    pick:'Mengambil emas sesuai SPK &mdash; <b>tag RFID ikut terbawa</b>',
    scan:'Verifikasi di RFID Station &mdash; <b>mencocokkan tag vs SPK</b>',
    waitdoor:'Semua tag sesuai &mdash; <b>pintu terbuka, petugas keluar</b>',
    denied:'Gate menolak &mdash; <b>pintu tidak terbuka</b>',
    idle:'Petugas keluar &mdash; <b>pintu terkunci kembali</b>'
  },

  build(variant, scen){
    curScen=scen;
    const SCEN=SCENARIOS[scen];
    S.groups.concept.add(makeStation(-4.9,0,Math.PI/2));
    S.groups.concept.add(makeDoor());
    gate=S.makeGate({z:GATE_Z,span:1.9,h:1.9});
    S.groups.concept.add(gate.grp);
    S.addLabel('RFID GATE','#E9EBEE',-2.7,1.45,GATE_Z);
    S.addLabel('RFID STATION','#3ED0C2',-4.6,1.9,0);
    S.addLabel('PINTU','#E8EAF2',0,2.8,4.0);
    S.addLabel('SCAN SPK','#3ED0C2',1.9,1.7,4.35);

    const wps=SCEN.wps(VARIANTS[variant].build(), variant);
    S.actor=makeOfficer();
    goldInHand.children.forEach((b,i)=>b.visible = i<SCEN.bars);

    return {
      wps,
      stats:VARIANTS[variant].stats
        + '<br><b>Ruangan</b> : 12 &times; 8 &times; 3.2 m'
        + '<br><b>SPK</b> : '+SPK_QTY+' batang &middot; <b>dibawa</b> : '+SCEN.bars+' batang',
      note:VARIANTS[variant].note
    };
  },

  reset(){
    goldInHand.visible=false;
    door.open=0; door.panel.position.x=0;
    door.lamp.material.color.setHex(C.alert);
    door.lamp.material.emissive.setHex(C.alert);
    station.pulse.material.opacity=0;
    gate.reset();
  },

  tick(ct, seg, win){
    const mode=seg.ev||seg.type;

    const pk=win.pick;
    // pada skenario gagal emas tetap di tangan saat idle — petugas belum keluar
    goldInHand.visible = pk && ct>pk[1]-.05 && (seg.type!=='idle' || curScen!=='ok');

    const sc=win.scan;
    if(sc && ct>=sc[0] && ct<sc[1]){
      const k=((ct-sc[0])%.8)/.8;
      station.pulse.scale.setScalar(.4+k*3.2);
      station.pulse.material.opacity=.5*(1-k);
      station.ring.material.opacity=.65;
    }else station.pulse.material.opacity=0;

    const spk=win.spk, ein=win.enterin;
    const entryOpen = spk && ein && ct>spk[1]-.2 && ct<ein[1]+.25;
    const exitOpen  = sc && ct>sc[1]-.2 && seg.type!=='idle';
    door.open += ((entryOpen||exitOpen ? 1:0)-door.open)*.12;
    door.panel.position.x = -door.open*1.55;
    const lampC = door.open>.5 ? C.ok : C.alert;
    door.lamp.material.color.setHex(lampC);
    door.lamp.material.emissive.setHex(lampC);

    // gate: hijau saat cocok, merah berkedip saat mismatch
    const dn=win.denied, wd=win.waitdoor;
    if(dn && ct>=dn[0])      gate.setState('alert', ((ct-dn[0])%.6)<.3);
    else if(wd && ct>=wd[0]-.3) gate.setState('ok', true);

    return { bad: curScen!=='ok' && (mode==='denied'||mode==='idle') };
  },

  idle(t){
    station.ring.material.opacity=.32+.08*Math.sin(t*2);
    if(door.open>.001){
      door.open += (0-door.open)*.12;
      door.panel.position.x = -door.open*1.55;
    }
  },

  onTheme(name,t){ if(station&&station.ring) station.ring.material.color.setHex(t.ring); }
});
})(window.SIMLAY);
