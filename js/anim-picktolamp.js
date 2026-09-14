/* ============================================================
   Pick to Lamp · Kitting
   Order dari middleware dimuat ke IoT Node, lalu lampu di flow rack
   memandu operator: ambil sesuai angka, tekan tombol, lampu padam,
   lampu berikutnya menyala. Kit lengkap -> cart dikirim ke line.

   Aktor timeline = OPERATOR. Lampu, cart, dan layar digerakkan dari
   window timeline di tick(), dihitung dari ct supaya aman saat loop.
   ============================================================ */
"use strict";
(function(S){
const C=S.C;
const ROOM={w:16,d:11,h:5};

/* ---- flow rack ---- */
const COLS=4;
const LEVELS=3;
const BAY_W=0.9;
const RACK_X0=-1.8;                 // tepi kiri rak
const COL_X=Array.from({length:COLS},(_,i)=>RACK_X0+BAY_W*(i+.5));
const LEVEL_Y=[0.55,1.05,1.55];     // tinggi tepi depan tiap level
const RACK_FRONT=-1.0;              // muka depan rak (z)
const RACK_DEPTH=1.2;
const RACK_H=2.1;
const SHELF_TILT=0.10;              // flow rack: belakang lebih tinggi, part meluncur ke depan

/* ---- area kerja ---- */
const OP_Z=0.0;                     // garis berdiri operator di depan rak
const HOME=[-3.4,-0.2];             // berdiri di depan terminal scan kanban
const TERMINAL=[-3.4,-1.0];
const END=[3.4,0.2];                // tempat cart dilepas ke line
const CART_DZ=0.85;                 // cart di belakang operator
const CART_OUT_X=6.6;
const CART_SLOTS=3;
const IOT=[RACK_X0+BAY_W*COLS+.28,1.5,RACK_FRONT-.35];
const TV=[4.8,0,-2.6];
const SPEED=1.3;

/* ---- order: urut kiri ke kanan supaya jalannya wajar ---- */
const ORDER=[
  {col:0, lvl:1, part:'BRK-2210', name:'Bracket bumper', qty:2, color:0xC98A2B},
  {col:2, lvl:2, part:'CLP-0415', name:'Klip harness',   qty:3, color:0x3FA66B},
  {col:3, lvl:0, part:'GRM-1180', name:'Grommet',        qty:1, color:0x9B59B6}
];
/* skenario salah ambil: tombol bin tetangga ditekan sebelum pick ke-`before` */
const WRONG={col:1, lvl:2, before:1};
const DIGIT_MAX=3;

/* ---- durasi (detik) ---- */
const SCAN_T=2.2;                   // scan kanban + order dimuat
const SCAN_LIT=1.2;                 // lampu pertama menyala, relatif awal scan
const PICK_T=1.8;
const REACH_AT=0.35;                // part mulai di tangan
const PRESS_AT=0.9;                 // tombol ditekan, lampu padam
const PUT_AT=1.35;                  // part masuk cart
const WRONG_T=1.8;
const WRONG_AT=0.5;                 // tombol bin yang salah ditekan
const DONE_T=2.6;
const RELEASE_AT=0.6;               // cart mulai jalan ke line

/* ---- resource yang dipakai ulang antar build ---- */
const steelMat =S.shared(new THREE.MeshStandardMaterial({color:0x8A93A6,roughness:.45,metalness:.55}));
const railMat  =S.shared(new THREE.MeshStandardMaterial({color:0xE8B026,roughness:.5,metalness:.3}));
const toteMat  =S.shared(new THREE.MeshStandardMaterial({color:0x2F6FB5,roughness:.6}));
const insetMat =S.shared(new THREE.MeshStandardMaterial({color:0x1A2B45,roughness:.9}));
const moduleMat=S.shared(new THREE.MeshStandardMaterial({color:0x22252B,roughness:.6}));
const dispOffMat=S.shared(new THREE.MeshBasicMaterial({color:0x10131A}));

/* angka di modul lampu: satu material per angka, dipakai bergantian oleh semua modul */
function digitMat(ch, col){
  const cv=document.createElement('canvas'); cv.width=64; cv.height=48;
  const cx=cv.getContext('2d');
  cx.fillStyle='#10131A'; cx.fillRect(0,0,64,48);
  cx.fillStyle=col; cx.font='700 40px ui-monospace,Consolas,monospace';
  cx.textAlign='center'; cx.textBaseline='middle'; cx.fillText(ch,32,26);
  return S.shared(new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv)}));
}
const DIGIT=[null];
for(let n=1;n<=DIGIT_MAX;n++) DIGIT.push(digitMat(String(n),'#FFB020'));
const DIGIT_X=digitMat('X','#FF5A5F');

