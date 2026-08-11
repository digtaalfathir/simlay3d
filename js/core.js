/* ============================================================
   core — renderer, kamera, tema, dan helper yang dipakai semua animasi.

   Sengaja plain script + global SIMLAY, bukan ES module, supaya
   index.html tetap bisa dibuka langsung lewat file:// tanpa server.
   ============================================================ */
"use strict";
window.SIMLAY = (function(){

const S = { anims:{}, groups:{}, cur:null, room:null, actor:null };
S.register = function(id, def){ def.id = id; S.anims[id] = def; };

/* ================= palet objek 3D ================= */
const C = S.C = {
  rackBlue:0x2A3268, rackDark:0x1E2450, deck:0xCFC5A8, gold:0xDFB63C,
  antenna:0xE9EBEE, antMount:0x3A4055, cone:0xDFB63C,
  station:0x22252B, screen:0x3ED0C2, ring:0xC79A22,
  door:0x565E75, ok:0x2E9E57, alert:0xD6373C, path:0xC79A22, officer:0xD8DCE6,
  steel:0xD8DBE0, steelDark:0xB4B8C0,
  fork:0xF0A21C, forkDark:0xB8760D, tyre:0x23262E,
  box:0xC9A46B, boxDark:0xA07E4A, pallet:0xB08A55
};

const T3D = {
  light:{ bg:0xE7EAF1, fog:0xE7EAF1, floor:0xB9BEC9, wall:0x8B96B5, wallOp:.14,
          edge:0x9AA3BE, hemi:1.0, hemiG:0xB8BCC8, sun:1.0, ring:0xC79A22,
          grid:[0x8F96A8,0xA7ADBD] },
  dark:{  bg:0x0D101C, fog:0x0D101C, floor:0x262B36, wall:0x39415F, wallOp:.16,
          edge:0x4A5480, hemi:.85, hemiG:0x14161F, sun:.95, ring:0xDFB63C,
          grid:[0x3A4260,0x2C3350] }
};
let themeName = 'dark';

/* ================= renderer / scene ================= */
const scene = S.scene = new THREE.Scene();
const camera = S.camera = new THREE.PerspectiveCamera(46, innerWidth/innerHeight, .1, 400);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.getElementById('scene').appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xFFFFFF, 0xB8BCC8, 1.0); scene.add(hemi);
const sun  = new THREE.DirectionalLight(0xFFF4DC, 1.0); sun.position.set(7,11,5); scene.add(sun);
const fill = new THREE.DirectionalLight(0x8FA3D9, .28); fill.position.set(-8,6,-6); scene.add(fill);

/* ================= orbit ================= */
const orbit = { theta:.72, phi:1.08, r:16.5, target:new THREE.Vector3(0,.9,.4), topView:false, topR:15.5 };
function applyCam(){
  if(orbit.topView){
    camera.up.set(0,0,-1);
    camera.position.set(orbit.target.x, orbit.topR, orbit.target.z + .001);
  }else{
    camera.up.set(0,1,0);
    const s = Math.sin(orbit.phi);
    camera.position.set(
      orbit.target.x + orbit.r*s*Math.sin(orbit.theta),
      orbit.target.y + orbit.r*Math.cos(orbit.phi),
      orbit.target.z + orbit.r*s*Math.cos(orbit.theta));
  }
  camera.lookAt(orbit.target);
}
let drag=null, zoomMin=6, zoomMax=34;
renderer.domElement.addEventListener('pointerdown', e=>{drag={x:e.clientX,y:e.clientY};});
addEventListener('pointerup', ()=>drag=null);
addEventListener('pointermove', e=>{
  if(!drag || orbit.topView) return;
  orbit.theta -= (e.clientX-drag.x)*.006;
  orbit.phi = Math.min(1.5, Math.max(.25, orbit.phi - (e.clientY-drag.y)*.005));
  drag={x:e.clientX,y:e.clientY}; applyCam();
});
renderer.domElement.addEventListener('wheel', e=>{
  e.preventDefault();
  const k=1+Math.sign(e.deltaY)*.08;
  const clamp=v=>Math.min(zoomMax, Math.max(zoomMin, v*k));
  if(orbit.topView) orbit.topR=clamp(orbit.topR); else orbit.r=clamp(orbit.r);
  applyCam();
},{passive:false});

/* ================= resource bersama ================= */
/* Geometry/material yang dipakai ulang antar build tidak boleh di-dispose. */
const SHARED = new Set();
S.shared = o => { SHARED.add(o); return o; };

S.disposeGroup = function(g){
  if(!g) return;
  g.traverse(o=>{
    // JANGAN buang geometry sprite: three r128 memakai satu BufferGeometry bersama
    // untuk SEMUA sprite, jadi membuangnya merusak label yang dibuat sesudahnya.
    if(o.geometry && !o.isSprite && !SHARED.has(o.geometry)) o.geometry.dispose();
    if(o.material){
      (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
        if(SHARED.has(m)) return;
        if(m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
  if(g.parent) g.parent.remove(g);
};

/* ================= ruangan ================= */
let roomGroup=null; const roomRef={};
function buildRoom(R){
  S.disposeGroup(roomGroup);
  roomGroup = new THREE.Group(); scene.add(roomGroup);
  const g = roomGroup;

  roomRef.floorMat = new THREE.MeshStandardMaterial({color:0xB9BEC9, roughness:.95});
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(R.w, R.d), roomRef.floorMat);
  floor.rotation.x = -Math.PI/2; g.add(floor);

  const div = Math.max(4, Math.round(R.w));
  roomRef.gridLight = new THREE.GridHelper(R.w, div, T3D.light.grid[0], T3D.light.grid[1]);
  roomRef.gridDark  = new THREE.GridHelper(R.w, div, T3D.dark.grid[0],  T3D.dark.grid[1]);
  [roomRef.gridLight, roomRef.gridDark].forEach(gr=>{
    gr.position.y=.01; gr.scale.z = R.d/R.w; g.add(gr);
  });

  roomRef.wallMat = new THREE.MeshStandardMaterial({color:0x8B96B5, transparent:true,
    opacity:.14, side:THREE.DoubleSide, depthWrite:false});
  const mkWall=(w,h,x,y,z,ry)=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h), roomRef.wallMat);
    m.position.set(x,y,z); m.rotation.y=ry||0; g.add(m);
  };
  mkWall(R.w, R.h, 0, R.h/2, -R.d/2, 0);
  mkWall(R.d, R.h, -R.w/2, R.h/2, 0, Math.PI/2);
  mkWall(R.d, R.h,  R.w/2, R.h/2, 0, Math.PI/2);
  // dinding depan dibelah untuk lubang pintu
  const dw=R.doorW, side=(R.w-dw)/2;
  mkWall(side, R.h, -(dw/2+side/2), R.h/2, R.d/2, 0);
  mkWall(side, R.h,  (dw/2+side/2), R.h/2, R.d/2, 0);
  if(R.h > R.doorH) mkWall(dw, R.h-R.doorH, 0, R.doorH+(R.h-R.doorH)/2, R.d/2, 0);

  roomRef.edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(R.w, R.h, R.d)),
    new THREE.LineBasicMaterial({color:0x9AA3BE}));
  roomRef.edges.position.y = R.h/2; g.add(roomRef.edges);

  // marka lantai di zona baca gate
  if(R.markZ !== undefined){
    const hz=new THREE.Mesh(new THREE.PlaneGeometry(R.markW||2.2,.5),
      new THREE.MeshStandardMaterial({color:0xC9A227, roughness:.9}));
    hz.rotation.x=-Math.PI/2; hz.position.set(0,.015,R.markZ); g.add(hz);
  }
}

