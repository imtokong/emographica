/***** 1) 라벨 매핑 & 감정 스타일 *****/
const LABEL_MAP = { "행복":"joy","분노":"anger","슬픔":"sadness","혐오":"disgust","공포":"anxiety","놀람":"surprise","중립":"neutral" };
const EMO = {
  joy:{c:[255,217,61], ex:1.25, nz:0.35, dn:0.00, sz:6.0, sk:0.02},
  anger:{c:[255,59,48], ex:1.55, nz:0.85, dn:0.00, sz:7.0, sk:0.07},
  sadness:{c:[90,163,255], ex:0.75, nz:0.25, dn:0.40, sz:5.0, sk:0.01},
  anxiety:{c:[161,140,255], ex:1.00, nz:1.20, dn:0.10, sz:4.0, sk:0.05},
  surprise:{c:[120,255,214], ex:1.30, nz:1.00, dn:0.00, sz:8.0, sk:0.06},
  disgust:{c:[154,205,50], ex:0.90, nz:0.70, dn:0.00, sz:6.0, sk:0.03},
  neutral:{c:[176,183,195], ex:0.95, nz:0.45, dn:0.05, sz:5.0, sk:0.01},
};

/***** 2) three.js 기본 세팅 *****/
let renderer, scene, camera, controls, points, geom, material;
let params = { ex:1, nz:0.5, dn:0, sz:5, sk:0.02 };
let basePos;
let time = 0;

let canvas, statusEl;

// ✅ 페이지 로드 후 실행
window.addEventListener("load", () => {
  canvas = document.getElementById('c');
  statusEl = document.getElementById('status');
  init();
  animate();
  wireUI();
});

function init(){
  renderer = new THREE.WebGLRenderer({canvas, antialias:true});
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x090b12, 0.0006);

  camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 2000);
  camera.position.set(0,0,180);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;

  const hemi = new THREE.HemisphereLight(0x3344ff, 0x100806, 0.6);
  scene.add(hemi);

  const count = 14000;
  geom = new THREE.BufferGeometry();
  const pos = new Float32Array(count*3);
  const off = new Float32Array(count*3);
  for (let i=0;i<count;i++){
    const r = 120 * Math.cbrt(Math.random());
    const th = Math.random()*Math.PI*2;
    const ph = Math.acos(THREE.MathUtils.randFloatSpread(2));
    pos[i*3+0] = r*Math.sin(ph)*Math.cos(th);
    pos[i*3+1] = r*Math.sin(ph)*Math.sin(th);
    pos[i*3+2] = r*Math.cos(ph);
    off[i*3+0] = Math.random()*1000;
    off[i*3+1] = Math.random()*1000;
    off[i*3+2] = Math.random()*1000;
  }
  basePos = pos.slice(0);
  geom.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geom.setAttribute('offset', new THREE.BufferAttribute(off,3));

  material = new THREE.PointsMaterial({
    color:0xb0b7c3, size:params.sz, transparent:true, opacity:0.95, depthWrite:false
  });
  points = new THREE.Points(geom, material);
  scene.add(points);

  // 👇 이제 안전하게 실행
  window.addEventListener('resize', onResize);
  onResize();
}