let modules=[], cart=null, cartParts=[], handParts=[];
let tv=null, dotsIn=null, dotsOut=null, iotLed=null;
const st={ sig:'' };

const smooth=t=>t*t*(3-2*t);
const clamp01=t=>Math.max(0,Math.min(1,t));

/* ================= bin & modul lampu ================= */
function binPartColor(col,lvl){
  const o=ORDER.find(o=>o.col===col&&o.lvl===lvl);
  return o ? o.color : [0x7D8594,0xA0A7B4,0x5E6675][(col+lvl)%3];
}

function makeBin(col,lvl,x){
  const g=new THREE.Group(); g.position.set(x,0,-.58);
  const tote=new THREE.Mesh(new THREE.BoxGeometry(BAY_W-.12,.26,1.0),toteMat);
  tote.position.y=.13; g.add(tote);
  const inset=new THREE.Mesh(new THREE.PlaneGeometry(BAY_W-.2,.9),insetMat);
  inset.rotation.x=-Math.PI/2; inset.position.y=.261; g.add(inset);
  const pm=new THREE.MeshStandardMaterial({color:binPartColor(col,lvl),roughness:.55});
  for(const px of [-.15,.15]){
    const p=new THREE.Mesh(new THREE.BoxGeometry(.18,.1,.18),pm);
    p.position.set(px,.3,.32); g.add(p);
  }
  return g;
}

/* modul per bin: LED, angka qty, tombol konfirmasi — dipasang di rel depan */
function makeModule(col,lvl){
  const g=new THREE.Group();
  g.position.set(COL_X[col], LEVEL_Y[lvl]-.07, RACK_FRONT+.06);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(.3,.12,.05),moduleMat));
  const led=new THREE.Mesh(new THREE.SphereGeometry(.034,10,8),
    new THREE.MeshStandardMaterial({color:0x2A2E36,emissive:0x000000}));
  led.position.set(-.1,0,.03); g.add(led);
  const disp=new THREE.Mesh(new THREE.PlaneGeometry(.1,.075),dispOffMat);
  disp.position.set(.01,0,.026); g.add(disp);
  const btn=new THREE.Mesh(new THREE.CylinderGeometry(.028,.028,.02,12),
    new THREE.MeshStandardMaterial({color:0x3A3F48,emissive:0x000000}));
  btn.rotation.x=Math.PI/2; btn.position.set(.11,0,.03); g.add(btn);
  return {grp:g, led, disp, btn};
}

function setModule(m, state, qty, t){
  const lit = state!=='off';
  const col = state==='on' ? C.ok : state==='alert' ? C.alert : 0x2A2E36;
  m.led.material.color.setHex(col);
  m.led.material.emissive.setHex(lit?col:0x000000);
  m.led.material.emissiveIntensity = state==='alert' ? ((t%.3)<.15?1.8:.35) : (lit?1.3:0);
  m.disp.material = state==='on' ? DIGIT[qty] : state==='alert' ? DIGIT_X : dispOffMat;
  if(!lit){ m.btn.material.emissive.setHex(0x000000); m.btn.material.emissiveIntensity=0; }
}

function flashButton(m, col, ct, at){
  const on = ct>=at-.08 && ct<at+.25;
  if(!on) return;
  m.btn.material.emissive.setHex(col); m.btn.material.emissiveIntensity=1.5;
}