function applyTheme(name){
  themeName = name;
  const base = T3D[name];
  const t = Object.assign({}, base, S.cur && S.cur.theme && S.cur.theme[name]);
  document.body.classList.toggle('dark', name==='dark');
  scene.background = new THREE.Color(t.bg);
  const R = S.room || {w:12,d:8};
  scene.fog = new THREE.Fog(t.fog, R.w*1.8, R.w*4);
  roomRef.floorMat.color.setHex(t.floor);
  roomRef.wallMat.color.setHex(t.wall);
  roomRef.wallMat.opacity = t.wallOp;
  roomRef.edges.material.color.setHex(t.edge);
  roomRef.gridLight.visible = name==='light';
  roomRef.gridDark.visible  = name==='dark';
  hemi.intensity = t.hemi; hemi.groundColor.setHex(t.hemiG);
  sun.intensity = t.sun;
  if(S.cur && S.cur.onTheme) S.cur.onTheme(name, t);
}
S.themeName = ()=>themeName;

/* ================= label ================= */
S.label = function(text, color){
  const cv=document.createElement('canvas'); cv.width=512; cv.height=128;
  const cx=cv.getContext('2d');
  cx.font='600 52px "Segoe UI",sans-serif'; cx.textAlign='center'; cx.textBaseline='middle';
  cx.fillStyle='rgba(24,29,48,.78)';
  const w=Math.min(500, cx.measureText(text).width+56);
  if(cx.roundRect){ cx.beginPath(); cx.roundRect((512-w)/2,24,w,80,14); cx.fill(); }
  else cx.fillRect((512-w)/2,24,w,80);
  cx.fillStyle=color||'#F0D488'; cx.fillText(text,256,66);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv), depthTest:false}));
  sp.scale.set(2.4,.6,1); sp.renderOrder=5;
  return sp;
};
S.place = function(sp,x,y,z){ sp.position.set(x,y,z); return sp; };
S.addLabel = function(text,color,x,y,z,scale){
  const sp=S.label(text,color);
  if(scale) sp.scale.set(2.4*scale,.6*scale,1);
  S.groups.label.add(S.place(sp,x,y,z));
  return sp;
};

