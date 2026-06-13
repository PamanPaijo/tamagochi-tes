import * as THREE from './three.module.js';

/* =========================================================
   nyala — sebuah api kecil yang dibentuk oleh caramu hadir
   Semua state lokal (localStorage). Tanpa server, jalan offline.
   ========================================================= */

const KEY = 'nyala.v1';
const HOUR = 3600e3, DAY = 24 * HOUR;
const COOLDOWN = 6 * HOUR;            // jeda antar tindakan: hadir > sering
const now = () => Date.now();
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dstr = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; };

/* ---------- state ---------- */
function freshState(name, inherited = null, generation = 1) {
  const t = now();
  return {
    version: 1, name, generation, inherited,
    bornAt: t, lastSeenAt: t, lastVisitDay: dstr(t), streak: 1,
    warmth: 42, courage: 40, expressiveness: 40, vitality: 52,
    careTotal: 0, reciprocity: false, recipDay: null,
    completed: false, notes: [],
    last: { temani: 0, bagikan: 0, sulut: 0 },
  };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.version === 1 ? s : null; }
  catch { return null; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

let state = load();
let returnedGap = 0; // hari absen saat kembali, untuk pesan

/* ---------- waktu nyata: pelunturan lembut, tanpa kematian ---------- */
function applyDecay(s) {
  const days = (now() - s.lastSeenAt) / DAY;
  returnedGap = days;
  if (days <= 0.5) return;
  s.vitality = clamp(s.vitality - (days - 0.5) * 7);
  if (days > 2) {
    s.warmth = clamp(s.warmth - (days - 2) * 3);
    s.expressiveness = clamp(s.expressiveness - (days - 2) * 1.6);
  }
}
function registerVisit(s) {
  const today = dstr(now());
  if (s.lastVisitDay === today) return;
  const yest = dstr(now() - DAY);
  s.streak = (s.lastVisitDay === yest) ? s.streak + 1 : 1;
  s.lastVisitDay = today;
}

/* ---------- mesin karakter ---------- */
const STAGE = ['bara', 'nyala', 'cahaya', 'purna'];
function stageOf(s) {
  if (s.completed) return 3;
  const age = (now() - s.bornAt) / DAY;
  const floor = Math.min(s.warmth, s.courage, s.expressiveness);
  if (s.careTotal >= 360 && age >= 7 && floor >= 55) return 2;
  if (s.careTotal >= 120 && age >= 2) return 1;
  return 0;
}
function eligibleToRelease(s) {
  return !s.completed && stageOf(s) === 2 && (now() - s.bornAt) / DAY >= 21;
}
function checkReciprocity(s) {
  if (s.reciprocity) return;
  if (s.streak >= 5 && s.warmth >= 65 && s.vitality >= 60 && stageOf(s) >= 1) s.reciprocity = true;
}

const ACT = {
  temani: (s, m) => { s.vitality = clamp(s.vitality + 14 * m); s.warmth = clamp(s.warmth + 8 * m); s.careTotal += 22 * m; },
  bagikan:(s, m) => { s.expressiveness = clamp(s.expressiveness + 12 * m); s.warmth = clamp(s.warmth + 5 * m); s.vitality = clamp(s.vitality + 4); s.careTotal += 18 * m; },
  sulut:  (s, m) => { s.courage = clamp(s.courage + 13 * m); s.vitality = clamp(s.vitality + 6); s.expressiveness = clamp(s.expressiveness + 3); s.careTotal += 18 * m; },
};
function doAction(act) {
  const t = now();
  if (t - (state.last[act] || 0) < COOLDOWN) {
    toast(`${state.name} sudah merasakannya. Kembalilah nanti.`);
    return false;
  }
  const m = state.streak >= 3 ? 1.3 : 1.0;   // konsistensi antar hari diganjar
  ACT[act](state, m);
  state.last[act] = t;
  checkReciprocity(state);
  save();
  return true;
}

/* kata-tunggal yang menggambarkan keadaan — bukan angka */
function stateWord(s) {
  if (s.completed) return 'purna';
  if (s.vitality < 28 && s.warmth < 45) return 'berjaga';
  if (s.vitality < 30) return 'redup';
  if (s.vitality < 50) return 'lelah';
  if (s.warmth >= 70 && s.vitality >= 65 && s.expressiveness >= 60) return 'berseri';
  if (s.courage >= 70 && s.vitality >= 60) return 'berani';
  if (s.expressiveness >= 68) return 'riang';
  if (s.warmth >= 65) return 'hangat';
  if (s.vitality >= 70) return 'tenang';
  return 'bernyala';
}
function stateLine(s) {
  if (s.completed) return 'Ia telah utuh. Apa yang ia jadi kini hidup dalam yang berikut.';
  if (returnedGap >= 2) return 'Ia meredup saat kamu pergi. Kehadiranmu menghangatkannya lagi.';
  if (s.reciprocity && s.streak >= 5) return `${s.streak} hari kamu datang. Ia mengenalmu.`;
  if (stageOf(s) === 0) return 'Masih bara. Beri ia waktu dan kehadiran.';
  return '';
}

/* =========================================================
   ADEGAN 3D
   ========================================================= */
let renderer, scene, camera, flameGroup, coreSprite, haloSprite, dust, pts, ptsMat;
const N = 520;
const pLife = new Float32Array(N), pSpan = new Float32Array(N), pSpeed = new Float32Array(N),
      pSeed = new Float32Array(N), pBX = new Float32Array(N), pBZ = new Float32Array(N), pY = new Float32Array(N);
let posAttr, colAttr, lifeAttr;

const warmCol = new THREE.Color('#ff7a2a'), coolCol = new THREE.Color('#6f86d6'), hotCol = new THREE.Color('#ffe6ad');
const lookCur = { glow: .4, reach: .5, spread: .4, unrest: .4, warmthF: .45, scale: .8 };
let lookTar = { ...lookCur };

function radialTex(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}

function spawn(i) {
  pLife[i] = 1; pSpan[i] = 1.1 + Math.random() * 1.3;
  const ang = Math.random() * Math.PI * 2;
  const rad = 0.30 * (0.4 + lookCur.spread * 0.9) * Math.pow(Math.random(), .6);
  pBX[i] = Math.cos(ang) * rad; pBZ[i] = Math.sin(ang) * rad;
  pY[i] = -0.05 + Math.random() * 0.12;
  pSpeed[i] = (0.55 + Math.random() * 0.5) * (0.7 + lookCur.reach * 0.9);
  pSeed[i] = Math.random() * 100;
  const col = warmCol.clone().lerp(coolCol, 1 - lookCur.warmthF);
  const b = 0.6 + Math.random() * 0.5;
  colAttr.array[i*3] = col.r * b; colAttr.array[i*3+1] = col.g * b; colAttr.array[i*3+2] = col.b * b;
  lifeAttr.array[i] = 1;
  posAttr.array[i*3] = pBX[i]; posAttr.array[i*3+1] = pY[i]; posAttr.array[i*3+2] = pBZ[i];
}

function buildScene() {
  const host = document.getElementById('scene');
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 1.0, 4.2);

  flameGroup = new THREE.Group(); flameGroup.position.y = 0.15; scene.add(flameGroup);

  // partikel api (shader: ukuran & pudar per-partikel berdasar umur)
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), life = new Float32Array(N), scl = new Float32Array(N);
  for (let i = 0; i < N; i++) scl[i] = 1 + Math.random() * 1.6;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scl, 1));
  posAttr = geo.getAttribute('position'); colAttr = geo.getAttribute('aColor'); lifeAttr = geo.getAttribute('aLife');

  ptsMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uSize: { value: 11.0 }, uPixelRatio: { value: renderer.getPixelRatio() },
      uOpacity: { value: 1.0 }, uHot: { value: hotCol },
    },
    vertexShader: `
      attribute vec3 aColor; attribute float aLife; attribute float aScale;
      uniform float uSize; uniform float uPixelRatio;
      varying float vLife; varying vec3 vColor;
      void main(){
        vLife = aLife; vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = uSize * uPixelRatio * aScale * (0.35 + aLife*0.9) * (1.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity; uniform vec3 uHot;
      varying float vLife; varying vec3 vColor;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vLife;
        vec3 col = mix(vColor, uHot, smoothstep(0.45, 1.0, vLife));
        gl_FragColor = vec4(col, a * uOpacity);
      }`,
  });
  pts = new THREE.Points(geo, ptsMat); pts.frustumCulled = false; flameGroup.add(pts);
  for (let i = 0; i < N; i++) { spawn(i); pLife[i] = Math.random(); lifeAttr.array[i] = pLife[i]; }

  // inti & halo
  const glow = radialTex([[0, 'rgba(255,235,190,1)'], [0.4, 'rgba(255,150,70,0.5)'], [1, 'rgba(255,120,60,0)']]);
  coreSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  coreSprite.scale.set(1.3, 1.3, 1); coreSprite.position.y = 0.25; flameGroup.add(coreSprite);
  haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
  haloSprite.scale.set(3.4, 3.4, 1); haloSprite.position.y = 0.3; flameGroup.add(haloSprite);

  // debu ruang (kedalaman)
  const dn = 260, dpos = new Float32Array(dn * 3);
  for (let i = 0; i < dn; i++) { dpos[i*3] = (Math.random()-.5)*9; dpos[i*3+1] = (Math.random()-.2)*6; dpos[i*3+2] = (Math.random()-.5)*7 - 1.5; }
  const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dtex = radialTex([[0, 'rgba(200,210,255,0.9)'], [1, 'rgba(200,210,255,0)']]);
  dust = new THREE.Points(dgeo, new THREE.PointsMaterial({ size: 0.05, map: dtex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  scene.add(dust);

  addEventListener('resize', onResize);
}
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

/* keadaan -> target visual */
function refreshLook() {
  const s = state || { warmth: 50, courage: 45, expressiveness: 45, vitality: 38 };
  const st = state ? stageOf(state) : 0;
  lookTar = {
    warmthF: s.warmth / 100,
    glow: 0.26 + 0.74 * (s.vitality / 100),
    reach: 0.3 + 0.7 * (s.courage / 100),
    spread: s.expressiveness / 100,
    unrest: clamp((1 - s.vitality / 100) * (s.vitality < 45 ? 1 : 0.35), 0, 1),
    scale: [0.72, 1.0, 1.35, 1.1][st],
  };
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let last = performance.now();
function animate(t) {
  requestAnimationFrame(animate);
  let dt = Math.min((t - last) / 1000, 0.05); last = t;
  const tm = t / 1000;

  // halusin transisi look
  const k = 1 - Math.exp(-dt * 1.6);
  for (const key in lookCur) lookCur[key] = lerp(lookCur[key], lookTar[key], k);

  // partikel
  const wob = 0.05 + lookCur.spread * 0.16 + lookCur.unrest * 0.14;
  const flick = reduceMotion ? 0 : lookCur.unrest;
  for (let i = 0; i < N; i++) {
    pLife[i] -= dt / pSpan[i];
    if (pLife[i] <= 0) { spawn(i); continue; }
    pY[i] += pSpeed[i] * dt * (0.6 + lookCur.reach);
    const x = pBX[i] + Math.sin(tm * 1.7 + pSeed[i]) * wob + (Math.random() - .5) * flick * 0.04;
    const z = pBZ[i] + Math.cos(tm * 1.5 + pSeed[i]) * wob;
    posAttr.array[i*3] = x; posAttr.array[i*3+1] = pY[i]; posAttr.array[i*3+2] = z;
    lifeAttr.array[i] = pLife[i];
  }
  posAttr.needsUpdate = true; lifeAttr.needsUpdate = true; colAttr.needsUpdate = true;
  ptsMat.uniforms.uOpacity.value = lookCur.glow;

  // warna inti/halo ikut kehangatan
  const tint = warmCol.clone().lerp(coolCol, 1 - lookCur.warmthF);
  coreSprite.material.color.copy(tint).lerp(hotCol, 0.4);
  haloSprite.material.color.copy(tint);
  const pulse = reduceMotion ? 1 : 1 + Math.sin(tm * 0.7) * 0.05;
  const g = lookCur.glow, sc = lookCur.scale;
  coreSprite.scale.setScalar(1.1 * sc * (0.6 + g) * pulse);
  haloSprite.scale.setScalar(3.2 * sc * (0.5 + g));
  haloSprite.material.opacity = 0.32 * g;
  flameGroup.scale.setScalar(sc);

  // kamera bernapas
  if (!reduceMotion) {
    camera.position.x = Math.sin(tm * 0.12) * 0.35;
    camera.position.y = 1.0 + Math.sin(tm * 0.16) * 0.08;
  }
  camera.lookAt(0, 0.7, 0);
  dust.rotation.y += dt * 0.01;

  renderer.render(scene, camera);
}

/* =========================================================
   UI
   ========================================================= */
const $ = (id) => document.getElementById(id);
function show(el, on = true) { el.hidden = !on; }
let toastTimer;
function toast(msg) {
  const el = $('toast'); el.textContent = msg; show(el, true);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => show(el, false), 2600);
}

function renderReadout() {
  if (!state) return;
  $('creatureName').textContent = state.name;
  $('stateWord').textContent = stateWord(state);
  $('stateLine').textContent = stateLine(state);
  // perbarui jeda tindakan
  document.querySelectorAll('.action').forEach(b => {
    const act = b.dataset.act;
    const ready = now() - (state.last[act] || 0) >= COOLDOWN;
    b.disabled = !ready;
  });
  refreshLook();
}

function startUI() {
  show($('readout'), true); show($('actions'), true);
  renderReadout();
  setInterval(renderReadout, 30000); // segarkan status & jeda
}

/* tindakan */
document.querySelectorAll('.action').forEach(btn => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'temani') return openPresence();
    if (act === 'bagikan') return openShare(false);
    if (act === 'sulut') {
      if (doAction('sulut')) { toast(`Semangat ${state.name} bangkit.`); pulseFlame(); }
      renderReadout();
    }
  });
});

