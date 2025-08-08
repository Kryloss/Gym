// Gym Blocks — Canvas Web App
// Canvas-only UI (visuals). Hidden inputs are used for file and image picking.
// Persistence: localStorage (metadata) + IndexedDB (images). PWA-enabled for iOS Home Screen.

const DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
const canvas = document.getElementById('app');
const ctx = canvas.getContext('2d');
const imagePicker = document.getElementById('imagePicker');
const jsonImport = document.getElementById('jsonImport');

// --- Service worker registration ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(console.warn);
  });
}

// --- Resize handling ---
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
}
window.addEventListener('resize', resize);
resize();

// --- Tiny IndexedDB helper for images ---
const DB_NAME = 'gymPlannerDB';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putImage(id, dataUrl) {
  if (!db) db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put({ id, dataUrl });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getImage(id) {
  if (!db) db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly');
    const req = tx.objectStore('images').get(id);
    req.onsuccess = () => resolve(req.result?.dataUrl || null);
    req.onerror = () => reject(req.error);
  });
}

// --- State ---
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const THEMES = {
  dark: {
    bgA: '#0b0e1a',
    bgB: '#101634',
    card: '#161b3a',
    text: '#f3f6ff',
    sub: '#9aa3c7',
    accentA: '#5b7cfa',
    accentB: '#ff4d00',
    accentC: '#00b6ff',
    good: '#3ddc84'
  },
  neon: {
    bgA: '#0d0d0f',
    bgB: '#1a1133',
    card: '#151522',
    text: '#ffffff',
    sub: '#b7b7d1',
    accentA: '#ff00e0',
    accentB: '#00e5ff',
    accentC: '#e0ff00',
    good: '#00ffa3'
  }
};
let themeKey = localStorage.getItem('themeKey') || 'dark';
let theme = THEMES[themeKey];
let weekIndex = parseInt(localStorage.getItem('weekIndex')||'0',10);

// Blocks structure: { id, day, exercise, sets, reps, weight?, notes?, imageId? }
let blocks = JSON.parse(localStorage.getItem('blocks') || '[]');

// Presets
let presets = JSON.parse(localStorage.getItem('presets') || JSON.stringify([
  {name:'Push A', exercise:'Bench Press', sets:4, reps:8},
  {name:'Pull A', exercise:'Barbell Row', sets:4, reps:10},
  {name:'Legs A', exercise:'Back Squat', sets:5, reps:5},
  {name:'Core', exercise:'Plank', sets:3, reps:60, notes:'seconds'}
]));

// --- Utility ---
function uid() {
  return Math.random().toString(36).slice(2)+Date.now().toString(36);
}

function save() {
  localStorage.setItem('blocks', JSON.stringify(blocks));
  localStorage.setItem('presets', JSON.stringify(presets));
  localStorage.setItem('themeKey', themeKey);
  localStorage.setItem('weekIndex', String(weekIndex));
  showToast('Saved');
}

let saveTimer;
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

// --- Layout ---
function drawGradientBg() {
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, theme.bgA);
  g.addColorStop(1, theme.bgB);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

const padding = 16 * DPR;
const headerH = 60 * DPR;
const colGap = 10 * DPR;
let colWidth, colX = [];

function computeLayout() {
  const W = canvas.width;
  const H = canvas.height;
  const cols = 7;
  colWidth = Math.floor((W - padding*2 - colGap*(cols-1)) / cols);
  colX = [];
  for (let i=0;i<cols;i++) {
    colX.push(Math.floor(padding + i*(colWidth+colGap)));
  }
}

function hitDay(x) {
  for (let i=0;i<7;i++) {
    if (x >= colX[i] && x <= colX[i] + colWidth) return i;
  }
  return -1;
}

// --- Drawing text helper ---
function t(text, x, y, size, color, align='left', bold=false) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.font = `${bold?600:400} ${size}px ui-sans-serif, -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial`;
  ctx.fillText(text, x, y);
}

// --- Toast ---
let toast = null;
function showToast(msg) {
  toast = { msg, t0: performance.now() };
}

