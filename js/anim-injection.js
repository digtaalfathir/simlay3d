/* ============================================================
   Injection Molding · Shot Counter → Monitoring
   Mesin injection besar mencetak bumper. Mold terbuka, robot takeout
   mengambil dari atas, melepasnya ke seluncuran, bumper turun ke meja
   operator, dicek, lalu disimpan ke rak. Setiap shot dihitung otomatis
   oleh panel akuisisi di depan mesin dan tampil di TV monitoring.
   Rak penuh (3 pcs) -> printer mencetak label sendiri.

   Aktor timeline = OPERATOR (satu-satunya yang berjalan di lantai).
   Mesin, robot, dan bumper digerakkan dari window timeline di tick().
   ============================================================ */
"use strict";
(function(S){
const C=S.C;
const ROOM={w:22,d:13,h:6.5};

/* ---- tata letak ---- */
/* Jarak platen menentukan tebal mold: muka platen tetap di -5.325, muka platen
   bergerak saat tertutup di -3.475 → celah 1.85 m → tiap paruh mold 0.92 m.
   Kalau PLATEN_CLOSED digeser, MOLD_T harus ikut atau kedua paruh saling tembus. */
const PLATEN_W=0.55;                // tebal platen
const PLATEN_Y=2.1;                 // tinggi pusat platen & mold
const PLATEN_H=3.2;
const MACH_TOP=PLATEN_Y+PLATEN_H/2; // 3.7 — puncak platen, batas bawah lintasan robot
const FIX_X=-5.6;                   // platen tetap
const END_X=0.6;                    // end plate
const BED_X1=0.8;                   // ujung +x rangka mesin
const PART_W=0.30;                  // tebal bumper
const PART_H=0.42;
const PART_L=2.6;                   // panjang bumper — penentu lebar seluncuran, meja, rak
const PLATEN_CLOSED=-3.2;
const PLATEN_OPEN=-1.4;
const MOLD_T=0.92;                  // tebal satu paruh mold
const MOLD_FIX_X=-4.865;            // pusat paruh tetap
const MOLD_MOVE_OFF=-0.745;         // pusat paruh bergerak, relatif platen
const PART_OFF=-1.355;              // part menempel di muka paruh bergerak
const RAIL_Y=5.4;                   // rel robot, di atas MACH_TOP
const RAIL_X1=3.0;                  // ujung rel; menjorok di luar mesin seperti gantry asli
const ARM_MIN=0.70;                 // panjang arm tertarik
const EFF_DROP=0.42;                // jarak part di bawah effector
const HOME_X=-1.0;                  // parkir robot
const PICK_X=PLATEN_OPEN+PART_OFF;  // tepat di atas part saat mold terbuka

/* Seluncuran turun ke arah DEPAN (+z), bukan ke kanan. Ujung atasnya harus di z=0
   karena rel robot ada di z=0, dan sisi -x-nya harus lepas dari rangka mesin
   supaya kaki seluncuran tidak menembus bed. */
const CHUTE_X=2.4;                  // pusat seluncuran pada sumbu x
const CHUTE_W=PART_L+.2;            // bumper meluncur melebar, jadi lebar = panjang part
const CHUTE_Z0=0;                   // ujung atas, tempat robot melepas
const CHUTE_Y0=2.55;
const CHUTE_Z1=3.6;                 // ujung bawah, di depan
const CHUTE_Y1=1.15;
const CHUTE_ANG=Math.atan2(CHUTE_Y0-CHUTE_Y1, CHUTE_Z1-CHUTE_Z0);
const DROP_X=CHUTE_X;               // robot melepas tepat di atas seluncuran

const TABLE_X=CHUTE_X;              // meja di ujung bawah seluncuran
const TABLE_Z=4.5;
const TABLE_W=PART_L+.3;
const TABLE_D=1.3;
const TABLE_TOP=1.02;
const LAND_Z=4.3;                   // bumper berhenti di atas meja
const PART_REST=PART_H/2;           // pusat part di atas permukaan

const RACK=[5.8,4.6];               // rak di sisi KANAN operator (operator menghadap -z)
const RACK_W=PART_L+.2;
const RACK_Y=[.62,1.24,1.86];
const PRINTER=[0.4,4.7];            // printer di sisi KIRI operator, jauh dari rak
const PANEL=[-2.0,1.8,1.7];         // IoT node di depan mesin
const TV=[6.4,0,-0.5];
const SHOTS=3;                      // rak penuh setelah 3 pcs

/* ---- durasi (detik) ---- */
const MACH_T=5.4;                   // satu siklus mesin: inject -> takeout -> lepas
const CHECK_T=1.5;                  // operator cek hasil
const STORE_T=1.1;                  // operator taruh ke rak
const PRINT_T=2.6;                  // printer mencetak label
const INJECT_END=1.5;               // fase dalam satu siklus mesin, relatif awal window
const COOL_END=2.1;
const OPEN_END=2.8;
const GRIP_AT=3.5;                  // part pindah dari mold ke robot
const RELEASE_AT=4.9;               // robot melepas ke seluncuran
const LAND_AT=5.9;                  // bumper berhenti di meja
const STORE_AT=.6;                  // part diletakkan di rak (dalam dwell store)
const CYCLE_NOMINAL='42.5';         // cycle time nyata; animasi dipadatkan

/* posisi berdiri operator */
/* Operator menunggu di DEPAN, dekat ujung seluncuran. Menghadap -z, jadi
   kanannya = +x (rak) dan kirinya = -x (printer). */
const OP={ wait:[4.4,5.3], table:[TABLE_X,5.5], rack:[RACK[0],5.6], print:[PRINTER[0],5.6] };
const FACE_TABLE=Math.PI;           // menghadap -z
const FACE_WAIT=Math.atan2(CHUTE_X-4.4, CHUTE_Z1-5.3);   // menengok ke ujung seluncuran

/* keyframe robot: [el, x carriage, panjang arm, rotasi pergelangan]
   effector = RAIL_Y - armLen, part = effector - EFF_DROP.
   armLen 2.88 → part di y 2.10 (setinggi part di mold)
   armLen 2.18 → part di y 2.80 (di atas permukaan seluncuran 2.55)
   armLen 0.90 → part di y 3.98, lewat di atas puncak platen (3.7) saat menggeser
   Pergelangan memutar part 90° saat menggeser: keluar dari mold memanjang di z,
   masuk seluncuran melebar di x. */
const RK=[
  [0.0, HOME_X, ARM_MIN, 0],
  [2.1, HOME_X, ARM_MIN, 0],
  [2.7, PICK_X, 1.00, 0],
  [3.4, PICK_X, 2.88, 0],
  [3.5, PICK_X, 2.88, 0],
  [4.0, PICK_X, 0.90, 0],
  [4.6, DROP_X, 0.90, Math.PI/2],
  [4.9, DROP_X, 2.18, Math.PI/2],
  [5.3, DROP_X, 0.90, Math.PI/2],
  [6.2, HOME_X, ARM_MIN, 0]
];

/* resource yang dipakai ulang antar build */
const steelMat=S.shared(new THREE.MeshStandardMaterial({color:0x8A93A6,roughness:.45,metalness:.6}));
const darkMat =S.shared(new THREE.MeshStandardMaterial({color:0x3A4048,roughness:.6,metalness:.4}));
const bumpMat =S.shared(new THREE.MeshStandardMaterial({color:0xB8473F,roughness:.35,metalness:.15}));
const grillMat=S.shared(new THREE.MeshStandardMaterial({color:0x1B1E24,roughness:.85}));
const yellowMat=S.shared(new THREE.MeshStandardMaterial({color:0xE8B026,roughness:.5,metalness:.3}));

let platen=null, moldMove=null, nozzle=null, guard=null;
let robCar=null, robArm=null, effector=null;
let bMold=null, bRobot=null, bChute=null, bTable=null, bHand=null, rackB=[];
let tv=null, dots=null, panelLed=null, label=null;
const st={ sig:'' };

/* ================= bumper =================
   Sumbu panjang di z supaya cocok untuk cavity mold, seluncuran,
   meja, dan rak tanpa perlu diputar di tengah animasi. */
function makeBumper(){
  const g=new THREE.Group();
  const mid=new THREE.Mesh(new THREE.BoxGeometry(PART_W,PART_H,1.40),bumpMat); g.add(mid);
  for(const sz of [-1,1]){
    const end=new THREE.Mesh(new THREE.BoxGeometry(.28,.40,.55),bumpMat);
    end.position.set(.15,-.01,sz*.98); end.rotation.y=-sz*.55; g.add(end);
  }
  const grill=new THREE.Mesh(new THREE.BoxGeometry(.06,.14,.90),grillMat);
  grill.position.set(.16,-.07,0); g.add(grill);
  return g;
}

/* Bungkus supaya part melebar (sumbu panjang di x). Rotasi y dipasang di
   ANAK, jadi rotation.x pada grup luar memiringkannya tanpa tercampur
   urutan Euler. */
function makeBumperWide(){
  const outer=new THREE.Group();
  const b=makeBumper(); b.rotation.y=Math.PI/2; outer.add(b);
  return outer;
}

/* ================= mesin injection ================= */
function makeMachine(){
  const g=new THREE.Group();

  const bed=new THREE.Mesh(new THREE.BoxGeometry(10.6,.8,3.0),darkMat);
  bed.position.set(-4.5,.4,0); g.add(bed);

  // unit injeksi: barrel + hopper
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,2.9,16),steelMat);
  barrel.rotation.z=Math.PI/2; barrel.position.set(-7.6,2.1,0); g.add(barrel);
  const hopper=new THREE.Mesh(new THREE.CylinderGeometry(.52,.28,.9,4),yellowMat);
  hopper.position.set(-8.3,3.0,0); hopper.rotation.y=Math.PI/4; g.add(hopper);
  const motor=new THREE.Mesh(new THREE.BoxGeometry(1.1,.9,1.0),darkMat);
  motor.position.set(-9.4,2.1,0); g.add(motor);
  nozzle=new THREE.Mesh(new THREE.CylinderGeometry(.13,.19,.5,12),
    new THREE.MeshStandardMaterial({color:0x9AA3B4,emissive:0x000000,roughness:.4,metalness:.7}));
  nozzle.rotation.z=-Math.PI/2; nozzle.position.set(-5.95,2.1,0); g.add(nozzle);

  // platen tetap + end plate + tie bar
  const platenGeo=new THREE.BoxGeometry(PLATEN_W,PLATEN_H,PLATEN_H);
  const fixed=new THREE.Mesh(platenGeo,steelMat);
  fixed.position.set(FIX_X,PLATEN_Y,0); g.add(fixed);
  const endp=new THREE.Mesh(platenGeo,steelMat);
  endp.position.set(END_X,PLATEN_Y,0); g.add(endp);
  for(const sy of [.75,3.45]) for(const sz of [-1,1]){
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,6.2,10),steelMat);
    bar.rotation.z=Math.PI/2; bar.position.set(-2.5,sy,sz*1.3); g.add(bar);
  }

  // mold: separuh tetap + separuh ikut platen bergerak, bertemu di parting line
  const moldFix=new THREE.Mesh(new THREE.BoxGeometry(MOLD_T,2.3,2.7),darkMat);
  moldFix.position.set(MOLD_FIX_X,PLATEN_Y,0); g.add(moldFix);

  platen=new THREE.Group(); g.add(platen);
  const pl=new THREE.Mesh(platenGeo,steelMat); pl.position.y=PLATEN_Y; platen.add(pl);
  moldMove=new THREE.Mesh(new THREE.BoxGeometry(MOLD_T,2.3,2.7),darkMat);
  moldMove.position.set(MOLD_MOVE_OFF,PLATEN_Y,0); platen.add(moldMove);
  bMold=makeBumper();
  bMold.position.set(PART_OFF,PLATEN_Y,0); platen.add(bMold);
  platen.position.x=PLATEN_CLOSED;

  // pagar pengaman transparan di sisi depan
  guard=new THREE.Mesh(new THREE.PlaneGeometry(5.6,2.9),
    new THREE.MeshStandardMaterial({color:0x8FB8D8,transparent:true,opacity:.16,
      side:THREE.DoubleSide,depthWrite:false}));
  guard.position.set(-2.6,2.2,1.52); g.add(guard);

  return g;
}