function pulseFlame() { lookCur.glow = Math.min(1, lookCur.glow + 0.25); }

/* — Temani: momen napas — */
let breathTimer;
function openPresence() {
  show($('presenceVeil'), true);
  $('breathText').textContent = 'tarik napas';
  clearTimeout(breathTimer);
  // satu siklus napas ~12s; mengakhiri otomatis lalu menerapkan efek
  breathTimer = setTimeout(() => { $('breathText').textContent = 'lepaskan'; }, 6000);
}
function finishPresence(complete) {
  show($('presenceVeil'), false); clearTimeout(breathTimer); clearTimeout(presenceAuto);
  if (complete) { if (doAction('temani')) { toast(`Kamu menemani ${state.name}.`); pulseFlame(); } }
  renderReadout();
}
$('breathStop').addEventListener('click', () => finishPresence(true));
// jika dibiarkan, anggap selesai setelah 12s
$('presenceVeil').addEventListener('transitionend', () => {});
let presenceAuto;
const presenceObserver = new MutationObserver(() => {
  if (!$('presenceVeil').hidden) { clearTimeout(presenceAuto); presenceAuto = setTimeout(() => finishPresence(true), 12000); }
});
presenceObserver.observe($('presenceVeil'), { attributes: true, attributeFilter: ['hidden'] });