// --- Toolbar buttons ---
const buttons = [];
function addButton(id, label, x, w) {
  buttons.push({ id, label, x, y: 10*DPR, w, h: 40*DPR });
}
function drawButton(btn) {
  const r = 10*DPR;
  ctx.fillStyle = theme.card;
  roundRect(btn.x, btn.y, btn.w, btn.h, r);
  ctx.fill();
  t(btn.label, btn.x + btn.w/2, btn.y + btn.h/2, 14*DPR, theme.text, 'center', true);
}
function roundRect(x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// --- Blocks ---
function blocksForDay(dayIndex) {
  return blocks.filter(b => b.day === dayIndex && b.week === weekIndex)
               .sort((a,b)=> (a.order??0)-(b.order??0));
}

function drawBlock(b, x, y, w) {
  const h = 88*DPR;
  const r = 12*DPR;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 12*DPR;
  ctx.fillStyle = theme.card;
  roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  const pad = 10*DPR;
  t(b.exercise, x+pad, y+22*DPR, 16*DPR, theme.text, 'left', true);
  t(`${b.sets}×${b.reps}` + (b.weight ? ` @ ${b.weight}`:''), x+pad, y+44*DPR, 14*DPR, theme.sub);
  if (b.notes) t(b.notes, x+pad, y+66*DPR, 12*DPR, theme.sub);
  if (b.imageThumb) {
    ctx.drawImage(b.imageThumb, x+w-64*DPR, y+pad, 54*DPR, 54*DPR);
  } else if (b.imageId) {
    // lazy load thumbnail
    loadThumb(b);
  }
  // drag handle
  t('≡', x+w-18*DPR, y+14*DPR, 16*DPR, theme.sub, 'center', true);
  return h;
}

async function loadThumb(b) {
  const dataUrl = await getImage(b.imageId);
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    const cnv = document.createElement('canvas');
    const cctx = cnv.getContext('2d');
    const s = 64 * DPR;
    cnv.width = s; cnv.height = s;
    // cover
    const r = Math.max(s/img.width, s/img.height);
    const nw = img.width*r, nh = img.height*r;
    cctx.drawImage(img, (s-nw)/2, (s-nh)/2, nw, nh);
    b.imageThumb = cnv;
    requestRender();
  };
  img.src = dataUrl;
}

// --- Interaction ---
let pointer = {x:0,y:0,down:false,id:0};
let dragging = null; // {block, ox, oy, fromDay, index}
let scrollY = 0; // per-column virtual scroll (simple single value for all)

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointer = { x: e.clientX*DPR, y: e.clientY*DPR, down: true, id: e.pointerId };
  const hit = hitTest(pointer.x, pointer.y);
  if (hit?.type === 'button') {
    clickButton(hit.id);
  } else if (hit?.type === 'block') {
    dragging = { block: hit.block, ox: pointer.x - hit.x, oy: pointer.y - hit.y, fromDay: hit.day, index: hit.index };
  } else if (hit?.type === 'headerBtn') {
    headerAction(hit.key);
  } else if (hit?.type === 'blockMenu') {
    blockMenu(hit.block, hit.x, hit.y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX*DPR, y: e.clientY*DPR, down: true, id: e.pointerId };
  if (dragging) requestRender();
});

canvas.addEventListener('pointerup', (e) => {
  pointer.down = false;
  if (dragging) {
    // drop logic
    const day = hitDay(pointer.x);
    if (day >= 0) {
      dragging.block.day = day;
      dragging.block.week = weekIndex;
      // set order to bottom
      const list = blocksForDay(day);
      dragging.block.order = (list[list.length-1]?.order || 0) + 1;
      autoSave();
    }
    dragging = null;
    requestRender();
  }
});

