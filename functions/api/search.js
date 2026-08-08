const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['deals'],
  properties: {
    deals: {
      type: 'array',
      minItems: 0,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id','title','summary','kind','deadline','condition','area','value_score','tags','sources'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          kind: { type: 'string', enum: ['guaranteed','lottery','free','sale','coupon','points','event','other'] },
          deadline: { type: 'string' },
          condition: { type: 'string' },
          area: { type: 'string' },
          value_score: { type: 'integer', minimum: 1, maximum: 99 },
          tags: { type: 'array', maxItems: 8, items: { type: 'string' } },
          sources: {
            type: 'array', minItems: 1, maxItems: 3,
            items: {
              type: 'object', additionalProperties: false,
              required: ['title','url'],
              properties: { title: { type: 'string' }, url: { type: 'string' } }
            }
          }
        }
      }
    }
  }
};

const DEMO = [
  { id:'demo-free-app', title:'有料アプリ・ソフトの期間限定無料', summary:'通常は有料のアプリやソフトが無料配布される情報の表示例です。実運用では現在有効な公式情報を検索します。', kind:'free', deadline:'デモ', condition:'公式ページで条件確認', area:'', value_score:82, tags:['アプリ','ソフトウェア','無料'], sources:[{title:'デモ表示',url:'https://example.com/'}] },
  { id:'demo-present', title:'新商品プレゼントキャンペーン', summary:'抽選や全員プレゼントの情報も対象です。当選人数・応募条件・締切を分けて表示します。', kind:'lottery', deadline:'デモ', condition:'応募条件あり', area:'', value_score:68, tags:['プレゼント','新商品','懸賞'], sources:[{title:'デモ表示',url:'https://example.com/'}] },
  { id:'demo-event', title:'無料イベント・体験', summary:'商品だけでなく、無料公開・無料招待・体験イベントなどの「得」も同じ検索対象にします。', kind:'event', deadline:'デモ', condition:'地域・日時条件あり', area:'', value_score:72, tags:['イベント','体験','無料'], sources:[{title:'デモ表示',url:'https://example.com/'}] },
  { id:'demo-sale', title:'期間限定の大幅値下げ', summary:'値引率だけではなく、通常価格・期間・登録条件などを確認して候補にします。', kind:'sale', deadline:'デモ', condition:'在庫・価格変動あり', area:'', value_score:74, tags:['セール','買い物'], sources:[{title:'デモ表示',url:'https://example.com/'}] }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function cleanProfile(profile) {
  if (!Array.isArray(profile)) return [];
  return profile.slice(0,10).map(x => ({ tag: String(x?.tag || '').slice(0,40), score: Number(x?.score || 0) })).filter(x => x.tag && x.score > 0);
}
function extractOutputText(data) {
  for (const item of data?.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) if (content.type === 'output_text' && content.text) return content.text;
  }
  return data?.output_text || '';
}
function citationURLs(data) {
  const map = new Map();
  for (const item of data?.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      for (const a of content.annotations || []) {
        if (a.type === 'url_citation' && a.url) map.set(a.url, a.title || a.url);
      }
    }
  }
  return map;
}
function retrievedURLs(data) {
  const map = new Map();
  for (const item of data?.output || []) {
    if (item.type !== 'web_search_call') continue;
    for (const s of item?.action?.sources || []) {
      const url = s?.url || s?.link;
      if (url) map.set(url, s?.title || s?.name || url);
    }
  }
  return map;
}
function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; }
}

function cleanLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon, accuracy: Math.max(0, Math.min(50000, Number(value.accuracy) || 0)) };
}