/* — Bagikan — */
let shareAfterRecip = false;
function openShare(fromRecip) { shareAfterRecip = fromRecip; $('shareInput').value = ''; show($('shareScrim'), true); setTimeout(() => $('shareInput').focus(), 60); }
$('shareCancel').addEventListener('click', () => show($('shareScrim'), false));
$('shareSave').addEventListener('click', () => {
  const txt = $('shareInput').value.trim();
  if (txt) {
    state.notes.push({ t: now(), text: txt }); if (state.notes.length > 30) state.notes.shift();
    doAction('bagikan'); pulseFlame();
    toast(`${state.name} menyimpannya.`);
  }
  show($('shareScrim'), false);
  renderReadout();
});

/* — Resiprositas: saat Nyala membalas merawat — */
function maybeReciprocity() {
  if (!state.reciprocity) return;
  const today = dstr(now());
  if (state.recipDay === today) return;
  state.recipDay = today; save();
  setTimeout(showReciprocity, 1400);
}
function showReciprocity() {
  const lines = [
    `${state.name} meraih pelan ke arahmu. "Bagaimana harimu?"`,
    `${state.name} meredup sejenak, lalu menyala lembut. "Kamu sudah istirahat?"`,
    `${state.name} condong mendekat. "Aku di sini. Ceritakan sesuatu."`,
  ];
  $('recipText').textContent = lines[Math.floor(Math.random() * lines.length)];
  $('recipReply').textContent = 'ceritakan';
  show($('reciprocityVeil'), true);
}
$('recipReply').addEventListener('click', () => {
  show($('reciprocityVeil'), false);
  state.warmth = clamp(state.warmth + 4); save();
  openShare(true);
});
$('reciprocityVeil').addEventListener('click', (e) => { if (e.target === $('reciprocityVeil')) show($('reciprocityVeil'), false); });