/* ================= flow rack ================= */
function makeRack(){
  const g=new THREE.Group();
  const W=BAY_W*COLS, xMid=RACK_X0+W/2;
  for(const x of [RACK_X0-.03, RACK_X0+W+.03]) for(const z of [RACK_FRONT, RACK_FRONT-RACK_DEPTH]){
    const post=new THREE.Mesh(new THREE.BoxGeometry(.06,RACK_H,.06),steelMat);
    post.position.set(x,RACK_H/2,z); g.add(post);
  }
  LEVEL_Y.forEach((y,lvl)=>{
    // rel depan tempat modul lampu, tidak ikut miring
    const rail=new THREE.Mesh(new THREE.BoxGeometry(W+.1,.04,.05),railMat);
    rail.position.set(xMid,y-.15,RACK_FRONT+.02); g.add(rail);
    // rak miring: pivot di tepi depan, isi di z negatif, jadi sisi belakang yang naik
    const shelf=new THREE.Group();
    shelf.position.set(xMid,y,RACK_FRONT); shelf.rotation.x=SHELF_TILT; g.add(shelf);
    const deck=new THREE.Mesh(new THREE.BoxGeometry(W,.04,RACK_DEPTH),steelMat);
    deck.position.set(0,-.02,-RACK_DEPTH/2); shelf.add(deck);
    for(let col=0;col<COLS;col++) shelf.add(makeBin(col,lvl,COL_X[col]-xMid));
  });
  modules=LEVEL_Y.map((_,lvl)=>COL_X.map((_,col)=>{
    const m=makeModule(col,lvl); g.add(m.grp); return m;
  }));
  return g;
}

/* ================= terminal, IoT node, cart ================= */
function makeTerminal(){
  const g=new THREE.Group(); g.position.set(TERMINAL[0],0,TERMINAL[1]);
  const post=new THREE.Mesh(new THREE.BoxGeometry(.08,1.1,.08),steelMat);
  post.position.y=.55; g.add(post);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.46,.32,.06),moduleMat);
  head.position.y=1.25; head.rotation.x=-.35; g.add(head);
  const scr=new THREE.Mesh(new THREE.PlaneGeometry(.38,.24),
    new THREE.MeshStandardMaterial({color:C.screen,emissive:C.screen,emissiveIntensity:.6}));
  scr.position.set(0,1.26,.036); scr.rotation.x=-.35; g.add(scr);
  const scanner=new THREE.Mesh(new THREE.BoxGeometry(.07,.16,.07),railMat);
  scanner.position.set(.3,1.08,.02); g.add(scanner);
  return g;
}

function makeIoT(){
  const g=new THREE.Group(); g.position.set(IOT[0],0,IOT[2]);
  const box=new THREE.Mesh(new THREE.BoxGeometry(.34,.46,.18),
    new THREE.MeshStandardMaterial({color:0xC7CBD3,roughness:.5,metalness:.3}));
  box.position.y=IOT[1]; g.add(box);
  // braket ke tiang rak, supaya node tidak melayang
  const bracket=new THREE.Mesh(new THREE.BoxGeometry(.2,.06,.06),steelMat);
  bracket.position.set(-.24,IOT[1],0); g.add(bracket);
  const ant=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.22,6),moduleMat);
  ant.position.set(.11,IOT[1]+.34,0); g.add(ant);
  iotLed=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),
    new THREE.MeshStandardMaterial({color:C.screen,emissive:C.screen,emissiveIntensity:.4}));
  iotLed.position.set(.1,IOT[1]+.14,.095); g.add(iotLed);
  return g;
}