function hitTest(px, py) {
  // header controls
  if (py <= headerH) {
    // check header small buttons (computed in draw)
    for (const hb of headerBtns) {
      if (px>=hb.x && px<=hb.x+hb.w && py>=hb.y && py<=hb.y+hb.h) {
        return {type:'headerBtn', key:hb.key};
      }
    }
    // toolbar buttons
    for (const b of buttons) {
      if (px>=b.x && px<=b.x+b.w && py>=b.y && py<=b.y+b.h) {
        return {type:'button', id:b.id};
      }
    }
  }
  // columns
  let y = headerH + 10*DPR;
  for (let d=0; d<7; d++) {
    const x = colX[d];
    // day header area 36px
    const dh = 36*DPR;
    if (px>=x && px<=x+colWidth && py>=y && py<=y+dh) {
      // clicks on '+' next to title?
      // handled in headerBtns list
    }
    let cy = y + dh + 6*DPR;
    const list = blocksForDay(d);
    for (let i=0;i<list.length;i++) {
      const b = list[i];
      const h = 88*DPR;
      if (px>=x && px<=x+colWidth && py>=cy && py<=cy+h) {
        // detect right side small area as menu
        if (px > x+colWidth-24*DPR && py < cy+24*DPR) {
          return {type:'blockMenu', day:d, block:b, x:x+colWidth-24*DPR, y:cy+20*DPR};
        }
        return {type:'block', day:d, block:b, x, y:cy, index:i};
      }
      cy += h + 8*DPR;
    }
  }
  return null;
}

function clickButton(id) {
  if (id === 'add') {
    createBlockDialog();
  } else if (id === 'presets') {
    choosePreset();
  } else if (id === 'theme') {
    themeKey = themeKey === 'dark' ? 'neon' : 'dark';
    theme = THEMES[themeKey];
    autoSave();
    requestRender();
  } else if (id === 'export') {
    exportJSON();
  } else if (id === 'import') {
    importJSON();
  }
}

function headerAction(key) {
  if (key === 'weekPrev') {
    weekIndex = Math.max(0, weekIndex-1);
    autoSave();
    requestRender();
  } else if (key === 'weekNext') {
    weekIndex = weekIndex+1;
    autoSave();
    requestRender();
  } else if (key === 'addDayBlock') {
    // add to tapped day? we don't know which; fallback to Monday
    createBlockDialog(0);
  }
}

// --- Simple dialogs (use prompt() and small canvas pop menus) ---
function createBlockDialog(dayIndex = 0) {
  const exercise = prompt('Exercise name?', 'Bench Press');
  if (!exercise) return;
  const sets = parseInt(prompt('Number of sets?', '4')||'4',10);
  const reps = parseInt(prompt('Number of reps?', '8')||'8',10);
  const weight = prompt('Weight (optional, e.g., 60kg or 135lb)', '');
  const notes = prompt('Notes (optional)', '');
  const b = { id: uid(), day: dayIndex, week: weekIndex, exercise, sets, reps, weight, notes, order: Date.now() };
  blocks.push(b);
  autoSave();
  requestRender();
}

function choosePreset() {
  const names = presets.map((p,i)=>`${i+1}. ${p.name} — ${p.exercise} ${p.sets}x${p.reps}`).join('\n');
  const idx = parseInt(prompt('Pick a preset number or type "new" to create:\n\n'+names, '1')||'0',10)-1;
  if (Number.isFinite(idx) && presets[idx]) {
    // choose day
    const d = parseInt(prompt('Day (1=Mon..7=Sun)','1')||'1',10)-1;
    const pr = presets[idx];
    const b = { id: uid(), day: Math.max(0,Math.min(6,d)), week: weekIndex, exercise: pr.exercise, sets: pr.sets, reps: pr.reps, order: Date.now() };
    blocks.push(b);
    autoSave();
    requestRender();
  } else {
    if (confirm('Create a new preset?')) {
      const name = prompt('Preset name','Push B')||'Custom';
      const exercise = prompt('Exercise','Incline DB Press')||'Exercise';
      const sets = parseInt(prompt('Sets','4')||'4',10);
      const reps = parseInt(prompt('Reps','8')||'8',10);
      presets.push({name, exercise, sets, reps});
      autoSave();
    }
  }
}