/* ================= panel akuisisi di depan mesin ================= */
function makePanel(){
  const g=new THREE.Group(); g.position.set(PANEL[0],0,PANEL[2]);
  const box=new THREE.Mesh(new THREE.BoxGeometry(.78,1.0,.26),
    new THREE.MeshStandardMaterial({color:0xC7CBD3,roughness:.5,metalness:.3}));
  box.position.y=PANEL[1]; g.add(box);
  const stand=new THREE.Mesh(new THREE.BoxGeometry(.1,PANEL[1]-.5,.1),steelMat);
  stand.position.y=(PANEL[1]-.5)/2; g.add(stand);
  const scr=new THREE.Mesh(new THREE.PlaneGeometry(.5,.3),
    new THREE.MeshStandardMaterial({color:0x101828,emissive:0x0F2A34,emissiveIntensity:.7}));
  scr.position.set(0,PANEL[1]+.22,.135); g.add(scr);
  // LED: power, run, dan satu yang berkedip tiap shot terhitung
  [[0x2E9E57,-.22],[0x2E9E57,0]].forEach(([col,x])=>{
    const l=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),
      new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:.9}));
    l.position.set(x,PANEL[1]-.18,.14); g.add(l);
  });
  panelLed=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),
    new THREE.MeshStandardMaterial({color:C.screen,emissive:C.screen,emissiveIntensity:.4}));
  panelLed.position.set(.22,PANEL[1]-.18,.14); g.add(panelLed);
  return g;
}

