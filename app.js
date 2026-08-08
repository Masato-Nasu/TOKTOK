const els = {
  form: document.querySelector('#searchForm'),
  input: document.querySelector('#searchInput'),
  clear: document.querySelector('#clearBtn'),
  random: document.querySelector('#randomBtn'),
  forYou: document.querySelector('#forYouBtn'),
  hero: document.querySelector('#hero'),
  status: document.querySelector('#status'),
  section: document.querySelector('#resultsSection'),
  results: document.querySelector('#results'),
  resultMode: document.querySelector('#resultMode'),
  resultTitle: document.querySelector('#resultTitle'),
  refresh: document.querySelector('#refreshBtn'),
  template: document.querySelector('#cardTemplate'),
  savedBtn: document.querySelector('#savedBtn'),
  savedCount: document.querySelector('#savedCount'),
  savedSection: document.querySelector('#savedSection'),
  savedResults: document.querySelector('#savedResults'),
  reset: document.querySelector('#resetBtn'),
  apiKeyBtn: document.querySelector('#apiKeyBtn'),
  apiKeyDialog: document.querySelector('#apiKeyDialog'),
  apiKeyForm: document.querySelector('#apiKeyForm'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  apiKeyClose: document.querySelector('#apiKeyClose'),
  apiKeyDelete: document.querySelector('#apiKeyDelete'),
  locationBtn: document.querySelector('#locationBtn'),
  locationStatus: document.querySelector('#locationStatus'),
};

const STORE = {
  profile: 'toktok.profile.v1',
  saved: 'toktok.saved.v1',
  apiKey: 'toktok.openai_key.v1',
};

let lastRequest = { mode: 'search', query: '' };
let currentDeals = [];
let currentLocation = null;
let currentLocationLabel = '';
let locationDisabledByUser = false;

function getApiKey() { return localStorage.getItem(STORE.apiKey) || ''; }
function setApiKey(value) {
  const key = String(value || '').trim();
  if (key) localStorage.setItem(STORE.apiKey, key);
  else localStorage.removeItem(STORE.apiKey);
  updateApiKeyButton();
}
function updateApiKeyButton() {
  const hasKey = Boolean(getApiKey());
  els.apiKeyBtn.textContent = hasKey ? 'API KEY ✓' : 'API KEY';
  els.apiKeyBtn.classList.toggle('configured', hasKey);
}
function openApiKeyDialog() {
  els.apiKeyInput.value = getApiKey();
  if (typeof els.apiKeyDialog.showModal === 'function') els.apiKeyDialog.showModal();
  else els.apiKeyDialog.setAttribute('open', '');
  requestAnimationFrame(() => els.apiKeyInput.focus());
}
function closeApiKeyDialog() {
  if (typeof els.apiKeyDialog.close === 'function') els.apiKeyDialog.close();
  else els.apiKeyDialog.removeAttribute('open');
}

function setLocationUI() {
  const active = Boolean(currentLocation);
  els.locationBtn.classList.toggle('active', active);
  els.locationBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  els.locationBtn.innerHTML = active
    ? '<span aria-hidden="true">◎</span> 現在地 ON'
    : '<span aria-hidden="true">◎</span> 現在地を使う';
  els.locationStatus.hidden = !active;
  if (active) {
    els.locationStatus.innerHTML = currentLocationLabel
      ? `<strong>現在地：</strong>${escapeHTML(currentLocationLabel)} 周辺を検索します <a class="osm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>`
      : '<strong>現在地：</strong>取得済み。近くのお得情報を優先します';
  }
}
function escapeHTML(value) {
  return String(value || '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
function looksLocalQuery(query) {
  return /(居酒屋|レストラン|ランチ|ディナー|カフェ|喫茶|飲食|焼肉|寿司|ラーメン|そば|うどん|バー|酒場|ホテル|旅館|温泉|映画館|美術館|博物館|イベント|美容院|美容室|スーパー|ドラッグストア|薬局|ホームセンター|近く|近所|周辺)/i.test(String(query || ''));
}
function getBrowserLocation({ silent = false } = {}) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      if (!silent) setStatus('この端末では現在地を取得できません。');
      resolve(null);
      return;
    }
    if (!silent) setStatus('現在地を取得しています…', true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentLocation = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lon: Number(pos.coords.longitude.toFixed(5)),
          accuracy: Math.round(pos.coords.accuracy || 0),
        };
        currentLocationLabel = '';
        locationDisabledByUser = false;
        setLocationUI();
        if (!silent) setStatus('現在地を使います。検索すると近辺のお得情報を優先します。');
        resolve(currentLocation);
      },
      (err) => {
        currentLocation = null;
        currentLocationLabel = '';
        setLocationUI();
        if (err?.code === 1) locationDisabledByUser = true;
        if (!silent) {
          const msg = err?.code === 1
            ? '位置情報の許可が必要です。ブラウザの位置情報を許可してください。'
            : '現在地を取得できませんでした。通常検索はそのまま使えます。';
          setStatus(msg);
        }
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
    );
  });
}
async function locationForSearch(mode, query) {
  if (mode === 'random') return null;
  if (currentLocation) return currentLocation;
  if (locationDisabledByUser) return null;
  if (mode === 'search' && looksLocalQuery(query)) return await getBrowserLocation({ silent: false });
  return null;
}
async function restoreGrantedLocation() {
  try {
    if (!navigator.permissions?.query) return;
    const p = await navigator.permissions.query({ name: 'geolocation' });
    if (p.state === 'granted') await getBrowserLocation({ silent: true });
  } catch {}
}

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function profile() { return loadJSON(STORE.profile, {}); }
function saved() { return loadJSON(STORE.saved, []); }