/* — Menu / tentang — */
$('menuBtn').addEventListener('click', () => {
  const st = state ? STAGE[stageOf(state)] : '—';
  let body = state
    ? `${state.name} sedang dalam tahap "${st}", generasi ${state.generation}.` +
      (state.inherited ? ` Mewarisi sifat: ${state.inherited}.` : '') +
      ` ${state.notes.length} kata tersimpan.`
    : '';
  if (state && eligibleToRelease(state)) {
    body += ' Ia telah utuh. Kamu boleh melepaskannya agar sifatnya menurun ke api yang baru.';
  }
  $('menuBody').textContent = body;
  // tombol lepaskan muncul kondisional
  let rel = $('releaseBtn');
  if (state && eligibleToRelease(state)) {
    if (!rel) {
      rel = document.createElement('button'); rel.id = 'releaseBtn'; rel.className = 'text-btn';
      rel.textContent = 'lepaskan dengan tenang';
      rel.addEventListener('click', releaseFlame);
      $('resetBtn').parentNode.insertBefore(rel, $('resetBtn').nextSibling);
    }
  } else if (rel) rel.remove();
  show($('menuScrim'), true);
});
$('menuClose').addEventListener('click', () => show($('menuScrim'), false));
$('menuScrim').addEventListener('click', (e) => { if (e.target === $('menuScrim')) show($('menuScrim'), false); });