/* ================= robot takeout (gantry di atas mesin) ================= */
function makeRobot(){
  const g=new THREE.Group();
  // rel menumpu di atas platen tetap (-5.6) dan end plate (0.6), keduanya puncak 3.7
  const railLen=RAIL_X1-FIX_X;
  const rail=new THREE.Mesh(new THREE.BoxGeometry(railLen,.20,.24),steelMat);
  rail.position.set((FIX_X+RAIL_X1)/2,RAIL_Y,0); g.add(rail);
  for(const x of [FIX_X,END_X]){
    const post=new THREE.Mesh(new THREE.BoxGeometry(.16,RAIL_Y-MACH_TOP,.16),steelMat);
    post.position.set(x,MACH_TOP+(RAIL_Y-MACH_TOP)/2,0); g.add(post);
  }

  robCar=new THREE.Group(); robCar.position.y=RAIL_Y; g.add(robCar);
  const car=new THREE.Mesh(new THREE.BoxGeometry(.7,.34,.5),yellowMat);
  car.position.y=-.24; robCar.add(car);

  // arm teleskopik: geometry digeser supaya puncaknya di y=0, jadi scale.y
  // memanjangkannya ke BAWAH dari carriage — bukan menggeser balok utuh
  const armGeo=new THREE.BoxGeometry(.16,1,.16); armGeo.translate(0,-.5,0);
  robArm=new THREE.Mesh(armGeo,steelMat); robCar.add(robArm);

  effector=new THREE.Group(); robCar.add(effector);
  const plate=new THREE.Mesh(new THREE.BoxGeometry(.34,.10,1.5),darkMat);
  effector.add(plate);
  for(const sz of [-1,-.34,.34,1]){                   // suction cup
    const cup=new THREE.Mesh(new THREE.CylinderGeometry(.10,.13,.14,10),grillMat);
    cup.position.set(0,-.12,sz*.62); effector.add(cup);
  }
  bRobot=makeBumper(); bRobot.position.y=-EFF_DROP; effector.add(bRobot);
  setArm(ARM_MIN);
  return g;
}

