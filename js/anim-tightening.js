/* ============================================================
   Tightening Tool · Open Protocol
   Carrier membawa sub-assembly ke station dan ditahan stopper. VIN
   discan, middleware mengirim job ke tool lewat Open Protocol, lalu
   operator mengencangkan 6 baut sesuai urutan job. Hasil tiap baut
   (torsi + sudut) kembali ke middleware dan tampil di monitoring.
   Stopper baru turun setelah semua baut OK.

   Tool dan scanner mengirim data langsung ke server middleware, tanpa
   IoT node di station. Di animasi, layar monitoring mewakili server itu.

   Aktor timeline = OPERATOR, dengan tiga dwell: arrive, work, done.
   Keenam baut dijangkau dari satu posisi kerja; jadwal per baut
   dihitung stepWindows(), satu sumber untuk tick() dan test.
   ============================================================ */
"use strict";
(function(S){
const C=S.C;
const ROOM={w:16,d:11,h:5};

/* ---- conveyor & carrier ---- */
const CONV_X0=-7.4;
const CONV_X1=7.4;
const CONV_W=1.0;                   // lebar conveyor (z)
const CONV_Y=0.78;                  // puncak roller
const CARRIER_T=0.08;
const PLATE_T=0.06;
const PART_TOP=CONV_Y+CARRIER_T+PLATE_T;
const BOLT_TOP=PART_TOP+.045;       // puncak kepala baut, tempat socket menempel
const CARRIER_IN=-3.8;
const CARRIER_OUT=4.4;
const STOPPER_X=0.95;               // stopper di hilir carrier (carrier sepanjang 1.7 m)
const STOPPER_UP=CONV_Y+.06;

/* ---- baut: [x, z] relatif pusat part, B1..B6 ---- */
const BOLTS=[[-.55,-.17],[0,-.17],[.55,-.17],[-.55,.17],[0,.17],[.55,.17]];
/* urutan job: mulai dari tengah, menyilang ke luar */
const SEQUENCE=[1,4,0,5,2,3];
const NG_STEP=3;                    // skenario NG: langkah ke-4 kurang torsi
const SPEC_NM=45;
const TOL_NM=3;
const RESULTS=[
  {nm:45.2,deg:32},{nm:44.8,deg:30},{nm:45.6,deg:33},
  {nm:44.9,deg:31},{nm:45.1,deg:32},{nm:45.4,deg:30}
];
const NG_RESULT={nm:41.6,deg:18};
const VIN='JM1BK32F0R1204817';
const JOB_ID='CM-45';

/* ---- area kerja ---- */
const WORK=[0,0.88];                // operator berdiri di depan conveyor, menghadap -z
const HOME=[-1.7,1.35];             // menunggu carrier datang, mundur saat carrier dilepas
const MAX_REACH=1.25;
const SPEED=1.2;
const HOVER=0.14;                   // tinggi socket melayang di atas baut
const SCANNER=[-1.1,-0.95];
const STACK=[1.0,-0.8];
const BAL_POST=[0.1,-0.85];         // tiang tool balancer
const BALANCER=new THREE.Vector3(0.1,2.3,0.25);
const TOOL_PARK=new THREE.Vector3(0.6,1.3,0.5);   // tool menggantung di balancer, kanan operator
const TV=[3.7,0,-2.7];

/* ---- durasi (detik) ---- */
const ARRIVE_T=4.2;
const MOVE_END=1.8;                 // carrier berhenti di stopper
const SCAN_AT=2.0;                  // VIN terbaca
const JOB_AT=2.9;                   // job terkirim ke tool
const STEP_T=1.6;                   // satu baut normal
const APPROACH_AT=0.3;              // socket menempel di baut
const RESULT_AT=1.1;                // hasil keluar dari controller
const RETRY_START=2.1;              // skenario NG: mulai kencangkan ulang
const RETRY_OK_AT=2.9;
const NG_STEP_T=3.4;
const DONE_T=3.2;
const RELEASE_AT=0.5;               // stopper turun, relatif awal done
const STOPPER_T=0.25;               // waktu stopper turun sebelum carrier jalan
const RELEASE_MOVE=2.2;

/* ---- resource yang dipakai ulang antar build ---- */
const steelMat =S.shared(new THREE.MeshStandardMaterial({color:0x8A93A6,roughness:.45,metalness:.55}));
const darkMat  =S.shared(new THREE.MeshStandardMaterial({color:0x2B3038,roughness:.6,metalness:.3}));
const partMat  =S.shared(new THREE.MeshStandardMaterial({color:0x5E6675,roughness:.4,metalness:.7}));
const boltMat  =S.shared(new THREE.MeshStandardMaterial({color:0xC7CBD3,roughness:.35,metalness:.8}));
const yellowMat=S.shared(new THREE.MeshStandardMaterial({color:0xE8B026,roughness:.5,metalness:.3}));

const RING={wait:0x5B6478, active:0xFFB020, ng:0xE5484D, retry:0xFFB020, ok:0x46C46E};
const ROW_STYLE={wait:['MENUNGGU','#5B6478'], active:['PROSES','#FFB020'],
                 ng:['NG','#FF5A5F'], retry:['ULANG','#FFB020'], ok:['OK','#46C46E']};

let carrier=null, stopper=null, bolts=[], tool=null, toolScr=null, arm=null, cable=null;
let stack=null, scanBeam=null, tv=null, dotsScan=null, dotsJob=null, dotsRes=null;
let ngMode=false;
const st={ sig:'' };

const smooth=t=>t*t*(3-2*t);
const clamp01=t=>Math.max(0,Math.min(1,t));
const _a=new THREE.Vector3(), _b=new THREE.Vector3(), _d=new THREE.Vector3(), _up=new THREE.Vector3(0,1,0);
const SHOULDER=new THREE.Vector3(.17,.92,.05);
const HANDLE_END=new THREE.Vector3(0,.13,.36);   // ujung gagang, relatif pangkal socket

/* batang tipis dari `from` ke `to`; geometry-nya berpangkal di y=0 dan menghadap +y */
function unitRod(r, mat){
  const geo=new THREE.CylinderGeometry(r,r,1,8); geo.translate(0,.5,0);
  return new THREE.Mesh(geo,mat);
}
function aimRod(mesh, from, to){
  _d.subVectors(to,from);
  mesh.position.copy(from);
  mesh.scale.set(1,Math.max(.01,_d.length()),1);
  mesh.quaternion.setFromUnitVectors(_up,_d.normalize());
}

/* ================= conveyor, carrier, part ================= */
function makeConveyor(){
  const g=new THREE.Group();
  const len=CONV_X1-CONV_X0, mid=(CONV_X0+CONV_X1)/2;
  for(const sz of [-1,1]){
    const rail=new THREE.Mesh(new THREE.BoxGeometry(len,.12,.06),steelMat);
    rail.position.set(mid,CONV_Y-.02,sz*(CONV_W/2+.03)); g.add(rail);
  }
  // roller melintang: CylinderGeometry default sumbunya y, dibaringkan ke z
  const rollerGeo=new THREE.CylinderGeometry(.045,.045,CONV_W,10);
  for(let x=CONV_X0+.2;x<CONV_X1;x+=.35){
    const r=new THREE.Mesh(rollerGeo,steelMat);
    r.rotation.x=Math.PI/2; r.position.set(x,CONV_Y-.045,0); g.add(r);
  }
  for(let x=CONV_X0+.4;x<CONV_X1;x+=2.2) for(const sz of [-1,1]){
    const leg=new THREE.Mesh(new THREE.BoxGeometry(.08,CONV_Y-.08,.08),darkMat);
    leg.position.set(x,(CONV_Y-.08)/2,sz*(CONV_W/2+.03)); g.add(leg);
  }
  stopper=new THREE.Mesh(new THREE.BoxGeometry(.08,.16,.5),
    new THREE.MeshStandardMaterial({color:C.alert,roughness:.5}));
  stopper.position.set(STOPPER_X,STOPPER_UP,0); g.add(stopper);
  return g;
}

function makeCarrier(){
  const g=new THREE.Group();
  const base=new THREE.Mesh(new THREE.BoxGeometry(1.7,CARRIER_T,.84),darkMat);
  base.position.y=CONV_Y+CARRIER_T/2; g.add(base);
  // plat VIN di sisi belakang, menghadap scanner
  const vin=new THREE.Mesh(new THREE.PlaneGeometry(.26,.06),new THREE.MeshBasicMaterial({color:0xF4F6F8}));
  vin.position.set(-.55,CONV_Y+CARRIER_T/2,-.421); vin.rotation.y=Math.PI; g.add(vin);
  // sub-assembly: plat dasar + balok penguat di tengah, baut di kiri-kanan balok
  const plate=new THREE.Mesh(new THREE.BoxGeometry(1.46,PLATE_T,.56),partMat);
  plate.position.y=CONV_Y+CARRIER_T+PLATE_T/2; g.add(plate);
  const beam=new THREE.Mesh(new THREE.BoxGeometry(1.3,.12,.1),partMat);
  beam.position.y=PART_TOP+.06; g.add(beam);
  bolts=BOLTS.map(([bx,bz])=>{
    const head=new THREE.Mesh(new THREE.CylinderGeometry(.034,.034,.045,6),boltMat);
    head.position.set(bx,PART_TOP+.0225,bz); g.add(head);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.05,.075,24),
      new THREE.MeshBasicMaterial({color:RING.wait,transparent:true,opacity:.9,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2; ring.position.set(bx,PART_TOP+.006,bz); g.add(ring);
    return {head, ring};
  });
  return g;
}

/* ================= tool & balancer ================= */
function makeTool(){
  const g=new THREE.Group();                       // origin = ujung socket
  const socket=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.08,10),boltMat);
  socket.position.y=.04; g.add(socket);
  const head=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.08,12),yellowMat);
  head.position.y=.12; g.add(head);
  const handle=new THREE.Mesh(new THREE.BoxGeometry(.06,.05,.34),darkMat);
  handle.position.set(0,.13,.2); g.add(handle);    // gagang mengarah ke operator (+z)
  toolScr=new THREE.Mesh(new THREE.PlaneGeometry(.05,.035),
    new THREE.MeshStandardMaterial({color:C.screen,emissive:C.screen,emissiveIntensity:.5}));
  toolScr.rotation.x=-Math.PI/2; toolScr.position.set(0,.158,.14); g.add(toolScr);
  return g;
}