function normalizeTag(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s　]+/g, ' ').slice(0, 40);
}
function addProfile(tags, delta) {
  const p = profile();
  for (const raw of tags || []) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    p[tag] = Math.max(-12, Math.min(24, (p[tag] || 0) + delta));
    if (p[tag] === 0) delete p[tag];
  }
  saveJSON(STORE.profile, p);
  updateForYouButton();
}
function learnQuery(query) {
  const q = normalizeTag(query);
  if (!q) return;
  const chunks = q.split(/[、,\/・]/).map(s => s.trim()).filter(Boolean);
  addProfile([q, ...chunks], 1);
}
function topProfile(limit = 10) {
  return Object.entries(profile())
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, score]) => ({ tag, score }));
}
function updateForYouButton() { els.forYou.hidden = topProfile(1).length === 0; }

function setStatus(text, loading = false) {
  els.status.hidden = !text;
  els.status.textContent = text || '';
  els.status.classList.toggle('loading', loading);
}
function kindLabel(kind) {
  const map = {
    guaranteed: '🎁 全員もらえる',
    lottery: '🎯 抽選',
    free: '🆓 無料',
    sale: '🉐 セール',
    coupon: '🏷 クーポン',
    points: '＋ ポイント',
    event: '◎ 無料体験',
    other: '◇ お得',
  };
  return map[kind] || map.other;
}
function dealTags(deal) {
  return [...(deal.tags || []), deal.kind, deal.title].filter(Boolean).slice(0, 8);
}
function scoreFor(deal) {
  const p = profile();
  let score = Number(deal.value_score || 60);
  for (const tag of dealTags(deal)) {
    const n = normalizeTag(tag);
    if (p[n]) score += p[n] * 2;
    for (const [key, weight] of Object.entries(p)) {
      if (weight > 0 && (n.includes(key) || key.includes(n))) score += Math.min(weight, 8);
    }
  }
  return Math.max(1, Math.min(99, Math.round(score)));
}
function safeURL(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch { return null; }
}
function renderDeals(deals, mode) {
  els.results.replaceChildren();
  const list = [...deals];
  if (mode !== 'random') list.sort((a, b) => scoreFor(b) - scoreFor(a));

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '条件に合う、現在有効なお得情報を見つけられませんでした。別の言葉でもう一度どうぞ。';
    els.results.append(empty);
    return;
  }

  for (const deal of list) {
    const node = els.template.content.cloneNode(true);
    const card = node.querySelector('.deal-card');
    card.dataset.id = deal.id;
    node.querySelector('.kind-badge').textContent = kindLabel(deal.kind);
    node.querySelector('.score-badge').textContent = mode === 'random' ? 'RANDOM' : `あなた向け ${scoreFor(deal)}`;
    node.querySelector('.deal-title').textContent = deal.title;
    node.querySelector('.deal-summary').textContent = deal.summary;
    const deadline = node.querySelector('.deadline');
    deadline.textContent = deal.deadline ? `締切 ${deal.deadline}` : '期限はリンク先で確認';
    const condition = node.querySelector('.condition');
    condition.textContent = deal.condition || '条件はリンク先で確認';
    const area = node.querySelector('.area');
    if (deal.area) { area.textContent = `◎ ${deal.area}`; area.hidden = false; }

    const sourceRow = node.querySelector('.source-row');
    const sources = Array.isArray(deal.sources) ? deal.sources : [];
    for (const source of sources.slice(0, 3)) {
      const url = safeURL(source.url);
      if (!url) continue;
      const a = document.createElement('a');
      a.className = 'source-link';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = source.title ? `出典：${source.title}` : '出典を見る';
      a.addEventListener('click', () => addProfile(dealTags(deal), 1));
      sourceRow.append(a);
    }
    if (!sourceRow.children.length) {
      const span = document.createElement('span');
      span.className = 'demo-note';
      span.textContent = '出典URLなし — 利用前に公式情報を確認してください';
      sourceRow.append(span);
    }

    const saveBtn = node.querySelector('.save-btn');
    const isSaved = saved().some(x => x.id === deal.id);
    updateSaveButton(saveBtn, isSaved);
    saveBtn.addEventListener('click', () => {
      const nowSaved = !saved().some(x => x.id === deal.id);
      toggleSaved(deal, nowSaved);
      updateSaveButton(saveBtn, nowSaved);
      if (nowSaved) addProfile(dealTags(deal), 3);
      updateSaved();
      setStatus(nowSaved ? '保存しました。下の「保存一覧」から見返せます。' : '保存から外しました。');
    });
    els.results.append(node);
  }
}

