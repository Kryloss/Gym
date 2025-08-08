// Canvas Gym Planner — all UI in canvas, touch-first, iPhone-friendly
// Big buttons, tabs for weeks, scrollable days, draggable exercise blocks
// Autosaves to localStorage; PWA-ready with service worker/manifest

(() => {
  const DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const uploader = document.getElementById('uploader');

  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  // Theme options
  const THEMES = [
    {name:"Neon", bg1:"#0b0d10", bg2:"#101F3D", accent:"#6CFFB8", accent2:"#6CE5FF", text:"#EAF2F7"},
    {name:"Sunset", bg1:"#301934", bg2:"#FF5F6D", accent:"#FFC371", accent2:"#FFE29A", text:"#fff"},
    {name:"Forest", bg1:"#0b2b26", bg2:"#0b8457", accent:"#22d1a9", accent2:"#6ef3d6", text:"#eafff7"}
  ];

  // Storage
  const saveKey = "gym_planner_canvas_v1";
  const load = () => {
    try { return JSON.parse(localStorage.getItem(saveKey)) || null; } catch { return null; }
  };
  const save = () => {
    localStorage.setItem(saveKey, JSON.stringify(state));
  };

  // Default data model
  const defaultWeeks = 4;
  function makeEmptyPlan() {
    const weeks = [];
    for (let w=0; w<defaultWeeks; w++) {
      const days = [];
      for (let d=0; d<7; d++) {
        days.push({ name: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][d], blocks:[] });
      }
      weeks.push({ name: `Week ${w+1}`, days });
    }
    return weeks;
  }

  // Built-in preset images (simple emoji icons drawn to data URLs)
  function emojiToDataURL(emoji){
    const s = 180;
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = s;
    const c = cnv.getContext('2d');
    c.fillStyle = "#ffffff";
    c.fillRect(0,0,s,s);
    c.font = "140px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#000";
    c.fillText(emoji, s/2, s/2);
    return cnv.toDataURL("image/png");
  }

  const PRESET_IMAGES = {
    biceps: emojiToDataURL("💪"),
    pullups: emojiToDataURL("🤸"),
    dumbbells: emojiToDataURL("🏋️"),
    legs: emojiToDataURL("🦵")
  };

  const PRESETS = [
    { name:"Biceps Curls", sets:4, reps:12, weight:"", notes:"", img: PRESET_IMAGES.biceps },
    { name:"Pull-ups", sets:3, reps:8, weight:"BW", notes:"", img: PRESET_IMAGES.pullups },
    { name:"Dumbbell Press", sets:4, reps:10, weight:"", notes:"", img: PRESET_IMAGES.dumbbells },
    { name:"Leg Press", sets:4, reps:12, weight:"", notes:"", img: PRESET_IMAGES.legs }
  ];

  // State
  let state = load() || {
    themeIndex: 0,
    weekIndex: 0,
    scrollY: 0,
    drag: null, // { from: {week,day,index}, block, yOffset }
    plan: makeEmptyPlan(),
    stats: {} // completion map blockId -> done boolean OR per-set toggles
  };
  // Ensure structure compatibility
  if (!state.plan) state.plan = makeEmptyPlan();

  // Helpers
  function uid() { return Math.random().toString(36).slice(2,9); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  // Layout metrics
  const METRICS = {
    headerH: 72,
    tabsH: 60,
    dayTitleH: 48,
    blockH: 110,
    gap: 10,
    sidePad: 14,
    addBtnH: 64,
    btnH: 54,
    fabSize: 64
  };

  // Resize
  function resize(){
    const w = Math.floor(window.innerWidth * DPR);
    const h = Math.floor(window.innerHeight * DPR);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${Math.floor(w/DPR)}px`;
    canvas.style.height = `${Math.floor(h/DPR)}px`;
    draw();
  }
  window.addEventListener('resize', resize, {passive:true});

  // Interaction state
  let pointer = {down:false, x:0, y:0, lastY:0, startY:0, scrollyAtDown:0, dragging:false};

  canvas.addEventListener('touchstart', (e)=>{
    const t = e.changedTouches[0];
    onPointerDown(t.clientX, t.clientY);
    e.preventDefault();
  }, {passive:false});
  canvas.addEventListener('touchmove', (e)=>{
    const t = e.changedTouches[0];
    onPointerMove(t.clientX, t.clientY);
    e.preventDefault();
  }, {passive:false});
  canvas.addEventListener('touchend', (e)=>{
    const t = e.changedTouches[0];
    onPointerUp(t.clientX, t.clientY);
    e.preventDefault();
  }, {passive:false});

  canvas.addEventListener('mousedown', (e)=>{
    onPointerDown(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', (e)=>{
    if (pointer.down) onPointerMove(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', (e)=>{
    if (pointer.down) onPointerUp(e.clientX, e.clientY);
  });

  // Hit regions we compute each frame
  let hits = [];

  function addHit(type, rect, data){
    hits.push({type, rect, data});
  }
  function hitAt(x,y){
    for (let i=hits.length-1; i>=0; i--){
      const h = hits[i];
      const r = h.rect;
      if (x>=r.x && y>=r.y && x<=r.x+r.w && y<=r.y+r.h) return h;
    }
    return null;
  }

  // UI actions
  function switchTheme(){
    state.themeIndex = (state.themeIndex + 1) % THEMES.length;
    save(); draw();
  }
  function addWeek(){
    const n = state.plan.length+1;
    const days = [];
    for (let d=0; d<7; d++){
      days.push({ name: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][d], blocks:[] });
    }
    state.plan.push({ name:`Week ${n}`, days });
    save(); draw();
  }
  function addBlock(dayIndex){
    const choice = prompt("Type exercise name or choose: \n1) Biceps Curls\n2) Pull-ups\n3) Dumbbell Press\n4) Leg Press\n\nOr leave number empty to enter your own.");
    if (choice === null) return;
    let block = null;
    const asInt = parseInt(choice,10);
    if (!isNaN(asInt) && asInt>=1 && asInt<=PRESETS.length){
      const p = PRESETS[asInt-1];
      block = {...p, id: uid(), done:false, perSet: Array(p.sets).fill(false)};
    } else {
      const name = choice.trim() || "Custom Exercise";
      const sets = parseInt(prompt("Sets:", "4")||"4",10) || 4;
      const reps = parseInt(prompt("Reps:", "10")||"10",10) || 10;
      const weight = (prompt("Weight (optional):", "")||"").trim();
      const notes = (prompt("Notes (optional):", "")||"").trim();
      block = { id: uid(), name, sets, reps, weight, notes, img:null, done:false, perSet: Array(sets).fill(false)};
    }
    state.plan[state.weekIndex].days[dayIndex].blocks.push(block);
    save(); draw();
  }
  function uploadImageFor(block){
    uploader.onchange = () => {
      const file = uploader.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        block.img = reader.result;
        save(); draw();
      };
      reader.readAsDataURL(file);
      uploader.value = "";
    };
    uploader.click();
  }
  function chooseBuiltInImage(block){
    const pick = prompt("Choose image: 1) 💪 biceps  2) 🤸 pull-ups  3) 🏋️ dumbbells  4) 🦵 legs");
    const m = {1:"biceps",2:"pullups",3:"dumbbells",4:"legs"};
    const key = m[parseInt(pick,10)];
    if (key && PRESET_IMAGES[key]){
      block.img = PRESET_IMAGES[key];
      save(); draw();
    }
  }

  function deleteBlock(dayIndex, blockIndex){
    if (!confirm("Delete this block?")) return;
    state.plan[state.weekIndex].days[dayIndex].blocks.splice(blockIndex,1);
    save(); draw();
  }

  function toggleSet(block, i){
    block.perSet[i] = !block.perSet[i];
    block.done = block.perSet.every(v=>v);
    save(); draw();
  }

  // Pointer handlers
  function onPointerDown(x,y){
    pointer.down = true; pointer.x = x*DPR; pointer.y = y*DPR; pointer.startY = pointer.y; pointer.scrollyAtDown = state.scrollY; pointer.dragging = false;

    const h = hitAt(pointer.x, pointer.y);
    if (h){
      if (h.type === "tab"){
        state.weekIndex = h.data.index;
        state.scrollY = 0;
        save(); draw();
      } else if (h.type === "theme"){
        switchTheme();
      } else if (h.type === "addWeek"){
        addWeek();
      } else if (h.type === "addBlock"){
        addBlock(h.data.dayIndex);
      } else if (h.type === "uploadImage"){
        uploadImageFor(h.data.block);
      } else if (h.type === "presetImage"){
        chooseBuiltInImage(h.data.block);
      } else if (h.type === "deleteBlock"){
        deleteBlock(h.data.dayIndex, h.data.blockIndex);
      } else if (h.type === "toggleSet"){
        toggleSet(h.data.block, h.data.setIndex);
      } else if (h.type === "dragHandle"){
        // Begin drag
        state.drag = {
          from: { week: state.weekIndex, day: h.data.dayIndex, index: h.data.blockIndex },
          block: JSON.parse(JSON.stringify(h.data.block)),
          yOffset: pointer.y - h.rect.y
        };
        pointer.dragging = true;
      }
    }
  }
  function onPointerMove(x,y){
    const ny = y*DPR;
    const dy = ny - pointer.y;
    pointer.x = x*DPR; pointer.y = ny;

    if (!pointer.dragging){
      // Scroll
      const newScroll = pointer.scrollyAtDown + (pointer.startY - pointer.y);
      state.scrollY = clamp(newScroll, 0, Math.max(0, contentHeight - (canvas.height - METRICS.headerH - METRICS.tabsH)));
      draw();
    } else {
      draw(); // dragging visual updates
    }
  }
  function onPointerUp(x,y){
    pointer.down = false;

    if (pointer.dragging && state.drag){
      // Drop logic: find nearest day and index by y position
      const drop = findDropTarget(pointer.x, pointer.y);
      if (drop){
        // Remove from original
        const fromDay = state.plan[state.drag.from.week].days[state.drag.from.day];
        fromDay.blocks.splice(state.drag.from.index,1);
        // Insert into new
        const toDay = state.plan[state.weekIndex].days[drop.dayIndex];
        toDay.blocks.splice(drop.insertIndex, 0, state.drag.block);
        save();
      }
    }
    state.drag = null;
    pointer.dragging = false;
    draw();
  }

  function findDropTarget(px, py){
    // Check over which day list we are
    // Use dayRects computed in draw
    for (let d=0; d<dayRects.length; d++){
      const r = dayRects[d];
      if (px>=r.x && px<=r.x+r.w && py>=r.y && py<=r.y+r.h){
        // determine insert index based on y
        const blocks = state.plan[state.weekIndex].days[d].blocks;
        const relY = py - r.y + state.scrollY - r.scrollBase;
        let idx = Math.floor(relY / (METRICS.blockH + METRICS.gap));
        idx = clamp(idx, 0, blocks.length);
        return { dayIndex: d, insertIndex: idx };
      }
    }
    return null;
  }

  // Drawing
  let contentHeight = 0;
  let dayRects = [];

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  function gradientBG(){
    const th = THEMES[state.themeIndex];
    const g = ctx.createLinearGradient(0,0,0,canvas.height);
    g.addColorStop(0, th.bg1);
    g.addColorStop(1, th.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0,0,canvas.width,canvas.height);
  }

  function drawHeader(){
    const th = THEMES[state.themeIndex];
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = th.bg1 + "AA";
    roundRect(METRICS.sidePad, METRICS.sidePad, canvas.width - METRICS.sidePad*2, METRICS.headerH - METRICS.sidePad*2, 18);
    ctx.fill();
    ctx.restore();

    // Title
    ctx.fillStyle = th.text;
    ctx.font = `${28*DPR}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Gym Planner", METRICS.sidePad*2, METRICS.headerH/2);

    // Theme button
    const btnW = 180*DPR, btnH = METRICS.btnH*DPR;
    const bx = canvas.width - btnW - METRICS.sidePad*2;
    const by = (METRICS.headerH - btnH)/2;
    ctx.fillStyle = THEMES[state.themeIndex].accent;
    roundRect(bx, by, btnW, btnH, 16*DPR);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = `${22*DPR}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("Theme", bx+btnW/2, by+btnH/2+7);
    addHit("theme", {x:bx,y:by,w:btnW,h:btnH}, {});
  }

  function drawTabs(){
    const th = THEMES[state.themeIndex];
    const y0 = METRICS.headerH;
    const tabW = Math.min(220*DPR, (canvas.width - METRICS.sidePad*2) / Math.max(3, state.plan.length));
    const gap = 10*DPR;
    let x = METRICS.sidePad*DPR;
    for (let i=0;i<state.plan.length;i++){
      const sel = i===state.weekIndex;
      ctx.fillStyle = sel ? th.accent2 : th.accent + "AA";
      const w = tabW - gap;
      const h = METRICS.tabsH*DPR - gap;
      roundRect(x, y0 + gap/2, w, h, 16*DPR);
      ctx.fill();
      ctx.fillStyle = sel ? "#000" : th.text;
      ctx.font = `${20*DPR}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(state.plan[i].name, x + w/2, y0 + h/2 + 7);
      addHit("tab", {x, y:y0 + gap/2, w, h}, {index:i});
      x += tabW;
    }

    // Add week button
    const btnW = 140*DPR, btnH = METRICS.btnH*DPR;
    const bx = canvas.width - btnW - METRICS.sidePad*DPR;
    const by = y0 + (METRICS.tabsH*DPR - btnH)/2;
    ctx.fillStyle = th.accent;
    roundRect(bx, by, btnW, btnH, 16*DPR);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = `${22*DPR}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("+ Week", bx+btnW/2, by+btnH/2+7);
    addHit("addWeek", {x:bx,y:by,w:btnW,h:btnH}, {});
  }

  function daySectionY(dayIndex){ // top of day section within scroll area
    let y = 0;
    for (let d=0; d<dayIndex; d++){
      const blocks = state.plan[state.weekIndex].days[d].blocks.length;
      y += METRICS.dayTitleH + (blocks*(METRICS.blockH+METRICS.gap)) + METRICS.addBtnH + METRICS.gap*2;
    }
    return y;
  }

  function drawContent(){
    hits = [];
    dayRects = [];
    const th = THEMES[state.themeIndex];
    const top = METRICS.headerH + METRICS.tabsH;
    const innerW = canvas.width - METRICS.sidePad*DPR*2;
    const listX = METRICS.sidePad*DPR;
    const scrollTop = state.scrollY;
    const viewH = canvas.height - top;

    // Compute content height
    let totalH = 0;
    for (let d=0; d<7; d++){
      const blocks = state.plan[state.weekIndex].days[d].blocks.length;
      totalH += METRICS.dayTitleH + (blocks*(METRICS.blockH+METRICS.gap)) + METRICS.addBtnH + METRICS.gap*2;
    }
    contentHeight = totalH;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, canvas.width, viewH);
    ctx.clip();

    const yBase = top - scrollTop;

    for (let d=0; d<7; d++){
      const day = state.plan[state.weekIndex].days[d];
      const sectionY = yBase + daySectionY(d);

      // Day header
      const dayHdrH = METRICS.dayTitleH*DPR;
      ctx.fillStyle = th.bg1 + "AA";
      roundRect(listX, sectionY + METRICS.gap*DPR, innerW, dayHdrH, 14*DPR);
      ctx.fill();
      ctx.fillStyle = th.text;
      ctx.font = `${22*DPR}px system-ui`;
      ctx.textAlign = "left";
      ctx.fillText(day.name, listX + 16*DPR, sectionY + dayHdrH/2 + 7);

      // Progress bar (based on blocks done)
      const doneCount = day.blocks.filter(b=>b.done).length;
      const totalBlocks = Math.max(1, day.blocks.length);
      const progress = doneCount/totalBlocks;
      const pbW = 140*DPR, pbH = 12*DPR;
      const pbx = listX + innerW - pbW - 16*DPR;
      const pby = sectionY + dayHdrH/2 - pbH/2;
      ctx.fillStyle = "#00000055";
      roundRect(pbx, pby, pbW, pbH, 6*DPR); ctx.fill();
      ctx.fillStyle = th.accent2;
      roundRect(pbx, pby, pbW*progress, pbH, 6*DPR); ctx.fill();

      // Blocks
      let yb = sectionY + dayHdrH + METRICS.gap*DPR;
      for (let i=0; i<day.blocks.length; i++){
        const b = day.blocks[i];
        const bh = METRICS.blockH*DPR;
        // Card
        ctx.fillStyle = th.accent + "EE";
        roundRect(listX, yb, innerW, bh, 18*DPR);
        ctx.fill();

        // Drag handle area (left)
        const handleW = 36*DPR;
        ctx.fillStyle = "#00000020";
        roundRect(listX, yb, handleW, bh, 18*DPR);
        ctx.fill();
        // dotted
        ctx.fillStyle = "#00000066";
        for (let gy= yb+20*DPR; gy< yb+bh-20*DPR; gy+=16*DPR){
          ctx.fillRect(listX + 16*DPR, gy, 4*DPR, 4*DPR);
        }

        addHit("dragHandle", {x:listX, y:yb, w:handleW, h:bh}, {dayIndex:d, blockIndex:i, block:b});

        // Image thumb
        const imgSize = 80*DPR;
        const imgX = listX + handleW + 12*DPR;
        const imgY = yb + (bh - imgSize)/2;
        ctx.fillStyle = "#ffffff";
        roundRect(imgX, imgY, imgSize, imgSize, 12*DPR);
        ctx.fill();
        if (b.img){
          const im = new Image();
          im.src = b.img;
          im.onload = ()=> draw();
          ctx.save();
          ctx.beginPath(); roundRect(imgX, imgY, imgSize, imgSize, 12*DPR); ctx.clip();
          ctx.drawImage(im, imgX, imgY, imgSize, imgSize);
          ctx.restore();
        } else {
          ctx.fillStyle = "#000";
          ctx.font = `${46*DPR}px system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("＋", imgX+imgSize/2, imgY+imgSize/2+8);
        }

        // Buttons for image
        const btnW = 140*DPR, btnH = 40*DPR;
        const upx = imgX + imgSize + 10*DPR;
        const upy = imgY;
        ctx.fillStyle = "#fff";
        roundRect(upx, upy, btnW, btnH, 10*DPR); ctx.fill();
        ctx.fillStyle = "#000"; ctx.font = `${18*DPR}px system-ui`; ctx.textAlign="center";
        ctx.fillText("Upload Image", upx+btnW/2, upy+btnH/2+6);
        addHit("uploadImage", {x:upx,y:upy,w:btnW,h:btnH}, {block:b});

        const prex = upx, prey = upy + btnH + 8*DPR;
        roundRect(prex, prey, btnW, btnH, 10*DPR); ctx.fill();
        ctx.fillStyle = "#000"; ctx.fillText("Preset Image", prex+btnW/2, prey+btnH/2+6);
        addHit("presetImage", {x:prex,y:prey,w:btnW,h:btnH}, {block:b});

        // Texts
        const tx = upx + btnW + 12*DPR;
        const ty = yb + 36*DPR;
        ctx.fillStyle = "#000";
        ctx.font = `${22*DPR}px system-ui`; ctx.textAlign = "left";
        ctx.fillText(b.name, tx, ty);
        ctx.font = `${18*DPR}px system-ui`;
        ctx.fillText(`${b.sets} x ${b.reps}  ${b.weight?("• "+b.weight):""}`, tx, ty + 26*DPR);
        if (b.notes) ctx.fillText(b.notes, tx, ty + 50*DPR);

        // Per-set checkboxes
        const setsX = tx;
        const setsY = yb + bh - 38*DPR;
        for (let s=0; s<b.sets; s++){
          const cx = setsX + s*36*DPR;
          const cy = setsY;
          ctx.fillStyle = "#ffffff";
          roundRect(cx, cy, 26*DPR, 26*DPR, 6*DPR); ctx.fill();
          if (b.perSet[s]){
            ctx.fillStyle = "#000"; ctx.font = `${22*DPR}px system-ui`; ctx.textAlign="center";
            ctx.fillText("✓", cx+13*DPR, cy+18*DPR);
          }
          addHit("toggleSet", {x:cx, y:cy, w:26*DPR, h:26*DPR}, {block:b, setIndex:s});
        }

        // Delete button (trash) — big
        const delW = 60*DPR, delH= 40*DPR;
        const delx = listX + innerW - delW - 10*DPR;
        const dely = yb + bh - delH - 12*DPR;
        ctx.fillStyle = "#fff"; roundRect(delx, dely, delW, delH, 10*DPR); ctx.fill();
        ctx.fillStyle = "#000"; ctx.font = `${20*DPR}px system-ui`; ctx.textAlign="center";
        ctx.fillText("🗑", delx+delW/2, dely+delH/2+6);
        addHit("deleteBlock", {x:delx,y:dely,w:delW,h:delH}, {dayIndex:d, blockIndex:i});

        yb += bh + METRICS.gap*DPR;
      }

      // Add block button
      const abW = innerW, abH = METRICS.addBtnH*DPR;
      const abx = listX, aby = yb;
      ctx.fillStyle = th.accent2;
      roundRect(abx, aby, abW, abH, 16*DPR); ctx.fill();
      ctx.fillStyle = "#000"; ctx.font = `${22*DPR}px system-ui`; ctx.textAlign="center";
      ctx.fillText("+ Add exercise block", abx + abW/2, aby + abH/2 + 7);
      addHit("addBlock", {x:abx, y:aby, w:abW, h:abH}, {dayIndex:d});

      // Remember day rect for drop targets
      dayRects.push({x: listX, y: sectionY + dayHdrH, w: innerW, h: (yb - (sectionY + dayHdrH)) + abH + 8*DPR, scrollBase: daySectionY(d)});
    }

    // Drag ghost
    if (state.drag){
      const gh = METRICS.blockH*DPR;
      const gw = innerW;
      const gx = listX;
      const gy = pointer.y - state.drag.yOffset;
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = "#FFD166";
      roundRect(gx, gy, gw, gh, 18*DPR); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000"; ctx.font = `${22*DPR}px system-ui`; ctx.textAlign="left";
      ctx.fillText(state.drag.block.name, gx+20*DPR, gy+40*DPR);
      ctx.font = `${18*DPR}px system-ui`;
      ctx.fillText(`${state.drag.block.sets} x ${state.drag.block.reps} ${state.drag.block.weight?("• "+state.drag.block.weight):""}`, gx+20*DPR, gy+64*DPR);
    }

    ctx.restore();
  }

  function draw(){
    gradientBG();
    drawHeader();
    drawTabs();
    drawContent();
  }

  resize();
})();