/* satu tempat yang mengatur panjang arm, effector ikut ke ujungnya */
function setArm(len){
  robArm.scale.y=len;
  effector.position.y=-len;
}

/* ================= seluncuran ================= */
function makeChute(){
  const g=new THREE.Group();
  const dz=CHUTE_Z1-CHUTE_Z0, dy=CHUTE_Y1-CHUTE_Y0;
  const len=Math.hypot(dz,dy);
  const midZ=(CHUTE_Z0+CHUTE_Z1)/2, midY=(CHUTE_Y0+CHUTE_Y1)/2;
  const yAt=t=>CHUTE_Y0+dy*t;

  // deck memanjang di z, dimiringkan sekitar sumbu x supaya ujung +z lebih rendah
  const deck=new THREE.Mesh(new THREE.BoxGeometry(CHUTE_W,.08,len),
    new THREE.MeshStandardMaterial({color:0xA8B0BE,roughness:.4,metalness:.55}));
  deck.position.set(CHUTE_X,midY-.06,midZ); deck.rotation.x=CHUTE_ANG; g.add(deck);

  for(const sx of [-1,1]){                            // pagar samping
    const rail=new THREE.Mesh(new THREE.BoxGeometry(.07,.26,len),yellowMat);
    rail.position.set(CHUTE_X+sx*CHUTE_W/2,midY+.11,midZ);
    rail.rotation.x=CHUTE_ANG; g.add(rail);
  }

  // roller: sumbu HARUS dibaringkan ke x. CylinderGeometry default sumbunya y,
  // tanpa rotasi ini rollernya berdiri tegak menembus deck.
  for(let i=0;i<9;i++){
    const t=i/8;
    const r=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,CHUTE_W-.16,10),steelMat);
    r.rotation.z=Math.PI/2;
    r.position.set(CHUTE_X, yAt(t)+.02, CHUTE_Z0+dz*t); g.add(r);
  }

  // kaki di empat sudut, puncaknya di bawah deck
  for(const [t,sx] of [[.14,-1],[.14,1],[.88,-1],[.88,1]]){
    const h=yAt(t)-.12;
    const leg=new THREE.Mesh(new THREE.BoxGeometry(.1,h,.1),steelMat);
    leg.position.set(CHUTE_X+sx*(CHUTE_W/2-.1), h/2, CHUTE_Z0+dz*t); g.add(leg);
  }
  return g;
}

/* ================= meja, rak, printer ================= */
function makeTable(){
  const g=new THREE.Group(); g.position.set(TABLE_X,0,TABLE_Z);
  const top=new THREE.Mesh(new THREE.BoxGeometry(TABLE_W,.08,TABLE_D),
    new THREE.MeshStandardMaterial({color:0xB9A07C,roughness:.8}));
  top.position.y=TABLE_TOP-.04; g.add(top);
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const leg=new THREE.Mesh(new THREE.BoxGeometry(.09,TABLE_TOP-.08,.09),steelMat);
    leg.position.set(sx*(TABLE_W/2-.12),(TABLE_TOP-.08)/2,sz*(TABLE_D/2-.12)); g.add(leg);
  }
  const lampArm=new THREE.Mesh(new THREE.BoxGeometry(.06,1.1,.06),steelMat);
  lampArm.position.set(TABLE_W/2-.2,TABLE_TOP+.55,-TABLE_D/2+.15); g.add(lampArm);
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(.13,10,8),
    new THREE.MeshStandardMaterial({color:0xFFF3D0,emissive:0xFFF3D0,emissiveIntensity:.8}));
  lamp.position.set(TABLE_W/2-.4,TABLE_TOP+1.05,-TABLE_D/2+.25); g.add(lamp);
  return g;
}