function updateSaveButton(button, isSaved) {
  button.classList.toggle('active', isSaved);
  button.textContent = isSaved ? '✓ 保存済み' : '保存';
  button.setAttribute('aria-pressed', isSaved ? 'true' : 'false');
}

function toggleSaved(deal, shouldSave) {
  const list = saved();
  const idx = list.findIndex(x => x.id === deal.id);
  if (shouldSave && idx < 0) list.unshift({ ...deal, saved_at: Date.now() });
  if (!shouldSave && idx >= 0) list.splice(idx, 1);
  saveJSON(STORE.saved, list.slice(0, 100));
}

function updateSaved() {
  const list = saved();
  els.savedCount.textContent = list.length;
  if (!els.savedSection.hidden) renderSaved(list);
}
function renderSaved(list) {
  els.savedResults.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '保存した情報はまだありません。';
    els.savedResults.append(empty);
    return;
  }
  for (const deal of list) {
    const article = document.createElement('article');
    article.className = 'deal-card';

    const top = document.createElement('div');
    top.className = 'card-topline';
    const kind = document.createElement('span');
    kind.className = 'kind-badge';
    kind.textContent = kindLabel(deal.kind);
    const when = document.createElement('span');
    when.className = 'score-badge';
    when.textContent = deal.saved_at ? new Date(deal.saved_at).toLocaleDateString('ja-JP') : 'SAVED';
    top.append(kind, when);

    const h = document.createElement('h3');
    h.className = 'deal-title'; h.textContent = deal.title;
    const p = document.createElement('p');
    p.className = 'deal-summary'; p.textContent = deal.summary;

    const meta = document.createElement('div');
    meta.className = 'meta-row';
    const deadline = document.createElement('span');
    deadline.className = 'deadline';
    deadline.textContent = deal.deadline ? `締切 ${deal.deadline}` : '期限はリンク先で確認';
    const condition = document.createElement('span');
    condition.className = 'condition';
    condition.textContent = deal.condition || '条件はリンク先で確認';
    meta.append(deadline, condition);
    if (deal.area) {
      const area = document.createElement('span');
      area.className = 'area'; area.textContent = `◎ ${deal.area}`;
      meta.append(area);
    }

    const row = document.createElement('div'); row.className = 'source-row';
    const source = (deal.sources || []).find(s => safeURL(s.url));
    if (source) {
      const a = document.createElement('a'); a.className = 'source-link';
      a.href = safeURL(source.url); a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = source.title ? `出典：${source.title}` : '情報を見る';
      a.addEventListener('click', () => addProfile(dealTags(deal), 1));
      row.append(a);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const remove = document.createElement('button');
    remove.className = 'action-btn save-btn active'; remove.textContent = '保存から外す';
    remove.addEventListener('click', () => {
      toggleSaved(deal, false);
      updateSaved();
      document.querySelectorAll(`.deal-card[data-id="${CSS.escape(deal.id)}"] .save-btn`).forEach(btn => updateSaveButton(btn, false));
    });
    actions.append(remove);
    article.append(top, h, p, meta, row, actions);
    els.savedResults.append(article);
  }
}