function dominantTrait(s) {
  const m = Math.max(s.warmth, s.courage, s.expressiveness);
  if (m === s.warmth) return 'kehangatan';
  if (m === s.courage) return 'keberanian';
  return 'keterbukaan';
}
function releaseFlame() {
  const trait = dominantTrait(state);
  const gen = state.generation + 1;
  state.completed = true; save();
  toast(`${state.name} telah purna. ${trait} menurun ke yang berikut.`);
  show($('menuScrim'), false);
  setTimeout(() => {
    state = freshState(state.name + ' II', trait, gen);
    // sifat warisan memberi awal yang sedikit lebih kuat
    if (trait === 'kehangatan') state.warmth = 58;
    if (trait === 'keberanian') state.courage = 58;
    if (trait === 'keterbukaan') state.expressiveness = 58;
    save(); renderReadout();
  }, 1800);
}

$('resetBtn').addEventListener('click', () => {
  toast('Tekan sekali lagi untuk benar-benar memulai dari awal.');
  const b = $('resetBtn');
  if (b.dataset.armed) { localStorage.removeItem(KEY); location.reload(); }
  b.dataset.armed = '1'; setTimeout(() => delete b.dataset.armed, 2600);
});

/* — Onboarding — */
$('introStart').addEventListener('click', () => {
  const name = ($('nameInput').value.trim() || 'Bara').slice(0, 18);
  state = freshState(name); save();
  show($('introScrim'), false);
  startUI();
});
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('introStart').click(); });

/* =========================================================
   INIT
   ========================================================= */
function init() {
  buildScene();
  refreshLook();
  requestAnimationFrame(animate);

  if (!state) {
    show($('introScrim'), true);
    setTimeout(() => $('nameInput').focus(), 200);
  } else {
    applyDecay(state); registerVisit(state); checkReciprocity(state);
    state.lastSeenAt = now(); save();
    startUI();
    if (returnedGap >= 2) toast(`${state.name} menunggumu.`);
    maybeReciprocity();
  }

  // simpan jejak waktu saat pergi
  addEventListener('visibilitychange', () => { if (document.hidden && state) { state.lastSeenAt = now(); save(); } });
  addEventListener('pagehide', () => { if (state) { state.lastSeenAt = now(); save(); } });
}
init();

/* PWA: daftarkan service worker (offline) */
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}