function makeBalancer(){
  const g=new THREE.Group();
  const topY=BALANCER.y+.15;
  const post=new THREE.Mesh(new THREE.BoxGeometry(.08,topY,.08),steelMat);
  post.position.set(BAL_POST[0],topY/2,BAL_POST[1]); g.add(post);
  const boomLen=BALANCER.z-BAL_POST[1];
  const boom=new THREE.Mesh(new THREE.BoxGeometry(.07,.07,boomLen+.08),steelMat);
  boom.position.set(BAL_POST[0],topY,BAL_POST[1]+boomLen/2); g.add(boom);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.16,12),yellowMat);
  body.position.set(BALANCER.x,BALANCER.y+.06,BALANCER.z); g.add(body);
  cable=unitRod(.006,darkMat); g.add(cable);
  return g;
}

/* ================= scanner & stack light ================= */
function makeScanner(){
  const g=new THREE.Group(); g.position.set(SCANNER[0],0,SCANNER[1]);
  const post=new THREE.Mesh(new THREE.BoxGeometry(.07,1.0,.07),steelMat);
  post.position.y=.5; g.add(post);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.16,.1,.12),darkMat);
  head.position.y=1.05; g.add(head);
  scanBeam=unitRod(.008,new THREE.MeshBasicMaterial({color:0xFF4040,transparent:true,opacity:.75}));
  scanBeam.visible=false;
  return g;
}