function makeCart(){
  const g=new THREE.Group();
  for(const y of [.3,.82]){
    const tray=new THREE.Mesh(new THREE.BoxGeometry(.95,.05,.62),railMat);
    tray.position.y=y; g.add(tray);
  }
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const p=new THREE.Mesh(new THREE.BoxGeometry(.04,.62,.04),steelMat);
    p.position.set(sx*.44,.56,sz*.28); g.add(p);
    const w=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.05,10),moduleMat);
    w.rotation.z=Math.PI/2; w.position.set(sx*.4,.07,sz*.24); g.add(w);
  }
  const handle=new THREE.Mesh(new THREE.BoxGeometry(.95,.04,.04),steelMat);
  handle.position.set(0,1.02,.3); g.add(handle);
  cartParts=ORDER.map((o,i)=>{
    const p=new THREE.Mesh(new THREE.BoxGeometry(.2,.12,.2),
      new THREE.MeshStandardMaterial({color:o.color,roughness:.55}));
    p.position.set(-.3+i*.3,.91,0); p.visible=false; g.add(p); return p;
  });
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
  handParts=ORDER.map(o=>{
    const p=new THREE.Mesh(new THREE.BoxGeometry(.18,.1,.18),
      new THREE.MeshStandardMaterial({color:o.color,roughness:.55}));
    p.position.set(.2,.8,.26); p.visible=false; g.add(p); return p;
  });
  return g;
}

/* ================= TV monitoring ================= */
function locName(o){ return 'R'+(o.lvl+1)+'-'+String.fromCharCode(65+o.col); }

function drawTV(s){
  const {cx,cv}=tv, W=cv.width, H=cv.height;
  cx.fillStyle='#0F1424'; cx.fillRect(0,0,W,H);
  cx.fillStyle='#1B2540'; cx.fillRect(0,0,W,70);
  cx.textAlign='left'; cx.textBaseline='middle';
  cx.fillStyle='#3ED0C2'; cx.font='700 36px "Segoe UI",sans-serif';
  cx.fillText('PICK TO LAMP  ·  KITTING ZONE 2',26,36);
  cx.fillStyle='#98A0B3'; cx.font='500 24px "Segoe UI",sans-serif';
  cx.fillText('KIT-2481',W-140,36);
  cx.font='500 24px ui-monospace,Consolas,monospace';
  cx.fillText('VIN JM1BK32F0R1204817',26,104);

  const X=[26,210,470,590,690];
  cx.fillStyle='#5B6478'; cx.font='600 23px ui-monospace,Consolas,monospace';
  ['PART','NAMA','LOKASI','QTY','STATUS'].forEach((h,i)=>cx.fillText(h,X[i],152));
  cx.strokeStyle='#2A3358'; cx.lineWidth=2;
  cx.beginPath(); cx.moveTo(26,172); cx.lineTo(W-26,172); cx.stroke();

  ORDER.forEach((o,i)=>{
    const y=212+i*56;
    let label='MENUNGGU', col='#5B6478';
    if(s.confirmed[i]){ label='✓ OK'; col='#46C46E'; }
    else if(i===s.active){
      label = s.wrongNow ? 'BIN SALAH' : 'AKTIF';
      col   = s.wrongNow ? '#FF5A5F'   : '#FFB020';
    }
    cx.font='600 25px ui-monospace,Consolas,monospace';
    cx.fillStyle='#E8EAF2'; cx.fillText(o.part,X[0],y);
    cx.fillStyle='#98A0B3'; cx.fillText(o.name,X[1],y);
    cx.fillStyle='#E8EAF2'; cx.fillText(locName(o),X[2],y);
    cx.fillText('x'+o.qty,X[3],y);
    cx.fillStyle=col; cx.fillText(label,X[4],y);
  });

  const n=s.confirmed.filter(Boolean).length;
  cx.font='700 26px "Segoe UI",sans-serif';
  cx.fillStyle = s.released ? '#46C46E' : '#98A0B3';
  cx.fillText('pick '+n+' / '+ORDER.length+(s.released?'  ·  kit dikirim ke line':''),26,H-40);
  if(s.wrongSeen){
    cx.fillStyle='#FF5A5F'; cx.textAlign='right';
    cx.fillText('salah ambil tercegah: 1',W-26,H-40);
  }
  tv.flush();
}