async function requestDeals(mode, query = '') {
  if (mode === 'search' && !query.trim()) {
    els.input.focus();
    setStatus('探したいものを入力してください。');
    return;
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    setStatus('検索にはあなたのOpenAI APIキーが必要です。');
    openApiKeyDialog();
    return;
  }

  const location = await locationForSearch(mode, query);
  if (mode === 'search') learnQuery(query);
  const profilePayload = mode === 'random' ? [] : topProfile(10);
  lastRequest = { mode, query };
  const localText = location ? '現在地周辺で、いま使えるお得情報を確認しています…' : 'いま使えるお得情報を確認しています…';
  setStatus(mode === 'random' ? '好みや現在地に縛られず、思いがけない得を探しています…' : localText, true);
  els.random.disabled = true;
  els.locationBtn.disabled = true;
  els.form.querySelector('.primary-btn').disabled = true;

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openai-key': apiKey },
      body: JSON.stringify({ query, mode, profile: profilePayload, locale: 'ja-JP', location }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '検索に失敗しました');
    currentDeals = data.deals || [];
    if (data.locationLabel && location) {
      currentLocationLabel = data.locationLabel;
      setLocationUI();
    }
    els.section.hidden = false;
    els.hero.classList.add('has-results');
    els.resultMode.textContent = mode === 'random' ? 'RANDOM' : mode === 'foryou' ? 'FOR YOU' : location ? 'NEARBY SEARCH' : 'SEARCH';
    const areaSuffix = location && data.locationLabel ? `・${data.locationLabel}周辺` : location ? '・現在地周辺' : '';
    els.resultTitle.textContent = mode === 'random' ? '思いがけない得' : mode === 'foryou' ? `あなた向けの得${areaSuffix}` : `「${query}」の得${areaSuffix}`;
    renderDeals(currentDeals, mode);
    setStatus(`${currentDeals.length}件見つかりました。${location ? ' 現在地周辺を優先しています。' : ''}`);
    els.section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus(`検索できませんでした：${err.message}`);
  } finally {
    els.random.disabled = false;
    els.locationBtn.disabled = false;
    els.form.querySelector('.primary-btn').disabled = false;
  }
}

els.form.addEventListener('submit', e => { e.preventDefault(); requestDeals('search', els.input.value.trim()); });
els.input.addEventListener('input', () => { els.clear.hidden = !els.input.value; });
els.clear.addEventListener('click', () => { els.input.value = ''; els.clear.hidden = true; els.input.focus(); });
els.random.addEventListener('click', () => requestDeals('random', ''));
els.locationBtn.addEventListener('click', async () => {
  if (currentLocation) {
    currentLocation = null;
    currentLocationLabel = '';
    locationDisabledByUser = true;
    setLocationUI();
    setStatus('現在地検索をOFFにしました。');
    return;
  }
  locationDisabledByUser = false;
  await getBrowserLocation({ silent: false });
});
els.forYou.addEventListener('click', () => requestDeals('foryou', ''));
els.refresh.addEventListener('click', () => requestDeals(lastRequest.mode, lastRequest.query));
els.savedBtn.addEventListener('click', () => {
  els.savedSection.hidden = !els.savedSection.hidden;
  if (!els.savedSection.hidden) { renderSaved(saved()); els.savedSection.scrollIntoView({ behavior: 'smooth' }); }
});
els.apiKeyBtn.addEventListener('click', openApiKeyDialog);
els.apiKeyClose.addEventListener('click', closeApiKeyDialog);
els.apiKeyDialog.addEventListener('click', e => { if (e.target === els.apiKeyDialog) closeApiKeyDialog(); });
els.apiKeyForm.addEventListener('submit', e => {
  e.preventDefault();
  const key = els.apiKeyInput.value.trim();
  if (!key) { setStatus('APIキーを入力してください。'); return; }
  setApiKey(key);
  closeApiKeyDialog();
  setStatus('APIキーをこの端末に保存しました。');
});
els.apiKeyDelete.addEventListener('click', () => {
  setApiKey('');
  els.apiKeyInput.value = '';
  closeApiKeyDialog();
  setStatus('この端末からAPIキーを削除しました。');
});

els.reset.addEventListener('click', () => {
  if (!confirm('検索・閲覧・保存から学習した好みをリセットしますか？ 保存した情報は残ります。')) return;
  localStorage.removeItem(STORE.profile);
  updateForYouButton();
  setStatus('好みをリセットしました。RANDOMはもともと好みを使いません。');
});

localStorage.removeItem('toktok.feedback.v1');
updateForYouButton();
updateSaved();
updateApiKeyButton();
setLocationUI();
restoreGrantedLocation();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