function makeStack(){
  const g=new THREE.Group(); g.position.set(STACK[0],0,STACK[1]);
  const pole=new THREE.Mesh(new THREE.BoxGeometry(.05,1.7,.05),steelMat);
  pole.position.y=.85; g.add(pole);
  const lamp=(col,y)=>{
    const m=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,.14,14),
      new THREE.MeshStandardMaterial({color:col,emissive:0x000000,roughness:.4}));
    m.position.y=y; g.add(m); return m;
  };
  stack={ red:lamp(0x7A2A2A,2.05), amber:lamp(0x7A5A1A,1.91), green:lamp(0x1F5A35,1.77) };
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,.03,14),darkMat);
  cap.position.y=2.14; g.add(cap);
  return g;
}
function setLamp(m, on, col){
  m.material.emissive.setHex(on?col:0x000000);
  m.material.emissiveIntensity=on?1.5:0;
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
  // lengan ke gagang tool; hanya tampil saat operator memegang tool
  arm=unitRod(.035,new THREE.MeshStandardMaterial({color:0x3D4763,roughness:.7}));
  arm.visible=false; g.add(arm);
  return g;
}

/* ================= TV monitoring ================= */
function drawTV(s){
  const {cx,cv}=tv, W=cv.width, H=cv.height;
  cx.fillStyle='#0F1424'; cx.fillRect(0,0,W,H);
  cx.fillStyle='#1B2540'; cx.fillRect(0,0,W,70);
  cx.textBaseline='middle';
  cx.textAlign='left'; cx.fillStyle='#3ED0C2'; cx.font='700 36px "Segoe UI",sans-serif';
  cx.fillText('TIGHTENING  ·  STATION 12',26,36);
  cx.textAlign='right'; cx.fillStyle='#98A0B3'; cx.font='500 23px "Segoe UI",sans-serif';
  cx.fillText('Open Protocol',W-26,36);

  cx.textAlign='left'; cx.font='500 24px ui-monospace,Consolas,monospace';
  cx.fillStyle = s.vin ? '#E8EAF2' : '#5B6478';
  cx.fillText(s.vin ? 'VIN '+VIN : 'menunggu carrier…',26,102);
  if(s.job){
    cx.fillStyle='#98A0B3';
    cx.fillText('JOB '+JOB_ID+'  ·  '+BOLTS.length+' baut  ·  '+SPEC_NM+' Nm ±'+TOL_NM,26,136);
  }

  const X=[26,100,230,420,560];
  cx.fillStyle='#5B6478'; cx.font='600 22px ui-monospace,Consolas,monospace';
  ['#','BAUT','TORSI','SUDUT','STATUS'].forEach((h,i)=>cx.fillText(h,X[i],184));
  cx.strokeStyle='#2A3358'; cx.lineWidth=2;
  cx.beginPath(); cx.moveTo(26,202); cx.lineTo(W-26,202); cx.stroke();

  SEQUENCE.forEach((b,k)=>{
    const y=236+k*46, r=s.rows[k];
    const res = r==='ng' ? NG_RESULT : RESULTS[k];
    const shown = r==='ok' || r==='ng';
    cx.font='600 24px ui-monospace,Consolas,monospace';
    cx.fillStyle='#98A0B3'; cx.fillText(String(k+1),X[0],y);
    cx.fillStyle='#E8EAF2'; cx.fillText('B'+(b+1),X[1],y);
    cx.fillStyle = r==='ng' ? '#FF5A5F' : '#E8EAF2';
    cx.fillText(shown ? res.nm.toFixed(1)+' Nm' : '—',X[2],y);
    cx.fillText(shown ? res.deg+'°' : '—',X[3],y);
    cx.fillStyle=ROW_STYLE[r][1]; cx.fillText(ROW_STYLE[r][0],X[4],y);
  });

  cx.font='700 26px "Segoe UI",sans-serif';
  cx.fillStyle = s.count===BOLTS.length ? '#46C46E' : '#E8EAF2';
  cx.fillText('OK '+s.count+' / '+BOLTS.length,26,H-34);
  if(s.vin){
    cx.textAlign='right';
    cx.fillStyle = s.released ? '#46C46E' : (s.ng ? '#FF5A5F' : '#FFB020');
    cx.fillText(s.released ? 'CARRIER DILEPAS' : 'CARRIER DITAHAN',W-26,H-34);
  }
  tv.flush();
}