/* ================= antena kerucut ================= */
S.makeAntenna = function(pos, aimAt, len, rad, op){
  const grp=new THREE.Group(); grp.position.copy(pos);
  const mount=new THREE.Mesh(new THREE.BoxGeometry(.06,.12,.06),
    new THREE.MeshStandardMaterial({color:C.antMount,roughness:.6}));
  mount.position.y=.10; grp.add(mount);
  const dir=aimAt.clone().sub(pos).normalize();
  const panel=new THREE.Mesh(new THREE.BoxGeometry(.34,.05,.34),
    new THREE.MeshStandardMaterial({color:C.antenna,roughness:.4}));
  panel.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0), dir);
  grp.add(panel);
  const cgeo=new THREE.ConeGeometry(rad,len,14,1,true); cgeo.translate(0,-len/2,0);
  const cone=new THREE.Mesh(cgeo, new THREE.MeshBasicMaterial({color:C.cone,
    transparent:true,opacity:op||.13,side:THREE.DoubleSide,depthWrite:false}));
  cone.quaternion.copy(panel.quaternion);
  cone.position.copy(pos); S.groups.cover.add(cone);
  return grp;
};

/* ================= RFID gate =================
   Sepasang pedestal dengan panel antena saling berhadapan.
   opts: {z, span (jarak antar panel), h (tinggi), beam (palang atas)} */
S.makeGate = function(opts){
  const o = Object.assign({z:0, span:1.9, h:1.9, beam:false}, opts);
  const g=new THREE.Group();
  const bodyMat =new THREE.MeshStandardMaterial({color:C.steel,roughness:.45,metalness:.25});
  const faceMat =new THREE.MeshStandardMaterial({color:0xEDEFF2,roughness:.3});
  const plateMat=new THREE.MeshStandardMaterial({color:C.steelDark,roughness:.5,metalness:.5});
  const darkMat =new THREE.MeshStandardMaterial({color:C.station,roughness:.6});
  const scrMat  =new THREE.MeshStandardMaterial({color:C.screen,emissive:C.screen,emissiveIntensity:.6});

  const baseH=.52, colH=o.h-baseH-.03, half=o.span/2;
  function pedestal(x, rotY, withScreen){
    const p=new THREE.Group(); p.position.set(x,0,o.z); p.rotation.y=rotY;
    const plate=new THREE.Mesh(new THREE.BoxGeometry(.5,.03,.34),plateMat);
    plate.position.y=.015; p.add(plate);
    const base=new THREE.Mesh(new THREE.BoxGeometry(.36,baseH,.16),bodyMat);
    base.position.y=.03+baseH/2; p.add(base);
    const slot=new THREE.Mesh(new THREE.BoxGeometry(.14,.02,.012),darkMat);
    slot.position.set(0,.3,.086); p.add(slot);
    const col=new THREE.Mesh(new THREE.BoxGeometry(.34,colH,.10),bodyMat);
    col.position.y=.03+baseH+colH/2; p.add(col);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(.30,colH-.09),faceMat);
    face.position.set(0,col.position.y,.052); p.add(face);
    const vent=new THREE.Mesh(new THREE.BoxGeometry(.18,.014,.012),darkMat);
    vent.position.set(0,o.h-.03,.054); p.add(vent);
    if(withScreen){
      const sb=new THREE.Mesh(new THREE.BoxGeometry(.22,.15,.03),darkMat);
      sb.position.set(0,o.h-.24,.055); p.add(sb);
      const sf=new THREE.Mesh(new THREE.PlaneGeometry(.18,.11),scrMat);
      sf.position.set(0,o.h-.24,.072); p.add(sf);
    }
    return p;
  }
  g.add(pedestal(-half,  Math.PI/2, false));
  g.add(pedestal( half, -Math.PI/2, true));

  if(o.beam){   // palang atas: antena tambahan dari langit-langit gate
    const beam=new THREE.Mesh(new THREE.BoxGeometry(o.span+.4,.22,.18),bodyMat);
    beam.position.set(0,o.h+.11,o.z); g.add(beam);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(o.span-.1,.14),faceMat);
    face.position.set(0,o.h+.05,o.z+.095); g.add(face);
  }

  const zone=new THREE.Mesh(new THREE.BoxGeometry(o.span-.1, o.h-.2, .36),
    new THREE.MeshBasicMaterial({color:C.cone,transparent:true,opacity:.07,
      side:THREE.DoubleSide,depthWrite:false}));
  zone.position.set(0,(o.h-.2)/2,o.z); S.groups.cover.add(zone);

  return { grp:g, scrMat, zoneMat:zone.material, z:o.z,
    reset(){ scrMat.color.setHex(C.screen); scrMat.emissive.setHex(C.screen);
             scrMat.emissiveIntensity=.6;
             zone.material.color.setHex(C.cone); zone.material.opacity=.07; },
    setState(state, on){          // 'ok' | 'alert'
      const col = state==='ok' ? C.ok : C.alert;
      scrMat.color.setHex(col); scrMat.emissive.setHex(col);
      scrMat.emissiveIntensity = on ? 1.3 : .4;
      zone.material.color.setHex(col);
      zone.material.opacity = on ? .24 : .10;
    }
  };
};