function blockMenu(b, x, y) {
  const action = prompt(`Block: ${b.exercise}\n1. Edit\n2. Add/Change Image\n3. Duplicate\n4. Delete\n(enter number)`, '1');
  if (!action) return;
  if (action === '1') {
    const ex = prompt('Exercise', b.exercise) ?? b.exercise;
    const sets = parseInt(prompt('Sets', String(b.sets))||String(b.sets),10);
    const reps = parseInt(prompt('Reps', String(b.reps))||String(b.reps),10);
    const weight = prompt('Weight', b.weight||'') ?? b.weight;
    const notes = prompt('Notes', b.notes||'') ?? b.notes;
    Object.assign(b,{exercise:ex, sets, reps, weight, notes});
    autoSave();
    requestRender();
  } else if (action === '2') {
    // pick image
    imagePicker.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        const id = b.imageId || uid();
        await putImage(id, dataUrl);
        b.imageId = id;
        b.imageThumb = null;
        autoSave();
        requestRender();
        imagePicker.value = '';
      };
      reader.readAsDataURL(file);
    };
    imagePicker.click();
  } else if (action === '3') {
    const copy = {...b, id:uid(), order: Date.now()};
    blocks.push(copy);
    autoSave();
    requestRender();
  } else if (action === '4') {
    if (confirm('Delete this block?')) {
      blocks = blocks.filter(x => x.id !== b.id);
      autoSave();
      requestRender();
    }
  }
}

// Export / Import (for backups / migration between devices manually)
function exportJSON() {
  const data = { weekIndex, themeKey, blocks, presets, exportedAt: new Date().toISOString(), version: 1 };
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gymblocks-backup.json';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

function importJSON() {
  jsonImport.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (data.blocks && Array.isArray(data.blocks)) blocks = data.blocks;
      if (data.presets && Array.isArray(data.presets)) presets = data.presets;
      if (data.themeKey && THEMES[data.themeKey]) {
        themeKey = data.themeKey; theme = THEMES[themeKey];
      }
      if (Number.isFinite(data.weekIndex)) weekIndex = data.weekIndex;
      autoSave();
      requestRender();
    } catch (e) {
      alert('Invalid JSON');
    } finally {
      jsonImport.value='';
    }
  };
  jsonImport.click();
}

// --- Rendering ---
let headerBtns = [];
function render() {
  computeLayout();
  drawGradientBg();

  // top title
  t('Gym Blocks', padding, headerH/2, 22*DPR, theme.text, 'left', true);
  // week controls
  headerBtns = [];
  const wkX = padding + 150*DPR;
  drawPill(wkX, 12*DPR, 120*DPR, 36*DPR, `Week ${weekIndex+1}`);
  headerBtns.push({key:'weekPrev', x:wkX-40*DPR, y:12*DPR, w:36*DPR, h:36*DPR});
  headerBtns.push({key:'weekNext', x:wkX+120*DPR+4*DPR, y:12*DPR, w:36*DPR, h:36*DPR});
  // arrows
  drawCircleBtn(wkX-40*DPR, 12*DPR, '<');
  drawCircleBtn(wkX+120*DPR+4*DPR, 12*DPR, '>');

  // toolbar
  buttons.length = 0;
  let bx = wkX + 200*DPR;
  addButton('add','+ Block', bx, 110*DPR); bx += 120*DPR;
  addButton('presets','Presets', bx, 120*DPR); bx += 130*DPR;
  addButton('theme','Theme', bx, 110*DPR); bx += 120*DPR;
  addButton('export','Export', bx, 110*DPR); bx += 120*DPR;
  addButton('import','Import', bx, 110*DPR);
  buttons.forEach(drawButton);

  // columns
  let y = headerH + 10*DPR;
  for (let d=0; d<7; d++) {
    const x = colX[d];
    // day header
    ctx.fillStyle = theme.card;
    roundRect(x, y, colWidth, 36*DPR, 10*DPR); ctx.fill();
    t(DAYS[d], x+10*DPR, y+18*DPR, 14*DPR, theme.text, 'left', true);
    t('+', x+colWidth-18*DPR, y+18*DPR, 18*DPR, theme.sub, 'center', true);

    // list
    let cy = y + 36*DPR + 6*DPR;
    const list = blocksForDay(d);
    for (let i=0;i<list.length;i++) {
      const b = list[i];
      // Skip drawing if this is the one being dragged; will draw later at pointer
      if (dragging && dragging.block.id === b.id) continue;
      const h = drawBlock(b, x, cy, colWidth);
      // small menu dot
      t('•', x+colWidth-12*DPR, cy+12*DPR, 22*DPR, theme.sub, 'center', true);
      cy += h + 8*DPR;
    }
  }

  // dragging block
  if (dragging) {
    const x = pointer.x - dragging.ox;
    const y = pointer.y - dragging.oy;
    ctx.globalAlpha = 0.9;
    drawBlock(dragging.block, x, y, colWidth);
    ctx.globalAlpha = 1;
  }

  // toast
  if (toast) {
    const life = performance.now()-toast.t0;
    if (life > 1600) toast = null;
    else {
      const alpha = life < 200 ? life/200 : life>1400 ? (1600-life)/200 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      const tw = 160*DPR, th = 36*DPR;
      const x = canvas.width - tw - 14*DPR, y = 14*DPR;
      ctx.fillStyle = theme.good;
      roundRect(x,y,tw,th,10*DPR); ctx.fill();
      t(toast.msg, x+tw/2, y+th/2, 14*DPR, '#072b1f','center',true);
      ctx.restore();
    }
  }

  // subtle animated accents
  drawAccents();
}