function makeTV(){
  tv=S.makeScreen(3.2,1.99,900,560);
  const g=new THREE.Group();
  g.position.set(TV[0],0,TV[2]); g.rotation.y=.05;      // menghadap kamera default
  const bezelY=2.5, bezelH=2.15;
  // tiang berhenti di tepi bawah bezel dan berada di belakang layar
  const poleH=bezelY-bezelH/2;
  const pole=new THREE.Mesh(new THREE.BoxGeometry(.14,poleH,.14),steelMat);
  pole.position.set(0,poleH/2,-.08); g.add(pole);
  const foot=new THREE.Mesh(new THREE.BoxGeometry(.8,.06,.5),steelMat);
  foot.position.set(0,.03,-.08); g.add(foot);
  const bezel=new THREE.Mesh(new THREE.BoxGeometry(3.4,bezelH,.1),darkMat);
  bezel.position.y=bezelY; g.add(bezel);
  tv.mesh.position.set(0,bezelY,.06); g.add(tv.mesh);
  return g;
}

/* ================= titik data ================= */
const DOT_SCAN=new THREE.Vector3(SCANNER[0],1.1,SCANNER[1]);
const DOT_TV  =new THREE.Vector3(TV[0]-.3,2.5,TV[2]+.2);    // layar monitoring = ujung server middleware
function makeDots(){
  const g=new THREE.Group();
  const mat=new THREE.MeshBasicMaterial({color:C.screen});
  for(let i=0;i<5;i++){
    const d=new THREE.Mesh(new THREE.SphereGeometry(.06,8,6),mat);
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
    d.position.y += Math.sin(t*Math.PI)*.7;
    d.scale.setScalar(.7+Math.sin(t*Math.PI)*.6);
  });
}