/* ================= layar (canvas texture, bisa digambar ulang) ================= */
S.makeScreen = function(w,h,cw,ch){
  const cv=document.createElement('canvas'); cv.width=cw; cv.height=ch;
  const cx=cv.getContext('2d');
  const tex=new THREE.CanvasTexture(cv);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
    new THREE.MeshBasicMaterial({map:tex}));
  return { cv, cx, mesh, flush(){ tex.needsUpdate=true; } };
};

/* ================= timeline =================
   wps: [{x,z,dwell?,event?,face?,reverse?}] */
S.buildTimeline = function(wps, speed){
  const SPEED = speed || 1.5; let t=0; const segs=[];
  for(let i=0;i<wps.length;i++){
    if(i>0){
      const a=wps[i-1], b=wps[i];
      const d=Math.hypot(b.x-a.x,b.z-a.z), dur=d/SPEED;
      segs.push({type:'walk',t0:t,t1:t+dur,a,b}); t+=dur;
    }
    if(wps[i].dwell){ segs.push({type:'dwell',t0:t,t1:t+wps[i].dwell,a:wps[i],ev:wps[i].event}); t+=wps[i].dwell; }
  }
  segs.push({type:'idle',t0:t,t1:t+1.6,a:wps[wps.length-1]});
  const win={};
  segs.forEach(s=>{ if(s.ev) win[s.ev]=[s.t0,s.t1]; });
  return {segs,total:t+1.6,win,start:wps[0]};
};

S.makePath = function(wps){
  const v=wps.map(p=>new THREE.Vector3(p.x,.03,p.z));
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(v),
    new THREE.LineDashedMaterial({color:C.path,dashSize:.22,gapSize:.14,transparent:true,opacity:.9}));
  line.computeLineDistances();
  return line;
};

/* ================= status bar ================= */
const $=id=>document.getElementById(id);
const flowEl=$('flow');
let lastFlow='';
function setFlow(html, bad){
  if(html!==lastFlow){ flowEl.innerHTML=html; lastFlow=html; }
  flowEl.classList.toggle('bad', !!bad);
}
S.setFlow = setFlow;
const READY_TEXT='Siap &mdash; tekan <b>&#9654; Play</b> untuk memulai animasi';
const DONE_TEXT ='Animasi selesai &mdash; tekan <b>&#9654; Play</b> untuk mengulang';

/* ================= state simulasi ================= */
let simPlaying=false, simTime=0, simFinished=false;
let timeline=null, flowText=null, curVariant=null, curScen=null;