function makeTV(){
  tv=S.makeScreen(3.2,1.9,900,534);
  const g=new THREE.Group();
  g.position.set(TV[0],0,TV[2]); g.rotation.y=.3;       // menghadap kamera default
  const bezelY=2.5, bezelH=2.1;
  // tiang berhenti di tepi bawah bezel dan berada di belakang layar
  const poleH=bezelY-bezelH/2;
  const pole=new THREE.Mesh(new THREE.BoxGeometry(.14,poleH,.14),steelMat);
  pole.position.set(0,poleH/2,-.08); g.add(pole);
  const foot=new THREE.Mesh(new THREE.BoxGeometry(.8,.06,.5),steelMat);
  foot.position.set(0,.03,-.08); g.add(foot);
  const bezel=new THREE.Mesh(new THREE.BoxGeometry(3.4,bezelH,.1),moduleMat);
  bezel.position.y=bezelY; g.add(bezel);
  tv.mesh.position.set(0,bezelY,.06); g.add(tv.mesh);
  return g;
}

/* ================= titik data ================= */
const DOT_TERM=new THREE.Vector3(TERMINAL[0],1.45,TERMINAL[1]);
const DOT_IOT =new THREE.Vector3(IOT[0],IOT[1]+.25,IOT[2]);
const DOT_TV  =new THREE.Vector3(TV[0]-.4,2.5,TV[2]+.3);

function makeDots(){
  const g=new THREE.Group();
  const mat=new THREE.MeshBasicMaterial({color:C.screen});
  for(let i=0;i<5;i++){
    const d=new THREE.Mesh(new THREE.SphereGeometry(.07,8,6),mat);
    d.visible=false; g.add(d);
  }
  return g;
}
function tickDots(g, el, a, b){
  const active = el>=0 && el<1.6;
  g.children.forEach((d,i)=>{
    const t=el-i*.12;
    if(!active || t<0 || t>1){ d.visible=false; return; }
    d.visible=true;
    d.position.lerpVectors(a,b,t);
    d.position.y += Math.sin(t*Math.PI)*.8;
    d.scale.setScalar(.7+Math.sin(t*Math.PI)*.6);
  });
}

/* ================= status, dihitung dari ct ================= */
function stateAt(ct, win){
  const s={ confirmed:[], active:-1, wrongNow:false, wrongSeen:false, released:false };
  ORDER.forEach((o,i)=>{
    const pw=win['p'+i];
    s.confirmed[i] = !!(pw && ct>=pw[0]+PRESS_AT);
    if(win.scan && pw){
      const [on,off]=lampWindow(i,win);
      if(ct>=on && ct<off) s.active=i;
    }
  });
  if(win.wrong){
    s.wrongNow  = ct>=win.wrong[0]+WRONG_AT && ct<win.wrong[1];
    s.wrongSeen = ct>=win.wrong[0]+WRONG_AT;
  }
  s.released = !!(win.done && ct>=win.done[0]+RELEASE_AT);
  return s;
}
const sigOf=s=>s.confirmed.map(Number).join('')+'|'+s.active+'|'+(+s.wrongNow)+'|'+(+s.wrongSeen)+'|'+(+s.released);

/* kapan lampu pick ke-i menyala dan padam — satu sumber untuk tick() dan test.
   Lampu berikutnya menyala tepat saat tombol pick sebelumnya ditekan. */
function lampWindow(i, win){
  const on = i===0 ? win.scan[0]+SCAN_LIT : win['p'+(i-1)][0]+PRESS_AT;
  return [on, win['p'+i][0]+PRESS_AT];
}

function buildWps(withWrong){
  const w=[{x:HOME[0], z:HOME[1], face:Math.PI, dwell:SCAN_T, event:'scan'}];
  ORDER.forEach((o,i)=>{
    if(withWrong && i===WRONG.before)
      w.push({x:COL_X[WRONG.col], z:OP_Z, face:Math.PI, dwell:WRONG_T, event:'wrong'});
    w.push({x:COL_X[o.col], z:OP_Z, face:Math.PI, dwell:PICK_T, event:'p'+i});
  });
  w.push({x:END[0], z:END[1], face:Math.PI, dwell:DONE_T, event:'done'});
  return w;
}