function drawPill(x,y,w,h,label) {
  ctx.fillStyle = theme.card;
  roundRect(x,y,w,h, h/2); ctx.fill();
  t(label, x+w/2, y+h/2, 14*DPR, theme.text, 'center', true);
}
function drawCircleBtn(x,y,label) {
  const s = 36*DPR;
  ctx.fillStyle = theme.card;
  roundRect(x,y,s,s, s/2); ctx.fill();
  t(label, x+s/2, y+s/2, 16*DPR, theme.text, 'center', true);
}

let tick = 0;
function drawAccents() {
  tick += 0.01;
  const cx = canvas.width - 80*DPR;
  const cy = canvas.height - 80*DPR;
  const r = 40*DPR + Math.sin(tick)*6*DPR;
  ctx.strokeStyle = theme.accentA;
  ctx.lineWidth = 2*DPR;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = theme.accentB;
  ctx.beginPath(); ctx.arc(cx, cy, r*0.7, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = theme.accentC;
  ctx.beginPath(); ctx.arc(cx, cy, r*0.45, 0, Math.PI*2); ctx.stroke();
}

// --- Render loop ---
let dirty = true;
function requestRender(){ dirty = true; }
function loop(){
  if (dirty) { render(); dirty = false; }
  requestAnimationFrame(loop);
}
loop();

// --- Helpers to create a starter layout on first run ---
if (!localStorage.getItem('initialized')) {
  const starter = [
    {day:0, exercise:'Bench Press', sets:4, reps:8},
    {day:0, exercise:'Incline DB Press', sets:3, reps:12},
    {day:2, exercise:'Deadlift', sets:5, reps:5},
    {day:2, exercise:'Lat Pulldown', sets:4, reps:10},
    {day:4, exercise:'Back Squat', sets:5, reps:5},
  ];
  starter.forEach((s,i)=>blocks.push({ id:uid(), week:0, day:s.day, exercise:s.exercise, sets:s.sets, reps:s.reps, order:i }));
  localStorage.setItem('initialized','1');
  save();
  requestRender();
} else {
  requestRender();
}

// --- Future-ready: basic scaffold for account sync (not active) ---
/*
const Sync = {
  enabled:false,
  async login(){}, // OAuth/token flow placeholder
  async pull(){},  // Fetch remote backup
  async push(){},  // Upload current state
};
*/
