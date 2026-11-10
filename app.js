// 東京旅行マップ：スポットは spots.json に書いてあります
(function () {
  'use strict';

  const TYPES = {
    venue:     { label: '会場',          char: '会', color: 'var(--venue)' },
    stay:      { label: '宿',            char: '宿', color: 'var(--stay)' },
    art:       { label: '美術館・建築',  char: '美', color: 'var(--art)' },
    food:      { label: '食事',          char: '食', color: 'var(--food)' },
    station:   { label: '駅',            char: '駅', color: 'var(--station)' },
    transport: { label: '空港',          char: '空', color: 'var(--transport)' }
  };
  const DAY_LABEL = { 12: '12日(土)', 13: '13日(日)', 14: '14日(月)' };

  const state = { day: 'all', fixedOnly: false, pair: null }; // pair: null | {from} | {from,to}
  let spots = [];
  let home = null;
  const markers = {};

  // 前回の表示設定を覚えておく（使えない環境では無視）
  try {
    const saved = JSON.parse(localStorage.getItem('tripmap-view') || '{}');
    if (saved.day) state.day = saved.day;
    if (saved.fixedOnly) state.fixedOnly = true;
  } catch (e) { /* noop */ }
  function saveView() {
    try { localStorage.setItem('tripmap-view', JSON.stringify({ day: state.day, fixedOnly: state.fixedOnly })); } catch (e) { /* noop */ }
  }

  const map = L.map('map', { zoomControl: false, tap: true }).setView([35.70, 139.74], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  // ---------- 行き方リンク ----------
  const ll = s => s.lat + ',' + s.lng;
  function appleUrl(from, to) {
    let u = 'https://maps.apple.com/?daddr=' + ll(to) + '&dirflg=r';
    if (from) u += '&saddr=' + ll(from);
    return u;
  }
  function googleUrl(from, to) {
    let u = 'https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=' + ll(to);
    if (from) u += '&origin=' + ll(from);
    return u;
  }
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function popupHtml(s) {
    const t = TYPES[s.type] || TYPES.art;
    const days = (s.days || []).map(d => DAY_LABEL[d] || d).join('・');
    let h = '<p class="p-name">' + esc(s.name) + '</p>';
    h += '<div class="p-meta"><span class="p-badge ' + (s.status === 'fixed' ? 'fixed' : '') + '">' +
      (s.status === 'fixed' ? '確定' : '候補') + '</span>' + esc(t.label) +
      (days ? '　' + esc(s.status === 'fixed' ? days : days + ' に行けそう') : '') + '</div>';
    if (s.memo) h += '<p class="p-memo">' + esc(s.memo) + '</p>';
    h += '<div class="p-actions">';
    h += '<a class="btn primary" target="_blank" rel="noopener" href="' + appleUrl(null, s) + '">現在地から（Appleマップ）</a>';
    if (home && home.id !== s.id) {
      h += '<a class="btn secondary" target="_blank" rel="noopener" href="' + appleUrl(home, s) + '">宿から（Appleマップ）</a>';
    }
    h += '<a class="sub" target="_blank" rel="noopener" href="' + googleUrl(null, s) + '">Googleマップで開く（現在地から）</a>';
    if (s.url) h += '<a class="p-link" target="_blank" rel="noopener" href="' + esc(s.url) + '">公式サイト ↗</a>';
    h += '</div>';
    return h;
  }

  function iconFor(s, selected) {
    const t = TYPES[s.type] || TYPES.art;
    const cand = s.status !== 'fixed';
    return L.divIcon({
      className: 'pin' + (selected ? ' sel' : ''),
      html: '<span class="dot' + (cand ? ' cand' : '') + '" style="--c:' + t.color + '">' + t.char + '</span>',
      iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14]
    });
  }

  function visible(s) {
    if (state.fixedOnly && s.status !== 'fixed') return false;
    if (state.day !== 'all' && !(s.days || []).includes(Number(state.day))) return false;
    return true;
  }

  function isSelected(s) {
    return !!state.pair && ((state.pair.from && state.pair.from.id === s.id) || (state.pair.to && state.pair.to.id === s.id));
  }

  function render(fit) {
    const shown = [];
    spots.forEach(s => {
      const m = markers[s.id];
      m.setIcon(iconFor(s, isSelected(s)));
      m.setZIndexOffset(s.status === 'fixed' ? 1000 : 0);
      if (visible(s)) { if (!map.hasLayer(m)) m.addTo(map); shown.push(m.getLatLng()); }
      else if (map.hasLayer(m)) map.removeLayer(m);
    });
    if (fit && shown.length) map.fitBounds(L.latLngBounds(shown), { padding: [40, 40], maxZoom: 15 });
  }

  // ---------- 2地点モード ----------
  const pairPanel = document.getElementById('pairPanel');
  const pairMsg = document.getElementById('pairMsg');
  const pairActions = pairPanel.querySelector('.pairActions');
  const pairBtn = document.getElementById('pairBtn');

  function updatePair() {
    const p = state.pair;
    pairPanel.hidden = !p;
    pairBtn.classList.toggle('on', !!p);
    if (!p) return;
    if (!p.from) { pairMsg.textContent = '出発地のピンを押してください'; pairActions.hidden = true; }
    else if (!p.to) { pairMsg.textContent = '出発：' + p.from.name + '\n目的地のピンを押してください'; pairActions.hidden = true; }
    else {
      pairMsg.textContent = p.from.name + ' → ' + p.to.name;
      document.getElementById('pairApple').href = appleUrl(p.from, p.to);
      document.getElementById('pairGoogle').href = googleUrl(p.from, p.to);
      pairActions.hidden = false;
    }
    pairMsg.style.whiteSpace = 'pre-line';
    render(false);
  }
  pairBtn.addEventListener('click', () => {
    state.pair = state.pair ? null : {};
    map.closePopup();
    document.getElementById('legend').hidden = true;
    updatePair();
  });
  document.getElementById('pairClose').addEventListener('click', () => { state.pair = null; updatePair(); });

  function onMarker(s, m) {
    if (state.pair) {
      if (!state.pair.from || state.pair.to) state.pair = { from: s };
      else if (state.pair.from.id !== s.id) state.pair.to = s;
      updatePair();
      return;
    }
    m.openPopup();
  }

  // ---------- 上部の切り替え ----------
  const tabs = document.querySelectorAll('.tabs button');
  function syncTabs() { tabs.forEach(b => b.classList.toggle('on', b.dataset.day === String(state.day))); }
  tabs.forEach(b => b.addEventListener('click', () => {
    state.day = b.dataset.day; syncTabs(); saveView(); render(true);
  }));
  const fixedOnly = document.getElementById('fixedOnly');
  fixedOnly.addEventListener('change', () => { state.fixedOnly = fixedOnly.checked; saveView(); render(true); });

  document.getElementById('legendBtn').addEventListener('click', () => {
    const lg = document.getElementById('legend');
    lg.hidden = !lg.hidden;
    if (!lg.hidden && state.pair) { state.pair = null; updatePair(); }
  });

  // ---------- 現在地 ----------
  let meMarker = null;
  document.getElementById('locate').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('この端末では現在地を取得できません'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const p = [pos.coords.latitude, pos.coords.longitude];
      if (meMarker) meMarker.setLatLng(p);
      else meMarker = L.circleMarker(p, { radius: 8, color: '#fff', weight: 3, fillColor: '#0a84ff', fillOpacity: 1 }).addTo(map);
      map.setView(p, Math.max(map.getZoom(), 15));
    }, () => alert('現在地を取得できませんでした。設定 → プライバシー → 位置情報サービスで、Safariの許可を確認してください。'),
    { enableHighAccuracy: true, timeout: 10000 });
  });

  // ---------- データ読み込み ----------
  fetch('spots.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(data => {
      spots = data.spots;
      home = spots.find(s => s.id === data.home) || null;
      spots.forEach(s => {
        const m = L.marker([s.lat, s.lng], { icon: iconFor(s, false), title: s.name, keyboard: true });
        m.bindPopup(() => popupHtml(s), { maxWidth: 280, autoPanPaddingTopLeft: [10, 80] });
        m.off('click', m._openPopup); // 自前でクリックを処理する
        m.on('click', () => onMarker(s, m));
        markers[s.id] = m;
      });
      fixedOnly.checked = state.fixedOnly;
      syncTabs();
      document.getElementById('updated').textContent = 'データ更新日：' + data.updated;
      render(true);
    })
    .catch(() => alert('スポットのデータを読み込めませんでした。通信状況を確認して開き直してください。'));
})();