async function reverseGeocode(location) {
  if (!location) return null;
  const lat = Math.round(location.lat * 1000) / 1000;
  const lon = Math.round(location.lon * 1000) / 1000;
  const cacheURL = new URL(`https://toktok-location-cache.invalid/reverse?lat=${lat}&lon=${lon}`);
  let cache;
  try { cache = caches.default; } catch { cache = null; }
  if (cache) {
    const cached = await cache.match(new Request(cacheURL.toString()));
    if (cached) return await cached.json();
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('zoom', '16');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'ja');
  try {
    const r = await fetch(url.toString(), {
      headers: {
        'accept': 'application/json',
        'user-agent': 'TOKTOK/0.1.3 (location-aware deal discovery PWA)'
      }
    });
    if (!r.ok) return null;
    const data = await r.json();
    const a = data?.address || {};
    const country = String(a.country_code || 'jp').toUpperCase().slice(0,2);
    const region = String(a.state || a.province || '').slice(0,80);
    const city = String(a.city || a.ward || a.town || a.village || a.municipality || a.county || '').slice(0,80);
    const local = String(a.neighbourhood || a.suburb || a.quarter || a.city_district || '').slice(0,80);
    const parts = [];
    for (const x of [region, city, local]) if (x && !parts.includes(x)) parts.push(x);
    const result = {
      country,
      region,
      city,
      local,
      label: parts.join(' ').trim() || String(data?.display_name || '').split(',').slice(0,3).join(' ').trim(),
      timezone: country === 'JP' ? 'Asia/Tokyo' : ''
    };
    if (cache) {
      const response = new Response(JSON.stringify(result), { headers: { 'content-type':'application/json', 'cache-control':'public, max-age=86400' } });
      await cache.put(new Request(cacheURL.toString()), response);
    }
    return result;
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'JSONが不正です' }, 400); }
  const query = String(body.query || '').trim().slice(0,80);
  const mode = ['search','random','foryou'].includes(body.mode) ? body.mode : 'search';
  const pref = cleanProfile(body.profile);
  const rawLocation = mode === 'random' ? null : cleanLocation(body.location);
  const geo = rawLocation ? await reverseGeocode(rawLocation) : null;
  if (mode === 'search' && !query) return json({ error: '検索語がありません' }, 400);

  const apiKey = String(context.request.headers.get('x-openai-key') || '').trim();
  if (!apiKey) return json({ error: 'OpenAI APIキーが設定されていません', code: 'API_KEY_REQUIRED' }, 401);
  if (apiKey.length < 20 || !apiKey.startsWith('sk-')) return json({ error: 'OpenAI APIキーの形式を確認してください', code: 'API_KEY_INVALID' }, 401);

  const profileText = pref.length ? pref.map(x => `${x.tag}(${x.score})`).join('、') : 'なし';
  const locationText = geo?.label ? `現在地の目安は「${geo.label}」。` : rawLocation ? `現在地座標の目安は緯度${rawLocation.lat.toFixed(3)}、経度${rawLocation.lon.toFixed(3)}。この周辺を優先する。` : '';
  const userGoal = mode === 'random'
    ? 'RANDOM。ユーザーの趣向・検索履歴・現在地を一切使わず、ジャンルが互いにできるだけ離れた「思いがけない得」を探す。'
    : mode === 'foryou'
      ? `FOR YOU。好みの傾向「${profileText}」に合うものを優先する。${locationText}`
      : `検索語「${query}」に直接関係するものを探す。好み「${profileText}」は同程度の候補の順位づけにだけ使い、検索語を勝手に別ジャンルへ置き換えない。${locationText}`;

  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' });
  const prompt = `あなたは日本向けのお得情報検索エージェント「トックトック」です。\n本日(JST): ${today}\n${userGoal}\n\nウェブ検索を必ず使い、今この時点で利用できる可能性が高い情報だけを最大8件返してください。対象: プレゼント、全員プレゼント、抽選、無料配布、無料公開、クーポン、大幅セール、ポイント還元、無料イベント、無料体験。\n\n厳守:\n- 期限切れは除外。期限不明は deadline を「要確認」とする。\n- 可能な限り公式サイト・主催者・一次情報を優先。まとめサイトだけの情報は避ける。\n- 「最大◯%OFF」だけで実態不明、定価つり上げ、会員費や自動課金で実質得でないものは除外。\n- 抽選と全員もらえるを混同しない。\n- source.url は実際に検索で確認したURLだけを書く。架空URL禁止。\n- summaryは70字程度、conditionは登録/SNS投稿/購入条件/送料/自動課金など重要条件を短く。\n- value_scoreは金額だけでなく、確実性・条件の軽さ・希少性を含む1〜99。\n- 日本から利用できるものを基本とする。\n- 同じキャンペーンの重複は禁止。\n- area は店舗・会場・地域がある場合に短く書き、オンライン情報なら空文字。\n- 現在地が与えられている検索で、検索語が居酒屋・飲食店・店・施設など地域依存なら、現在地の近辺（目安3km以内。難しければ同じ町・区）を最優先する。店名だけでなく、クーポン、ハッピーアワー、曜日特典、予約特典、飲み放題割引など「実際に得になる条件」を探す。\n- 地域依存検索では、公式サイトに加え、ホットペッパーグルメ・ぐるなび等の信頼できる予約/クーポンページも候補として利用してよい。`;

  const payload = {
    model: 'gpt-5.6-luna',
    reasoning: { effort: 'low' },
    tools: [{ type: 'web_search', search_context_size: 'medium', user_location: { type:'approximate', country: geo?.country || 'JP', ...(geo?.city ? { city: geo.city } : {}), ...(geo?.region ? { region: geo.region } : {}), ...(geo?.timezone ? { timezone: geo.timezone } : { timezone:'Asia/Tokyo' }) } }],
    tool_choice: 'auto',
    include: ['web_search_call.action.sources'],
    input: prompt,
    text: { format: { type:'json_schema', name:'toktok_deals', strict:true, schema: SCHEMA } },
    max_output_tokens: 3500,
    store: false
  };

  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type':'application/json', 'authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok) return json({ error: data?.error?.message || 'OpenAI APIでエラーが発生しました' }, r.status);

  const text = extractOutputText(data);
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return json({ error: '検索結果の整形に失敗しました', detail: text.slice(0,500) }, 502); }

  const citations = citationURLs(data);
  const retrieved = retrievedURLs(data);
  const grounded = new Map([...retrieved, ...citations]);
  const cited = [...grounded.entries()].map(([url,title]) => ({ url, title }));
  const deals = (parsed.deals || []).map((deal, i) => {
    const valid = (deal.sources || []).filter(s => grounded.has(s.url));
    let sources = valid;
    if (!sources.length && cited.length) {
      const wantedHosts = new Set((deal.sources || []).map(s => hostname(s.url)).filter(Boolean));
      sources = cited.filter(s => wantedHosts.has(hostname(s.url))).slice(0,2);
      if (!sources.length) sources = cited.slice(0, Math.min(2, cited.length));
    }
    return { ...deal, id: deal.id || `deal-${Date.now()}-${i}`, sources };
  });

  return json({ deals, locationLabel: geo?.label || '' });
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);
  return onRequestPost(context);
}