/* ================= status, dihitung dari ct ================= */
function stateAt(ct, win){
  const s={ vin:false, job:false, rows:[], count:0, ng:false, released:false };
  if(win.arrive){
    s.vin = ct>=win.arrive[0]+SCAN_AT;
    s.job = ct>=win.arrive[0]+JOB_AT;
  }
  const steps = win.work ? stepWindows(win.work[0], ngMode) : null;
  SEQUENCE.forEach((b,k)=>{
    let r='wait';
    if(steps){
      const e=ct-steps[k][0], isNG=ngMode && k===NG_STEP;
      if(ct>=okAt(k,steps,ngMode))     r='ok';
      else if(isNG && e>=RETRY_START)  r='retry';
      else if(isNG && e>=RESULT_AT)    r='ng';
      else if(e>=0)                    r='active';
    }
    s.rows.push(r);
  });
  s.count = steps ? okCountAt(ct,steps,ngMode) : 0;
  s.ng = s.rows.includes('ng') || s.rows.includes('retry');
  s.released = !!(win.done && ct>=win.done[0]+RELEASE_AT);
  return s;
}
const sigOf=s=>s.rows.join(',')+'|'+s.count+'|'+(+s.vin)+(+s.job)+(+s.released);

/* 0 = socket melayang, 1 = menempel di baut */
function engageDepth(k, e){
  const ramp=(a,b)=> e<a ? 0 : e<a+.12 ? (e-a)/.12 : e<b ? 1 : e<b+.1 ? 1-(e-b)/.1 : 0;
  let v=ramp(APPROACH_AT,RESULT_AT);
  if(ngMode && k===NG_STEP) v=Math.max(v,ramp(RETRY_START,RETRY_OK_AT));
  return v;
}

function boltWorld(b, out, y){
  return out.set(carrier.position.x+BOLTS[b][0], y, BOLTS[b][1]);
}

/* posisi tool di dunia; mengembalikan langkah aktif atau -1 */
function placeTool(ct, steps){
  const hoverY=BOLT_TOP+HOVER;
  if(!steps || ct<steps[0][0]){ tool.position.copy(TOOL_PARK); return -1; }
  const last=steps.length-1;
  if(ct>=steps[last][1]){                          // kembali digantung balancer
    boltWorld(SEQUENCE[last],_a,hoverY);
    tool.position.lerpVectors(_a,TOOL_PARK,smooth(clamp01((ct-steps[last][1])/.5)));
    return -1;
  }
  let k=0; while(ct>=steps[k][1]) k++;
  const e=ct-steps[k][0];
  boltWorld(SEQUENCE[k],_a,hoverY);
  if(k===0) _b.copy(TOOL_PARK); else boltWorld(SEQUENCE[k-1],_b,hoverY);
  tool.position.lerpVectors(_b,_a,smooth(clamp01(e/APPROACH_AT)));
  tool.position.y -= HOVER*engageDepth(k,e);
  return k;
}