function onResize(){
  if (!renderer || !camera) return; // 안전 가드
  const w = innerWidth, h = innerHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate(){
  requestAnimationFrame(animate);
  time += 0.016;

  const pos = geom.getAttribute('position');
  const off = geom.getAttribute('offset');
  const n = pos.count;

  for (let i=0;i<n;i++){
    const ix=i*3, iy=i*3+1, iz=i*3+2;
    const bx=basePos[ix], by=basePos[iy], bz=basePos[iz];
    const r = Math.hypot(bx,by,bz)+0.0001;
    const x=bx/r, y=by/r, z=bz/r;

    const o1=off.array[ix], o2=off.array[iy], o3=off.array[iz];
    const wiggle =
      Math.sin(time*1.0 + o1*0.012)*0.6 +
      Math.cos(time*0.73 + o2*0.010)*0.4 +
      Math.sin(time*1.31 + o3*0.008)*0.3;

    const radius = 110*params.ex + wiggle*22*params.nz;
    pos.array[ix] = x*radius;
    pos.array[iy] = y*radius - params.dn*30;
    pos.array[iz] = z*radius;
  }
  pos.needsUpdate = true;

  material.size = params.sz;
  camera.position.x += (Math.random()-0.5)*params.sk;
  camera.position.y += (Math.random()-0.5)*params.sk; // 미세 흔들림
  controls.update();
  renderer.render(scene, camera);
}

/***** 3) UI & Vercel API 호출 *****/
function wireUI(){
  document.getElementById('analyzeBtn').addEventListener('click', async ()=>{
    const text = document.getElementById('input').value.trim();
    if (!text){ statusEl.textContent="텍스트를 입력해주세요"; return; }
    statusEl.textContent="분석 중…";

    try{
      const r = await fetch(window.EMO_API, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ text })
      });

      if (r.status === 503) { statusEl.textContent="모델 웜업 중… 잠시 후 다시"; return; }

      const out = await r.json();
      if (out?.error) { statusEl.textContent = `HF 오류: ${out.error}`; return; }

      const arr = Array.isArray(out) ? (Array.isArray(out[0]) ? out[0] : out) : [];
      const results = arr.map(x=>({label:x.label, score:x.score}));

      if (!results.length){ statusEl.textContent="결과 없음"; return; }

      applyEmotionMix(results);

      const labelStr = results
        .sort((a,b)=>b.score-a.score)
        .slice(0,3)
        .map(x=>`${x.label} ${Math.round(x.score*100)}%`)
        .join(" · ");
      statusEl.textContent = `감정: ${labelStr}`;
    }catch(e){
      console.error(e);
      statusEl.textContent = "네트워크/서버 오류";
    }
  });
}

/***** 4) 칵테일 혼합 *****/
function applyEmotionMix(results){
  const mapped = results
    .map(r=>({key: LABEL_MAP[r.label] || "neutral", score: r.score||0}))
    .filter(r=>EMO[r.key]);
  if(!mapped.length){ tweenTo(EMO.neutral,0.6); return; }

  const sum = mapped.reduce((s,r)=>s+r.score,0) || 1;
  const target = { c:[0,0,0], ex:0, nz:0, dn:0, sz:0, sk:0 };
  for (const {key,score} of mapped){
    const w = score/sum, e = EMO[key];
    target.c[0]+=e.c[0]*w; target.c[1]+=e.c[1]*w; target.c[2]+=e.c[2]*w;
    target.ex+=e.ex*w; target.nz+=e.nz*w; target.dn+=e.dn*w; target.sz+=e.sz*w; target.sk+=e.sk*w;
  }
  tweenTo(target, 0.7);
}

/***** 5) 트윈 *****/
function tweenTo(target, dur=0.6){
  const start = {...params};
  const sc = hexToRgb(material.color.getHex()), ec = {r:target.c[0], g:target.c[1], b:target.c[2]};
  const t0 = performance.now();
  function step(now){
    const t = Math.min(1, (now-t0)/(dur*1000));
    const e = t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
    params.ex = lerp(start.ex, target.ex, e);
    params.nz = lerp(start.nz, target.nz, e);
    params.dn = lerp(start.dn, target.dn, e);
    params.sz = lerp(start.sz, target.sz, e);
    params.sk = lerp(start.sk, target.sk, e);
    const r = Math.round(lerp(sc.r, ec.r, e));
    const g = Math.round(lerp(sc.g, ec.g, e));
    const b = Math.round(lerp(sc.b, ec.b, e));
    material.color.setRGB(r/255, g/255, b/255);
    if(t<1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function lerp(a,b,t){ return a+(b-a)*t; }
function hexToRgb(hex){ return { r:(hex>>16)&255, g:(hex>>8)&255, b:hex&255 }; }