/* ================= registrasi ================= */
const pickText=o=>'Ambil <b>'+o.qty+'&times; '+o.name+'</b> dari bin yang menyala ('+locName(o)+')';

S.register('picktolamp',{
  label:'Pick to Lamp · Kitting',
  title:'Pick to Lamp &middot; Kitting',
  sub:'Ikuti lampu, tekan tombol, part tidak salah ambil',
  room:{w:ROOM.w,d:ROOM.d,h:ROOM.h,doorW:2.4,doorH:3.0},
  cam:{theta:.62,phi:1.05,r:14.5,target:[0.4,1.0,-0.6],topR:13},
  speed:SPEED,
  smoothTurn:true,
  theme:{ light:{floor:0xAEB4BE}, dark:{floor:0x22262F} },
  legend:[
    ['#2F6FB5','Bin part'],['#46C46E','Lampu aktif'],['#E5484D','Salah ambil'],
    ['#3ED0C2','IoT Node / data'],['#E8B026','Kitting cart']
  ],
  scenarios:{
    normal:{
      label:'Normal — 3 pick sesuai order',
      note:'Order dari middleware diteruskan IoT Node ke lampu di rak. Operator hanya mengikuti lampu: ambil sesuai angka, tekan tombol, lampu padam, lampu berikutnya menyala. <b>Tanpa picking list kertas, tanpa hafalan lokasi part.</b>'
    },
    wrong:{
      label:'Salah ambil — tombol bin salah ditekan',
      note:'Operator menekan tombol bin di sebelah bin yang benar. Pick ditolak dan modul itu berkedip merah, sementara lampu bin yang benar tetap hijau. <b>Part yang salah tidak pernah sampai ke cart</b>, dan kejadiannya tercatat di monitoring.',
      text:{
        idle:'Selesai &mdash; <b>1 salah ambil tercegah sebelum part masuk ke cart</b>'
      }
    }
  },
  flowText:{
    walk:'Operator menuju bin yang lampunya menyala',
    scan:'Scan kanban kit &mdash; <b>order dimuat dari middleware ke IoT Node</b>',
    p0:pickText(ORDER[0]),
    p1:pickText(ORDER[1]),
    p2:pickText(ORDER[2]),
    confirm:'Tombol ditekan &mdash; <b>pick terkonfirmasi, lampu padam, data terkirim</b>',
    reach:'Operator meraih bin&hellip;',
    wrong:'Tombol bin yang salah ditekan &mdash; <b>lampu merah, pick ditolak</b>',
    done:'Kit lengkap &mdash; <b>cart dikirim ke line</b>',
    idle:'Selesai &mdash; <b>'+ORDER.length+' pick, 0 salah ambil, tanpa picking list kertas</b>'
  },

  build(variant, scen){
    S.groups.concept.add(makeRack());
    S.groups.concept.add(makeTerminal());
    S.groups.concept.add(makeIoT());
    S.groups.concept.add(makeTV());
    cart=makeCart(); S.groups.concept.add(cart);
    dotsIn=makeDots(); dotsOut=makeDots();
    S.groups.concept.add(dotsIn, dotsOut);

    S.addLabel('FLOW RACK',null,RACK_X0+BAY_W*COLS/2,RACK_H+.45,RACK_FRONT-RACK_DEPTH/2,1.1);
    S.addLabel('IoT Node','#3ED0C2',IOT[0]+.2,IOT[1]+.65,IOT[2],1.0);
    S.addLabel('SCAN KANBAN','#E9EBEE',TERMINAL[0],2.05,TERMINAL[1],1.0);

    S.actor=makeOperator();

    return {
      wps:buildWps(scen==='wrong'),
      stats:'<b>Rak</b> : flow rack '+COLS+' kolom &times; '+LEVELS+' level &middot; '+(COLS*LEVELS)+' bin<br>'
        +'<b>Modul</b> : lampu + angka qty + tombol per bin<br>'
        +'<b>Kontroler</b> : IoT Node di sisi rak<br>'
        +'<b>Order</b> : KIT-2481 &middot; '+ORDER.length+' part<br>'
        +'<b>Area</b> : 16 &times; 11 &times; 5 m'
    };
  },

  reset(){
    modules.forEach(row=>row.forEach(m=>setModule(m,'off')));
    handParts.forEach(p=>p.visible=false);
    cartParts.forEach(p=>p.visible=false);
    cart.position.set(HOME[0],0,HOME[1]+CART_DZ);
    dotsIn.children.forEach(d=>d.visible=false);
    dotsOut.children.forEach(d=>d.visible=false);
    const s=stateAt(-1,{});
    st.sig=sigOf(s); drawTV(s);
  },

  tick(ct, seg, win, actor){
    const s=stateAt(ct,win);

    /* ---- modul lampu ---- */
    modules.forEach(row=>row.forEach(m=>setModule(m,'off')));
    if(s.active>=0){
      const o=ORDER[s.active];
      setModule(modules[o.lvl][o.col],'on',o.qty,ct);
    }
    if(s.wrongNow) setModule(modules[WRONG.lvl][WRONG.col],'alert',0,ct);
    ORDER.forEach((o,i)=>{
      const pw=win['p'+i];
      if(pw) flashButton(modules[o.lvl][o.col],C.ok,ct,pw[0]+PRESS_AT);
    });
    if(win.wrong) flashButton(modules[WRONG.lvl][WRONG.col],C.alert,ct,win.wrong[0]+WRONG_AT);

    /* ---- part: di tangan lalu di cart ---- */
    ORDER.forEach((o,i)=>{
      const pw=win['p'+i];
      handParts[i].visible = !!(pw && ct>=pw[0]+REACH_AT && ct<pw[0]+PUT_AT);
      cartParts[i].visible = !!(pw && ct>=pw[0]+PUT_AT);
    });

    /* ---- cart ikut di belakang operator, lalu jalan sendiri ke line ---- */
    if(s.released){
      const k=smooth(clamp01((ct-win.done[0]-RELEASE_AT)/(DONE_T-RELEASE_AT)));
      cart.position.set(END[0]+(CART_OUT_X-END[0])*k, 0, END[1]+CART_DZ);
    }else{
      cart.position.set(actor.position.x, 0, actor.position.z+CART_DZ);
    }

    /* ---- data: order masuk ke IoT Node, hasil tiap pick keluar ke monitoring ---- */
    tickDots(dotsIn, win.scan ? ct-(win.scan[0]+.3) : -1, DOT_TERM, DOT_IOT);
    let lastPress=-99;
    ORDER.forEach((o,i)=>{ const pw=win['p'+i]; if(pw && ct>=pw[0]+PRESS_AT) lastPress=pw[0]+PRESS_AT; });
    tickDots(dotsOut, ct-lastPress, DOT_IOT, DOT_TV);
    const busy = (ct-lastPress)<1.2 || (win.scan && ct>=win.scan[0] && ct<win.scan[1]);
    iotLed.material.emissiveIntensity = busy ? ((ct%.2)<.1?1.6:.5) : .4;

    const sig=sigOf(s);
    if(sig!==st.sig){ st.sig=sig; drawTV(s); }

    /* ---- teks status ---- */
    const ev=seg.ev||'';
    if(ev.charAt(0)==='p' && ct-win[ev][0]>=PRESS_AT) return {flow:'confirm'};
    if(ev==='wrong') return ct-win.wrong[0]<WRONG_AT ? {flow:'reach'} : {flow:'wrong', bad:true};
    return null;
  },

  idle(t){
    if(iotLed) iotLed.material.emissiveIntensity=.3+.2*Math.sin(t*2.5);
  }
});
})(window.SIMLAY);