/* ================= jadwal langkah — satu sumber untuk tick() dan test ================= */
function workDuration(withNG){
  return SEQUENCE.length*STEP_T + (withNG ? NG_STEP_T-STEP_T : 0);
}
function stepWindows(t0, withNG){
  let t=t0;
  return SEQUENCE.map((b,k)=>{
    const d=(withNG && k===NG_STEP) ? NG_STEP_T : STEP_T;
    const w=[t,t+d]; t+=d; return w;
  });
}
function okAt(k, steps, withNG){
  return steps[k][0] + ((withNG && k===NG_STEP) ? RETRY_OK_AT : RESULT_AT);
}
function okCountAt(ct, steps, withNG){
  return steps.reduce((n,_,k)=>n+(ct>=okAt(k,steps,withNG)?1:0),0);
}
function buildWps(withNG){
  return [
    {x:HOME[0], z:HOME[1], face:Math.PI, dwell:ARRIVE_T,             event:'arrive'},
    {x:WORK[0], z:WORK[1], face:Math.PI, dwell:workDuration(withNG), event:'work'},
    {x:HOME[0], z:HOME[1], face:Math.PI, dwell:DONE_T,               event:'done'}
  ];
}

/* ================= registrasi ================= */
const boltName=k=>'B'+(SEQUENCE[k]+1);
const flowSteps={};
SEQUENCE.forEach((b,k)=>{
  flowSteps['s'+k]='Kencangkan <b>'+boltName(k)+'</b> &mdash; urutan '+(k+1)+' dari '+SEQUENCE.length;
  flowSteps['r'+k]=boltName(k)+' OK &mdash; <b>'+RESULTS[k].nm.toFixed(1)+' Nm &middot; '+RESULTS[k].deg+'&deg;</b> terkirim ke middleware';
});