function makeRack(){
  const g=new THREE.Group(); g.position.set(RACK[0],0,RACK[1]);
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const u=new THREE.Mesh(new THREE.BoxGeometry(.09,2.3,.09),
      new THREE.MeshStandardMaterial({color:0x2F5C8C,roughness:.5,metalness:.35}));
    u.position.set(sx*RACK_W/2,1.15,sz*.5); g.add(u);
  }
  RACK_Y.forEach(y=>{
    const sh=new THREE.Mesh(new THREE.BoxGeometry(RACK_W,.06,1.1),
      new THREE.MeshStandardMaterial({color:0x4A7CB0,roughness:.6,metalness:.3}));
    sh.position.y=y-.24; g.add(sh);
  });
  rackB=RACK_Y.map(y=>{
    const b=makeBumperWide(); b.position.set(0,y,0); b.visible=false; g.add(b); return b;
  });
  return g;
}

function makePrinter(){
  const g=new THREE.Group(); g.position.set(PRINTER[0],0,PRINTER[1]);
  const stand=new THREE.Mesh(new THREE.BoxGeometry(.62,.82,.52),darkMat);
  stand.position.y=.41; g.add(stand);
  const body=new THREE.Mesh(new THREE.BoxGeometry(.56,.34,.46),
    new THREE.MeshStandardMaterial({color:0x2A2E36,roughness:.55}));
  body.position.y=.99; g.add(body);
  const slot=new THREE.Mesh(new THREE.BoxGeometry(.42,.03,.02),grillMat);
  slot.position.set(0,.86,.235); g.add(slot);
  const led=new THREE.Mesh(new THREE.SphereGeometry(.03,8,6),
    new THREE.MeshStandardMaterial({color:C.ok,emissive:C.ok,emissiveIntensity:.9}));
  led.position.set(.2,1.12,.235); g.add(led);
  label=new THREE.Mesh(new THREE.PlaneGeometry(.34,.22),
    new THREE.MeshBasicMaterial({color:0xF6F7F9,side:THREE.DoubleSide}));
  label.rotation.x=-.35; label.visible=false; g.add(label);
  return g;
}

/* ================= operator ================= */
function makeOperator(){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.16,.2,.85,10),
    new THREE.MeshStandardMaterial({color:0x3D4763,roughness:.7}));
  body.position.y=.55; g.add(body);
  const vest=new THREE.Mesh(new THREE.CylinderGeometry(.175,.2,.4,10),
    new THREE.MeshStandardMaterial({color:0x2FA8C4,roughness:.8}));
  vest.position.y=.7; g.add(vest);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.14,10,8),
    new THREE.MeshStandardMaterial({color:C.officer,roughness:.6}));
  head.position.y=1.12; g.add(head);
  const helm=new THREE.Mesh(new THREE.SphereGeometry(.155,10,6,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0xE8B026,roughness:.5}));
  helm.position.y=1.14; g.add(helm);
  bHand=makeBumperWide();
  bHand.scale.setScalar(.92);
  bHand.position.set(0,.86,.36); bHand.rotation.x=.2;
  bHand.visible=false; g.add(bHand);
  return g;
}

/* ================= TV monitoring ================= */
function drawTV(shots, oks, rack, printed){
  const {cx,cv}=tv, W=cv.width, H=cv.height;
  cx.fillStyle='#0F1424'; cx.fillRect(0,0,W,H);
  cx.fillStyle='#1B2540'; cx.fillRect(0,0,W,72);
  cx.fillStyle='#3ED0C2'; cx.font='700 38px "Segoe UI",sans-serif';
  cx.textAlign='left'; cx.textBaseline='middle';
  cx.fillText('INJECTION MONITORING  ·  MC-04',28,38);
  cx.fillStyle='#98A0B3'; cx.font='500 25px "Segoe UI",sans-serif';
  cx.fillText('RUN',W-90,38);

  const row=(i,k,v,col)=>{
    const y=128+i*58;
    cx.fillStyle='#5B6478'; cx.font='600 26px ui-monospace,Consolas,monospace';
    cx.fillText(k,28,y);
    cx.fillStyle=col||'#E8EAF2'; cx.font='700 30px ui-monospace,Consolas,monospace';
    cx.fillText(v,320,y);
  };
  row(0,'MOLD','BMP-FR-2024  (A)');
  row(1,'SHOT',shots+' / 500');
  row(2,'CYCLE',CYCLE_NOMINAL+' s');
  row(3,'OK / NG',oks+' / 0','#46C46E');
  row(4,'RAK',rack+' / '+SHOTS+(rack>=SHOTS?'   PENUH':''), rack>=SHOTS?'#E8B026':'#E8EAF2');
  row(5,'GANTI MOLD','12 Agu 08:15  ·  tercatat');

  cx.font='700 28px "Segoe UI",sans-serif';
  cx.fillStyle = printed ? '#46C46E' : '#5B6478';
  cx.fillText(printed ? 'LABEL TERCETAK OTOMATIS  ·  rak siap dipindah'
                      : 'shot terhitung otomatis  ·  tanpa input manual', 28, H-38);
  tv.flush();
}

