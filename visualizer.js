/* Ombré Paint Visualizer – runs fully in the browser. Loaded only when the Visualizer tab opens. */
(async function () {
  const root = document.getElementById('vizRoot');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  const WA = '923325007200', MAXW = 900;
  let data;
  try { data = await (await fetch('shades.json', { cache: 'no-cache' })).json(); }
  catch (e) { root.innerHTML = '<p class="p-6 text-sm text-red-700">Could not load shades.json</p>'; return; }

  let favs = []; try { favs = JSON.parse(localStorage.getItem('om_fav') || '[]'); } catch (e) {}
  const S = { mode: 'paint', family: 'All', q: '', shade: null, layers: [], hist: [], tol: 28, light: 'day', favOnly: false };
  let src = null, W = 0, H = 0;

  root.innerHTML = `
  <div class="grid lg:grid-cols-12 gap-6">
    <div class="lg:col-span-7 space-y-3">
      <div class="flex flex-wrap gap-2 items-center">
        <button data-mode="paint" class="vzMode px-4 py-2 rounded-xl text-xs font-bold">Paint</button>
        <button data-mode="wood" class="vzMode px-4 py-2 rounded-xl text-xs font-bold">Wood Dyer</button>
        <button id="vzLight" class="px-4 py-2 rounded-xl text-xs font-bold bg-brand-surfaceSoft border border-brand-border">Day light</button>
        <label class="ml-auto px-4 py-2 rounded-xl text-xs font-bold bg-brand-primary text-white cursor-pointer">Use my photo<input id="vzFile" type="file" accept="image/*" class="hidden"></label>
      </div>
      <div id="vzRooms" class="flex gap-2 overflow-x-auto"></div>
      <div id="vzStage" class="relative rounded-2xl overflow-hidden border border-brand-border bg-slate-100 min-h-[200px] cursor-crosshair">
        <canvas id="vzOut" class="block w-full h-auto"></canvas>
        <canvas id="vzOrig" class="absolute inset-0 w-full h-full pointer-events-none" style="clip-path:inset(0 100% 0 0)"></canvas>
        <p id="vzEmpty" class="absolute inset-0 flex items-center justify-center text-sm text-brand-muted p-6 text-center">Choose a room above or upload your own photo.</p>
      </div>
      <label class="block text-[11px] font-semibold text-slate-700">Before ↔ After <input id="vzCmp" type="range" min="0" max="100" value="0" class="w-full"></label>
      <label class="block text-[11px] font-semibold text-slate-700">Wall selection tolerance <input id="vzTol" type="range" min="5" max="80" value="28" class="w-full"></label>
      <div class="flex flex-wrap gap-2">
        <button id="vzUndo" class="px-4 py-2 rounded-xl text-xs font-bold bg-brand-surfaceSoft border border-brand-border">Undo</button>
        <button id="vzReset" class="px-4 py-2 rounded-xl text-xs font-bold bg-brand-surfaceSoft border border-brand-border">Reset</button>
        <button id="vzDl" class="px-4 py-2 rounded-xl text-xs font-bold bg-brand-surfaceSoft border border-brand-border">Download</button>
        <button id="vzShare" class="px-4 py-2 rounded-xl text-xs font-bold bg-brand-surfaceSoft border border-brand-border">Share</button>
      </div>
      <p id="vzMsg" class="text-xs text-brand-muted min-h-[1rem]">Pick a shade, then tap a wall, ceiling or door in the picture. Tap another area for a different colour.</p>
    </div>
    <div class="lg:col-span-5 space-y-3">
      <input id="vzSearch" type="search" placeholder="Search shade name, code or HEX" class="w-full bg-brand-surfaceSoft border border-brand-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-primary">
      <div id="vzFam" class="flex flex-wrap gap-1.5"></div>
      <div id="vzGrid" class="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[300px] overflow-y-auto pr-1"></div>
      <div id="vzSel" class="bg-brand-surfaceSoft border border-brand-border rounded-2xl p-4 text-sm text-brand-muted">No shade selected.</div>
      <p class="text-[11px] text-brand-muted leading-relaxed">Colours shown on screen may differ from the real paint because of screen settings and room lighting. Please check the physical shade card before buying. Your photo stays on your phone and is never uploaded.</p>
    </div>
  </div>`;
  const $ = id => document.getElementById(id);
  const out = $('vzOut'), orig = $('vzOrig'), ctx = out.getContext('2d', { willReadFrequently: true }), octx = orig.getContext('2d');
  const msg = t => { $('vzMsg').textContent = t; };
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  /* ---------- picture loading ---------- */
  function loadImg(url) {
    const im = new Image();
    im.onload = () => {
      const sc = Math.min(1, MAXW / im.naturalWidth);
      W = Math.round(im.naturalWidth * sc); H = Math.round(im.naturalHeight * sc);
      out.width = orig.width = W; out.height = orig.height = H;
      octx.drawImage(im, 0, 0, W, H); src = octx.getImageData(0, 0, W, H);
      S.layers = []; S.hist = []; $('vzEmpty').style.display = 'none'; render();
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
    im.onerror = () => msg('Could not open that picture.');
    im.src = url;
  }
  $('vzFile').onchange = e => { const f = e.target.files[0]; if (f) loadImg(URL.createObjectURL(f)); };

  /* ---------- recolour: keeps the photo's own light, shadow and texture ---------- */
  function render() {
    if (!src) return;
    const img = new ImageData(new Uint8ClampedArray(src.data), W, H), d = img.data, s = src.data;
    const k = S.mode === 'wood' ? 1.25 : 1;
    for (const L of S.layers) {
      const [tr, tg, tb] = L.rgb, m = L.mask;
      for (let p = 0; p < m.length; p++) if (m[p]) {
        const i = p * 4, lum = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
        const r = Math.max(0, 1 + (lum / L.avg - 1) * k);
        d[i] = Math.min(255, tr * r); d[i + 1] = Math.min(255, tg * r); d[i + 2] = Math.min(255, tb * r);
      }
    }
    ctx.putImageData(img, 0, 0);
    out.style.filter = orig.style.filter = S.light === 'eve' ? 'sepia(.35) brightness(.78) saturate(1.1)' : 'none';
  }

  /* ---------- tap to select (region grow with tolerance) ---------- */
  function grow(sx, sy) {
    const s = src.data, N = W * H, mask = new Uint8Array(N), at = (x, y) => (y * W + x) * 4;
    let r0 = 0, g0 = 0, b0 = 0, c = 0;
    for (let y = Math.max(0, sy - 2); y <= Math.min(H - 1, sy + 2); y++) for (let x = Math.max(0, sx - 2); x <= Math.min(W - 1, sx + 2); x++) { const i = at(x, y); r0 += s[i]; g0 += s[i + 1]; b0 += s[i + 2]; c++; }
    r0 /= c; g0 /= c; b0 /= c;
    const ok = p => { const i = p * 4; return Math.max(Math.abs(s[i] - r0), Math.abs(s[i + 1] - g0), Math.abs(s[i + 2] - b0)) <= S.tol; };
    const st = [sy * W + sx]; mask[st[0]] = 1;
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0;
      if (x > 0 && !mask[p - 1] && ok(p - 1)) { mask[p - 1] = 1; st.push(p - 1); }
      if (x < W - 1 && !mask[p + 1] && ok(p + 1)) { mask[p + 1] = 1; st.push(p + 1); }
      if (y > 0 && !mask[p - W] && ok(p - W)) { mask[p - W] = 1; st.push(p - W); }
      if (y < H - 1 && !mask[p + W] && ok(p + W)) { mask[p + W] = 1; st.push(p + W); }
    }
    let sum = 0, n = 0;
    for (let p = 0; p < N; p++) if (mask[p]) { const i = p * 4; sum += 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2]; n++; }
    return { mask, avg: Math.max(1, sum / Math.max(1, n)), n };
  }
  $('vzStage').addEventListener('click', e => {
    if (!src) return;
    if (!S.shade) { msg('Pick a shade first, then tap the picture.'); return; }
    const r = out.getBoundingClientRect();
    const x = Math.min(W - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * H)));
    const g = grow(x, y);
    if (g.n < 30) { msg('That area is too small. Try a higher tolerance.'); return; }
    S.hist.push(S.layers.slice());
    S.layers = S.layers.concat([{ mask: g.mask, avg: g.avg, rgb: rgb(S.shade.hex) }]);
    render(); msg(`${S.shade.name} applied. Too much or too little? Move the tolerance slider and tap again.`);
  });
  $('vzTol').oninput = e => { S.tol = +e.target.value; };
  $('vzUndo').onclick = () => { if (S.hist.length) { S.layers = S.hist.pop(); render(); } };
  $('vzReset').onclick = () => { S.layers = []; S.hist = []; render(); };
  $('vzCmp').oninput = e => { orig.style.clipPath = `inset(0 ${100 - e.target.value}% 0 0)`; };
  $('vzLight').onclick = e => { S.light = S.light === 'day' ? 'eve' : 'day'; e.target.textContent = S.light === 'day' ? 'Day light' : 'Evening light'; render(); };

  /* ---------- swatch tray ---------- */
  const isFav = c => favs.includes(c);
  function tray() {
    document.querySelectorAll('.vzMode').forEach(b => { const on = b.dataset.mode === S.mode; b.className = 'vzMode px-4 py-2 rounded-xl text-xs font-bold ' + (on ? 'bg-brand-gold text-brand-primary' : 'bg-brand-surfaceSoft border border-brand-border'); });
    const pool = data.shades.filter(x => x.type === S.mode);
    const fams = ['All', ...new Set(pool.map(x => x.family)), '★ Favourites'];
    $('vzFam').innerHTML = fams.map(f => { const on = (f === '★ Favourites') ? S.favOnly : (!S.favOnly && S.family === f);
      return `<button data-f="${f}" class="px-3 py-1 rounded-full text-[11px] font-semibold border ${on ? 'bg-brand-primary text-white border-brand-primary' : 'bg-white border-brand-border text-slate-700'}">${f}</button>`; }).join('');
    const q = S.q.toLowerCase();
    const list = pool.filter(x => (S.favOnly ? isFav(x.code) : (S.family === 'All' || x.family === S.family)) && (!q || (x.name + x.code + x.hex).toLowerCase().includes(q)));
    $('vzGrid').innerHTML = list.map(x => `<button data-c="${x.code}" title="${x.name}" class="text-left"><span class="block h-12 rounded-lg border ${S.shade && S.shade.code === x.code ? 'ring-2 ring-brand-gold border-brand-primary' : 'border-brand-border'}" style="background:${x.hex}"></span><span class="block text-[10px] leading-tight mt-1 text-slate-700 truncate">${x.name}</span></button>`).join('') || '<p class="col-span-full text-xs text-brand-muted">No shades found.</p>';
  }
  function selCard() {
    const s = S.shade; if (!s) return;
    const t = `Hello Ombré Paints, I would like this shade: ${s.name} (Code: ${s.code}, HEX ${s.hex}). Product: ${s.product}.`;
    $('vzSel').innerHTML = `<div class="flex items-center gap-3"><span class="w-12 h-12 rounded-xl border border-brand-border shrink-0" style="background:${s.hex}"></span><div class="min-w-0 flex-1"><p class="font-bold text-brand-dark">${s.name}</p><p class="text-xs">${s.code} · ${s.hex} · ${s.product}</p></div><button id="vzFav" class="text-xl" aria-label="Favourite">${isFav(s.code) ? '★' : '☆'}</button></div>
      <a href="https://wa.me/${WA}?text=${encodeURIComponent(t)}" target="_blank" rel="noopener" class="mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"><i class="ph ph-whatsapp-logo text-base"></i>Get this shade</a>`;
    $('vzFav').onclick = () => { favs = isFav(s.code) ? favs.filter(c => c !== s.code) : favs.concat(s.code); try { localStorage.setItem('om_fav', JSON.stringify(favs)); } catch (e) {} selCard(); tray(); };
  }
  $('vzFam').onclick = e => { const f = e.target.dataset.f; if (!f) return; S.favOnly = f === '★ Favourites'; if (!S.favOnly) S.family = f; tray(); };
  $('vzGrid').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.shade = data.shades.find(x => x.code === b.dataset.c); tray(); selCard(); };
  $('vzSearch').oninput = e => { S.q = e.target.value; tray(); };
  root.querySelectorAll('.vzMode').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; S.family = 'All'; S.favOnly = false; S.shade = null; $('vzSel').textContent = 'No shade selected.'; showRooms(); tray(); render(); });

  /* ---------- sample rooms ---------- */
  let firstLoaded = false;
  function showRooms() {
    const box = $('vzRooms'); box.innerHTML = '';
    data.rooms.filter(r => (r.type || 'paint') === S.mode).forEach(r => {
      const im = new Image(); im.src = r.src; im.alt = r.name;
      im.className = 'h-14 w-20 object-cover rounded-lg border border-brand-border cursor-pointer shrink-0';
      im.onload = () => { box.appendChild(im); if (!firstLoaded || S.mode === 'wood') { firstLoaded = true; loadImg(r.src); } };
      im.onclick = () => loadImg(r.src);
    });
  }

  /* ---------- download / share (adds a small Ombré mark) ---------- */
  function makeImage() {
    return new Promise(res => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      x.filter = out.style.filter || 'none'; x.drawImage(out, 0, 0); x.filter = 'none';
      const logo = new Image();
      const done = () => c.toBlob(b => res(b), 'image/jpeg', 0.9);
      logo.onload = () => { const w = W * 0.2, h = w * logo.naturalHeight / logo.naturalWidth; x.fillStyle = 'rgba(255,255,255,.8)'; x.fillRect(W - w - 20, H - h - 20, w + 10, h + 10); x.drawImage(logo, W - w - 15, H - h - 15, w, h); done(); };
      logo.onerror = () => { x.font = 'bold 22px serif'; x.fillStyle = 'rgba(255,255,255,.9)'; x.fillText('Ombré Paints', W - 170, H - 20); done(); };
      logo.src = 'logo.png';
    });
  }
  $('vzDl').onclick = async () => { if (!src) return; const b = await makeImage(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ombre-room.jpg'; a.click(); };
  $('vzShare').onclick = async () => {
    if (!src) return;
    const b = await makeImage(), f = new File([b], 'ombre-room.jpg', { type: 'image/jpeg' });
    const txt = S.shade ? `My room in Ombré ${S.shade.name} (${S.shade.code})` : 'My room with Ombré Paints';
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], text: txt }); } catch (e) {} }
    else { window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank'); msg('Download the picture first, then attach it in WhatsApp.'); }
  };

  tray(); showRooms();
})();