S.register('tightening',{
  label:'Tightening Tool · Open Protocol',
  title:'Tightening Tool &middot; Open Protocol',
  sub:'Job per VIN, hasil per baut, carrier ditahan sampai semua OK',
  room:{w:ROOM.w,d:ROOM.d,h:ROOM.h,doorW:2.4,doorH:3.0},
  cam:{theta:.5,phi:1.02,r:9,target:[0.3,0.95,-0.2],topR:9},
  speed:SPEED,
  smoothTurn:true,
  theme:{ light:{floor:0xAEB4BE}, dark:{floor:0x22262F} },
  legend:[
    ['#5E6675','Sub-assembly'],['#FFB020','Baut diproses'],['#46C46E','Baut OK'],
    ['#E5484D','Baut NG'],['#3ED0C2','Data ke middleware'],['#E8B026','Tool']
  ],
  scenarios:{
    normal:{
      label:'Normal — 6/6 baut OK',
      note:'VIN menentukan job: jumlah baut, urutan, dan target torsi dikirim middleware ke tool lewat Open Protocol. Tiap baut yang selesai langsung melaporkan torsi dan sudutnya. <b>Stopper baru turun setelah semua baut OK</b>, dan hasilnya tersimpan per VIN.'
    },
    ng:{
      label:'NG kurang torsi — baut urutan ke-4',
      note:'Baut urutan ke-4 hanya mencapai '+NG_RESULT.nm.toFixed(1)+' Nm, di bawah batas '+(SPEC_NM-TOL_NM)+' Nm. Counter tertahan, stack light merah, dan <b>carrier tetap ditahan stopper</b> sampai baut itu dikencangkan ulang dan lolos spek.',
      text:{
        idle:'Selesai &mdash; <b>baut NG tertangkap dan dikencangkan ulang sebelum carrier lolos</b>'
      }
    }
  },
  flowText:Object.assign({
    walk:'Operator bergerak di station',
    arrive:'Carrier masuk station &mdash; <b>stopper menahan carrier</b>',
    scan:'VIN terbaca &mdash; <b>middleware mencari job untuk VIN ini</b>',
    job:'Job dikirim ke tool lewat <b>Open Protocol</b> &mdash; '+BOLTS.length+' baut &middot; '+SPEC_NM+' Nm &plusmn;'+TOL_NM,
    ng:boltName(NG_STEP)+' NG &mdash; <b>'+NG_RESULT.nm.toFixed(1)+' Nm, di bawah batas '+(SPEC_NM-TOL_NM)+' Nm</b> &middot; counter tertahan '+NG_STEP+'/'+BOLTS.length,
    retry:'Kencangkan ulang <b>'+boltName(NG_STEP)+'</b> &mdash; carrier tetap ditahan',
    allok:'Semua baut OK &mdash; <b>operator mundur, stopper siap turun</b>',
    done:'Stopper turun &mdash; <b>carrier dilepas ke proses berikutnya</b>',
    idle:'Selesai &mdash; <b>'+BOLTS.length+'/'+BOLTS.length+' baut OK, hasil tersimpan per VIN</b>'
  }, flowSteps),

  build(variant, scen){
    ngMode = scen==='ng';
    S.groups.concept.add(makeConveyor());
    carrier=makeCarrier(); S.groups.concept.add(carrier);
    S.groups.concept.add(makeBalancer());
    tool=makeTool(); S.groups.concept.add(tool);
    S.groups.concept.add(makeScanner(), makeStack(), makeTV());
    S.groups.concept.add(scanBeam);
    dotsScan=makeDots(); dotsJob=makeDots(); dotsRes=makeDots();
    S.groups.concept.add(dotsScan, dotsJob, dotsRes);

    S.addLabel('SCAN VIN','#E9EBEE',SCANNER[0],1.8,SCANNER[1],1.0);
    S.addLabel('STOPPER','#E9EBEE',STOPPER_X+.55,1.25,.35,.9);

    S.actor=makeOperator();

    return {
      wps:buildWps(ngMode),
      stats:'<b>Station</b> : 12 &middot; tightening sub-assembly<br>'
        +'<b>Tool</b> : Tohnichi &middot; Open Protocol<br>'
        +'<b>Job</b> : '+JOB_ID+' &middot; '+BOLTS.length+' baut &middot; '+SPEC_NM+' Nm &plusmn;'+TOL_NM+'<br>'
        +'<b>Urutan</b> : '+SEQUENCE.map((b,k)=>boltName(k)).join(' &rarr; ')+'<br>'
        +'<b>Area</b> : 16 &times; 11 &times; 5 m'
    };
  },

  reset(){
    carrier.position.x=CARRIER_IN;
    stopper.position.y=STOPPER_UP;
    tool.position.copy(TOOL_PARK);
    _a.copy(tool.position).y+=.16; aimRod(cable,BALANCER,_a);
    arm.visible=false; scanBeam.visible=false;
    bolts.forEach(b=>{ b.ring.material.color.setHex(RING.wait); b.ring.material.opacity=.9; b.head.rotation.y=0; });
    setLamp(stack.red,false); setLamp(stack.amber,false); setLamp(stack.green,false);
    toolScr.material.emissive.setHex(C.screen);
    [dotsScan,dotsJob,dotsRes].forEach(g=>g.children.forEach(d=>d.visible=false));
    const s=stateAt(-1,{});
    st.sig=sigOf(s); drawTV(s);
  },

  tick(ct, seg, win, actor){
    const s=stateAt(ct,win);
    const steps = win.work ? stepWindows(win.work[0], ngMode) : null;

    /* ---- carrier & stopper ---- */
    let cx=CARRIER_IN;
    if(win.arrive) cx=CARRIER_IN*(1-smooth(clamp01((ct-win.arrive[0])/MOVE_END)));
    if(s.released){
      const e=ct-win.done[0]-RELEASE_AT;
      stopper.position.y=STOPPER_UP-.18*clamp01(e/STOPPER_T);
      cx=CARRIER_OUT*smooth(clamp01((e-STOPPER_T)/RELEASE_MOVE));
    }else stopper.position.y=STOPPER_UP;
    carrier.position.x=cx;

    /* ---- tool, kabel balancer, lengan operator ---- */
    const k=placeTool(ct,steps);
    _a.copy(tool.position).y+=.16; aimRod(cable,BALANCER,_a);
    arm.visible = !!(steps && ct>=steps[0][0] && ct<steps[steps.length-1][1]);
    if(arm.visible){
      actor.updateMatrixWorld(true);
      _b.copy(HANDLE_END).add(tool.position);
      actor.worldToLocal(_b);
      aimRod(arm,SHOULDER,_b);
    }

    /* ---- baut: warna cincin + kepala berputar saat dikencangkan ---- */
    SEQUENCE.forEach((b,i)=>{
      const r=s.rows[i], ring=bolts[b].ring;
      ring.material.color.setHex(RING[r]);
      ring.material.opacity = r==='ng' ? ((ct%.4)<.2?1:.35)
        : (r==='active'||r==='retry') ? .55+.45*Math.abs(Math.sin(ct*6)) : .9;
    });
    if(k>=0){
      const e=ct-steps[k][0];
      if(engageDepth(k,e)>=1) bolts[SEQUENCE[k]].head.rotation.y=e*16;
    }

    /* ---- layar kecil di tool ---- */
    const scr = s.ng ? C.alert : (k>=0 && s.rows[k]==='ok' ? C.ok : C.screen);
    toolScr.material.emissive.setHex(scr);

    /* ---- stack light ---- */
    setLamp(stack.red, s.ng && (ct%.5)<.25, 0xFF3B3B);
    setLamp(stack.amber, s.job && !s.released && !s.ng, 0xFFB020);
    setLamp(stack.green, s.released, 0x46C46E);

    /* ---- scan VIN ---- */
    const scanning = !!(win.arrive && ct>=win.arrive[0]+SCAN_AT-.3 && ct<win.arrive[0]+SCAN_AT+.5);
    scanBeam.visible=scanning;
    if(scanning){ _b.set(carrier.position.x-.55,CONV_Y+.04,-.42); aimRod(scanBeam,DOT_SCAN,_b); }

    /* ---- data langsung ke/dari server middleware: VIN keluar, job masuk ke tool,
            hasil tiap baut keluar dari tool ---- */
    _a.copy(tool.position).y+=.16;
    tickDots(dotsScan, win.arrive ? ct-(win.arrive[0]+SCAN_AT) : -1, DOT_SCAN, DOT_TV);
    tickDots(dotsJob,  win.arrive ? ct-(win.arrive[0]+JOB_AT)  : -1, DOT_TV, _a);
    let lastRes=-99;
    if(steps) SEQUENCE.forEach((b,i)=>{
      const t0=steps[i][0];
      [RESULT_AT].concat(ngMode && i===NG_STEP ? [RETRY_OK_AT] : []).forEach(at=>{
        if(ct>=t0+at) lastRes=Math.max(lastRes,t0+at);
      });
    });
    tickDots(dotsRes, ct-lastRes, _a, DOT_TV);

    const sig=sigOf(s);
    if(sig!==st.sig){ st.sig=sig; drawTV(s); }

    /* ---- teks status ---- */
    const ev=seg.ev||'';
    if(ev==='arrive'){
      const e=ct-win.arrive[0];
      return {flow: e<SCAN_AT ? 'arrive' : (e<JOB_AT ? 'scan' : 'job')};
    }
    if(k>=0){
      const e=ct-steps[k][0], isNG=ngMode && k===NG_STEP;
      if(!isNG) return {flow: e<RESULT_AT ? 's'+k : 'r'+k};
      if(e<RESULT_AT)   return {flow:'s'+k};
      if(e<RETRY_START) return {flow:'ng', bad:true};
      if(e<RETRY_OK_AT) return {flow:'retry', bad:true};
      return {flow:'r'+k};
    }
    if(steps && ct>=steps[steps.length-1][1] && !s.released) return {flow:'allok'};
    return null;
  }
});
})(window.SIMLAY);