function setSimUI(){ $('btnPlay').disabled=simPlaying; $('btnStop').disabled=!simPlaying; }

function resetVisuals(){
  if(!timeline || !S.actor) return;
  S.actor.position.set(timeline.start.x, 0, timeline.start.z);
  S.actor.rotation.y = timeline.start.face!==undefined ? timeline.start.face : Math.PI;
  if(S.cur.reset) S.cur.reset();
}
function playSim(){ simTime=0; simFinished=false; simPlaying=true; setSimUI(); setFlow(flowText.walk); }
function stopSim(finished){
  simPlaying=false; simTime=0; simFinished=!!finished;
  resetVisuals(); setSimUI();
  const scen=S.cur.scenarios && S.cur.scenarios[curScen];
  const end=(scen && scen.end) || DONE_TEXT;
  setFlow(simFinished ? end : READY_TEXT, simFinished && !!(scen && scen.end));
}
S.stopSim = stopSim;

/* ================= build ulang animasi aktif ================= */
function rebuild(){
  const def=S.cur;
  S.disposeGroup(S.groups.concept); S.disposeGroup(S.groups.label);
  S.disposeGroup(S.groups.cover);   S.disposeGroup(S.groups.actor);
  S.groups.concept=new THREE.Group(); S.groups.label=new THREE.Group();
  S.groups.cover=new THREE.Group();   S.groups.actor=new THREE.Group();
  scene.add(S.groups.concept, S.groups.label, S.groups.cover, S.groups.actor);

  const scen=def.scenarios ? def.scenarios[curScen] : null;
  flowText=Object.assign({}, def.flowText, scen && scen.text);

  const out=def.build(curVariant, curScen) || {};
  const wps=out.wps || [{x:0,z:0}];
  timeline=S.buildTimeline(wps, def.speed);
  S.groups.actor.add(S.makePath(wps));
  if(S.actor) S.groups.actor.add(S.actor);

  $('stats').innerHTML = out.stats || '';
  $('note').innerHTML  = (scen && scen.note) || out.note || '';

  applyTheme(themeName);
  stopSim(false);
  syncToggles();
}
S.rebuild = rebuild;

/* ================= ganti animasi ================= */
function loadAnim(id){
  const def=S.anims[id];
  if(!def){ setFlow('Animasi <b>'+id+'</b> tidak terdaftar'); return; }
  S.cur=def; S.actor=null;
  S.room=def.room; buildRoom(def.room);

  curVariant = def.variants ? Object.keys(def.variants)[0] : null;
  curScen    = def.scenarios ? Object.keys(def.scenarios)[0] : null;

  $('panelTitle').innerHTML = def.title;
  $('panelSub').innerHTML   = def.sub || '';

  // segmented button varian (disembunyikan kalau animasi tidak punya varian)
  const segV=$('segVariant'); segV.innerHTML='';
  segV.style.display = def.variants ? 'flex' : 'none';
  if(def.variants) Object.entries(def.variants).forEach(([k,v],i)=>{
    const b=document.createElement('button');
    b.textContent=v.label; b.dataset.k=k;
    if(i===0) b.classList.add('on'); segV.appendChild(b);
  });

  // dropdown skenario
  const sel=$('selScen'); sel.innerHTML='';
  // satu skenario tidak perlu dropdown — terlihat seperti kontrol rusak
  sel.style.display = (def.scenarios && Object.keys(def.scenarios).length>1) ? 'block' : 'none';
  if(def.scenarios) Object.entries(def.scenarios).forEach(([k,v])=>{
    const o=document.createElement('option'); o.value=k; o.textContent=v.label; sel.appendChild(o);
  });

  // legenda
  const lg=$('legend'); lg.innerHTML='';
  (def.legend||[]).forEach(([col,txt])=>{
    const s=document.createElement('span'); s.className='chip';
    const d=document.createElement('span'); d.className='dot'; d.style.background=col;
    s.appendChild(d); s.appendChild(document.createTextNode(txt)); lg.appendChild(s);
  });

  const cam=def.cam||{};
  orbit.theta=cam.theta!==undefined?cam.theta:.72;
  orbit.phi  =cam.phi  !==undefined?cam.phi  :1.08;
  orbit.r    =cam.r    ||16.5;
  orbit.topR =cam.topR ||orbit.r;
  orbit.target.set(...(cam.target||[0,.9,.4]));
  zoomMin=(cam.r||16.5)*.4; zoomMax=(cam.r||16.5)*2.2;
  orbit.topView=false;
  [...$('segView').children].forEach((b,i)=>b.classList.toggle('on', i===0));
  applyCam();

  rebuild();
}
S.loadAnim = loadAnim;