function makeTV(){
  tv=S.makeScreen(3.6,2.1,940,560);
  const g=new THREE.Group();
  g.position.set(TV[0],0,TV[2]); g.rotation.y=.60;    // menghadap kamera default
  const bezelY=2.7, bezelH=2.3;
  // tiang berhenti di tepi bawah bezel dan berada di BELAKANG layar (z negatif),
  // kalau tidak ia menembus layar dan tampak sebagai garis vertikal di tengah
  const poleH=bezelY-bezelH/2;
  const pole=new THREE.Mesh(new THREE.BoxGeometry(.15,poleH,.15),steelMat);
  pole.position.set(0,poleH/2,-.08); g.add(pole);
  const foot=new THREE.Mesh(new THREE.BoxGeometry(.9,.07,.55),steelMat);
  foot.position.set(0,.035,-.08); g.add(foot);
  const bezel=new THREE.Mesh(new THREE.BoxGeometry(3.8,bezelH,.1),
    new THREE.MeshStandardMaterial({color:C.station,roughness:.6}));
  bezel.position.y=bezelY; g.add(bezel);
  tv.mesh.position.set(0,bezelY,.06); g.add(tv.mesh);
  return g;
}

/* ================= titik data panel → TV ================= */
const DOT_A=new THREE.Vector3(PANEL[0],PANEL[1]+.4,PANEL[2]);
const DOT_B=new THREE.Vector3(TV[0]-.6,2.7,TV[2]+.6);
function makeDots(){
  const g=new THREE.Group();
  const mat=new THREE.MeshBasicMaterial({color:C.screen});
  for(let i=0;i<5;i++){
    const d=new THREE.Mesh(new THREE.SphereGeometry(.08,8,6),mat);
    d.visible=false; g.add(d);
  }
  return g;
}
function tickDots(el){
  const active = el>=0 && el<1.5;
  dots.children.forEach((d,i)=>{
    const t=el*1.1 - i*.12;
    if(!active || t<0 || t>1){ d.visible=false; return; }
    d.visible=true;
    d.position.lerpVectors(DOT_A,DOT_B,t);
    d.position.y += Math.sin(t*Math.PI)*1.3;
    d.scale.setScalar(.7+Math.sin(t*Math.PI)*.6);
  });
}

/* ================= util ================= */
/* interpolasi keyframe [t, v1, v2, ...] */
function keyLerp(keys,t){
  if(t<=keys[0][0]) return keys[0].slice(1);
  for(let i=1;i<keys.length;i++){
    if(t<=keys[i][0]){
      const a=keys[i-1], b=keys[i], k=(t-a[0])/(b[0]-a[0]);
      return a.slice(1).map((v,j)=>v+(b[j+1]-v)*k);
    }
  }
  return keys[keys.length-1].slice(1);
}
const smooth=t=>t*t*(3-2*t);
const clamp01=t=>Math.max(0,Math.min(1,t));

/* satu waypoint per langkah operator; dwell-nya memegang fase mesin */
function buildWps(){
  const w=[];
  for(let i=0;i<SHOTS;i++){
    w.push({x:OP.wait[0],  z:OP.wait[1],  face:FACE_WAIT,  dwell:MACH_T,  event:'m'+i});
    w.push({x:OP.table[0], z:OP.table[1], face:FACE_TABLE, dwell:CHECK_T, event:'c'+i});
    w.push({x:OP.rack[0],  z:OP.rack[1],  face:FACE_TABLE, dwell:STORE_T, event:'s'+i});
  }
  w.push({x:OP.print[0], z:OP.print[1], face:FACE_TABLE, dwell:PRINT_T, event:'p'});
  return w;
}

/* ================= registrasi ================= */
S.register('injection',{
  label:'Injection Molding · Shot Counter',
  title:'Injection Molding &middot; Shot Counter',
  sub:'Hitung shot otomatis, rak penuh &rarr; label tercetak',
  room:{w:ROOM.w,d:ROOM.d,h:ROOM.h,doorW:3.0,doorH:4.0},
  cam:{theta:.60,phi:1.00,r:27,target:[0,1.7,0],topR:25},
  speed:1.9,
  theme:{ light:{floor:0xAEB4BE}, dark:{floor:0x22262F} },
  legend:[
    ['#8A93A6','Mesin & mold'],['#B8473F','Bumper (part)'],
    ['#E8B026','Robot takeout'],['#A8B0BE','Seluncuran'],
    ['#3ED0C2','Panel akuisisi / data'],['#4A7CB0','Rak OK + printer']
  ],
  scenarios:{
    normal:{
      label:'Produksi normal — 3 shot sampai rak penuh',
      note:'Setiap bumper yang jadi dihitung otomatis oleh panel akuisisi di depan mesin, tanpa operator mencatat apa pun. Hasilnya tampil di TV monitoring bersama mold yang sedang dipakai. Rak penuh ('+SHOTS+' pcs) &rarr; printer mencetak label sendiri. <b>Ganti mold dicatat &amp; dihitung</b>, tapi belum dianimasikan di skenario ini.'
    }
  },
  flowText:{
    walk:'Operator bergerak di area mesin',
    inject:'Injeksi &mdash; <b>material masuk ke mold</b>',
    cool:'Pendinginan &mdash; <b>part mengeras di dalam mold</b>',
    moldopen:'Mold terbuka &mdash; <b>shot terhitung otomatis oleh panel akuisisi</b>',
    takeout:'Robot takeout mengambil bumper <b>dari atas mold</b>',
    release:'Bumper dilepas ke seluncuran &mdash; <b>turun mulus tanpa dibanting</b>',
    c0:'Operator memeriksa hasil di meja &mdash; <b>OK</b>',
    c1:'Operator memeriksa hasil di meja &mdash; <b>OK</b>',
    c2:'Operator memeriksa hasil di meja &mdash; <b>OK</b>',
    s0:'Bumper OK disimpan ke rak &mdash; <b>1 / '+SHOTS+'</b>',
    s1:'Bumper OK disimpan ke rak &mdash; <b>2 / '+SHOTS+'</b>',
    s2:'Bumper OK disimpan ke rak &mdash; <b>'+SHOTS+' / '+SHOTS+', rak penuh</b>',
    p:'Rak penuh &mdash; <b>printer mencetak label sendiri</b>',
    idle:'Selesai &mdash; <b>'+SHOTS+' shot, 0 pencatatan manual, label tercetak otomatis</b>'
  },

  build(){
    S.groups.concept.add(makeMachine());
    S.groups.concept.add(makePanel());
    S.groups.concept.add(makeRobot());
    S.groups.concept.add(makeChute());
    S.groups.concept.add(makeTable());
    S.groups.concept.add(makeRack());
    S.groups.concept.add(makePrinter());
    S.groups.concept.add(makeTV());
    dots=makeDots(); S.groups.concept.add(dots);

    bChute=makeBumperWide(); bChute.visible=false; S.groups.concept.add(bChute);
    bTable=makeBumperWide();
    bTable.position.set(TABLE_X,TABLE_TOP+PART_REST,LAND_Z);
    bTable.visible=false; S.groups.concept.add(bTable);

    S.addLabel('MESIN INJECTION',null,-5.6,4.4,0,1.3);
    S.addLabel('IoT Node','#3ED0C2',PANEL[0]-.3,PANEL[1]+1.0,PANEL[2],1.1);
    S.addLabel('MEJA CEK','#E9EBEE',TABLE_X,2.0,TABLE_Z,1.1);
    S.addLabel('RAK OK','#9CC4EA',RACK[0],2.7,RACK[1],1.1);
    S.addLabel('PRINTER LABEL','#E9EBEE',PRINTER[0],1.8,PRINTER[1],1.1);

    S.actor=makeOperator();

    return {
      wps:buildWps(),
      stats:'<b>Mesin</b> : MC-04 &middot; clamp horizontal<br>'
        +'<b>Mold</b> : BMP-FR-2024 (A) &middot; bumper depan<br>'
        +'<b>Takeout</b> : robot gantry 2 sumbu dari atas<br>'
        +'<b>Akuisisi</b> : panel di depan mesin, 1 sensor shot<br>'
        +'<b>Cycle</b> : '+CYCLE_NOMINAL+' s nominal &middot; animasi dipadatkan<br>'
        +'<b>Rak</b> : '+SHOTS+' pcs &rarr; label tercetak otomatis<br>'
        +'<b>Area</b> : 22 &times; 13 &times; 6.5 m'
    };
  },

  reset(){
    platen.position.x=PLATEN_CLOSED;
    robCar.position.x=HOME_X; setArm(ARM_MIN); effector.rotation.y=0;
    bMold.visible=false; bRobot.visible=false;
    bChute.visible=false; bTable.visible=false; bHand.visible=false;
    rackB.forEach(b=>b.visible=false);
    label.visible=false;
    nozzle.material.emissive.setHex(0x000000);
    panelLed.material.emissiveIntensity=.4;
    dots.children.forEach(d=>d.visible=false);
    st.sig='0/0/false';           // cocokkan dengan drawTV di bawah, hindari redraw pertama
    drawTV(0,0,0,false);
  },

  tick(ct, seg, win){
    /* ---- shot yang sedang / terakhir berjalan ---- */
    let shot=0, el=-1;
    for(let i=0;i<SHOTS;i++){
      const mw=win['m'+i];
      if(mw && ct>=mw[0]){ shot=i; el=ct-mw[0]; }
    }

    /* ---- mold: terbuka lalu menutup lagi setelah part keluar ---- */
    let openK=0;
    if(el>=0){
      if(el<COOL_END)      openK=0;
      else if(el<OPEN_END) openK=smooth((el-COOL_END)/(OPEN_END-COOL_END));
      else if(el<MACH_T)   openK=1;
      else                 openK=Math.max(0,1-(el-MACH_T)/.7);   // menutup untuk shot berikutnya
    }
    platen.position.x = PLATEN_CLOSED+(PLATEN_OPEN-PLATEN_CLOSED)*openK;

    /* nozzle memanas saat injeksi */
    const injecting = el>=0 && el<INJECT_END;
    nozzle.material.emissive.setHex(injecting?0xC4491A:0x000000);
    nozzle.material.emissiveIntensity = injecting?.9:0;

    /* ---- robot: keyframe x carriage + panjang arm ---- */
    if(el>=0){
      const [rx,len,ry]=keyLerp(RK,el);
      robCar.position.x=rx; setArm(len); effector.rotation.y=ry;
    }

    /* ---- posisi bumper: satu sumber kebenaran untuk semua fase ---- */
    bMold.visible=bRobot.visible=bChute.visible=bTable.visible=bHand.visible=false;
    rackB.forEach(b=>b.visible=false);
    for(let i=0;i<SHOTS;i++){
      const mw=win['m'+i], cw=win['c'+i], sw=win['s'+i];
      if(!mw || ct<mw[0]) continue;
      if(sw && ct>=sw[0]+STORE_AT){ rackB[i].visible=true; continue; }
      const e=ct-mw[0];
      if(e<GRIP_AT)              bMold.visible=true;
      else if(e<RELEASE_AT)      bRobot.visible=true;
      else if(e<LAND_AT){
        const t=smooth(clamp01((e-RELEASE_AT)/(LAND_AT-RELEASE_AT)));
        const y0=CHUTE_Y0+PART_REST, y1=TABLE_TOP+PART_REST;
        bChute.visible=true;
        bChute.position.set(CHUTE_X, y0+(y1-y0)*t, CHUTE_Z0+(LAND_Z-CHUTE_Z0)*t);
        bChute.rotation.x=CHUTE_ANG*(1-t);   // ikut kemiringan seluncuran, rata di meja
      }
      else if(cw && ct<cw[1])    bTable.visible=true;
      else                       bHand.visible=true;
    }

    /* ---- counter: dihitung dari ct, jadi aman saat loop / ulang ---- */
    let shots=0, oks=0;
    let lastCount=-99;
    for(let i=0;i<SHOTS;i++){
      const mw=win['m'+i], sw=win['s'+i];
      if(mw && ct>=mw[0]+OPEN_END){ shots=i+1; lastCount=mw[0]+OPEN_END; }
      if(sw && ct>=sw[0]+STORE_AT)  oks=i+1;
    }
    const printed = !!(win.p && ct>=win.p[0]+.8);
    const sig=shots+'/'+oks+'/'+printed;
    if(sig!==st.sig){ st.sig=sig; drawTV(shots,oks,oks,printed); }

    /* LED akuisisi berkedip + titik data terbang ke TV tiap shot terhitung */
    tickDots(ct-lastCount);
    panelLed.material.emissiveIntensity = (ct-lastCount)<1.2 ? 1.4 : .4;

    /* label keluar dari printer */
    if(win.p && ct>=win.p[0]+.8){
      const k=clamp01((ct-win.p[0]-.8)/1.0);
      label.visible=true;
      label.position.set(0,.85-k*.16,.24+k*.30);
    }else label.visible=false;

    /* Teks status: fase mesin menang selama part masih dalam perjalanan,
       termasuk saat operator sudah mulai berjalan ke meja. Setelah part
       mendarat, biarkan mode segmen (c / s / p / walk) yang bicara. */
    if(el>=0 && el<LAND_AT){
      if(el<INJECT_END) return {flow:'inject'};
      if(el<COOL_END)   return {flow:'cool'};
      if(el<OPEN_END)   return {flow:'moldopen'};
      if(el<RELEASE_AT) return {flow:'takeout'};
      return {flow:'release'};
    }
    return null;
  },

  idle(t){
    if(panelLed) panelLed.material.emissiveIntensity=.35+.2*Math.sin(t*2.5);
  }
});
})(window.SIMLAY);