/* ================= toggle tampilan ================= */
function syncToggles(){
  S.groups.cover.visible = $('ckCov').checked;
  S.groups.actor.visible = $('ckPath').checked;
  S.groups.label.visible = $('ckLabel').checked;
}

/* ================= wiring UI ================= */
$('segVariant').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  [...$('segVariant').children].forEach(x=>x.classList.toggle('on',x===b));
  curVariant=b.dataset.k; rebuild();
});
$('selScen').addEventListener('change',e=>{ curScen=e.target.value; rebuild(); });
$('segView').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  [...$('segView').children].forEach(x=>x.classList.toggle('on',x===b));
  orbit.topView = b.dataset.v==='top';
  applyCam();
});
$('themeSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  [...$('themeSeg').children].forEach(x=>x.classList.toggle('on',x===b));
  applyTheme(b.dataset.t);
});
$('btnPlay').addEventListener('click', playSim);
$('btnStop').addEventListener('click', ()=>stopSim(false));
['ckCov','ckPath','ckLabel'].forEach(id=>$(id).addEventListener('change',syncToggles));
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

/* ================= loop animasi ================= */
const clock=new THREE.Clock();
let tGlobal=0;

function lerpYaw(cur, target, k){
  let d=((target-cur+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
  return cur + d*k;
}

function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.1);
  tGlobal+=dt;

  if(timeline && S.actor){
    if(simPlaying){
      simTime+=dt;
      if(simTime>=timeline.total){
        if($('ckLoop').checked){ simTime=0; if(S.cur.reset) S.cur.reset(); }
        else stopSim(true);
      }
    }

    if(simPlaying){
      const ct=simTime;
      const segs=timeline.segs;
      const seg=segs.find(s=>ct>=s.t0&&ct<s.t1)||segs[segs.length-1];
      let mode=seg.type, yaw=null;
      if(seg.type==='walk'){
        const k=(ct-seg.t0)/(seg.t1-seg.t0);
        S.actor.position.set(seg.a.x+(seg.b.x-seg.a.x)*k, 0, seg.a.z+(seg.b.z-seg.a.z)*k);
        yaw=Math.atan2(seg.b.x-seg.a.x, seg.b.z-seg.a.z);
        if(seg.b.reverse) yaw+=Math.PI;      // mundur: badan tetap menghadap arah semula
      }else{
        S.actor.position.set(seg.a.x,0,seg.a.z);
        if(seg.ev) mode=seg.ev;
        if(seg.a.face!==undefined) yaw=seg.a.face;
      }
      if(yaw!==null){
        S.actor.rotation.y = S.cur.smoothTurn
          ? lerpYaw(S.actor.rotation.y, yaw, 1-Math.pow(.0015,dt))
          : yaw;
      }

      const r = S.cur.tick ? S.cur.tick(ct, seg, timeline.win, S.actor) : null;
      const key = (r && r.flow && flowText[r.flow]) ? r.flow : (flowText[mode] ? mode : 'walk');
      setFlow(flowText[key], r ? !!r.bad : false);
    }else if(S.cur.idle){
      S.cur.idle(tGlobal);
    }
  }
  renderer.render(scene,camera);
}

/* ================= boot ================= */
S.boot = function(){
  const cfg=window.SIMLAY_CONFIG||{};
  const ids=(cfg.show||Object.keys(S.anims)).filter(id=>{
    if(S.anims[id]) return true;
    console.warn('animations.js menyebut animasi yang tidak terdaftar:', id);
    return false;
  });
  if(!ids.length){
    setFlow('Tidak ada animasi aktif &mdash; periksa <b>animations.js</b>');
    renderer.render(scene,camera); return;
  }
  const sel=document.getElementById('selAnim');
  ids.forEach(id=>{
    const o=document.createElement('option');
    o.value=id; o.textContent=S.anims[id].label; sel.appendChild(o);
  });
  sel.addEventListener('change',e=>loadAnim(e.target.value));
  sel.style.display = ids.length>1 ? 'block' : 'none';

  // applyTheme dipanggil di dalam rebuild(), setelah ruangan ada — jangan panggil di sini
  loadAnim(ids[0]);
  animate();
};

return S;
})();
