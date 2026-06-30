// api/zahrada.js — bezpečný endpoint pro Portálovou zahradu
// Token a admin heslo žijí POUZE zde (Vercel env), nikdy v prohlížeči.
//
// ČTENÍ zavřených dnů jde přes Supabase cache (tabulka airtable_cache,
// klíč 'closed_days_zahrada_v1'), kterou plní Supabase cron
// refresh_closed_days_zahrada() každých 6 h. GET tak NEVOLÁ Airtable
// (spotřeba nezávislá na provozu). Admin akce (zavřít/otevřít den)
// zapisují do Airtable a zároveň IHNED patchují cache, aby se změna
// projevila ostatním návštěvníkům hned (ne až po cronu).
//
// Environment Variables v projektu oaza-web:
//   ZAHRADA_AIRTABLE_TOKEN          – Airtable PAT (zápis rezervací + admin) na bázi appRwBZ3wWbId3bTM
//   ZAHRADA_ADMIN_HESLO             – heslo pro Správu (zavírání/otevírání dnů)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY – už nastavené, sdílené přes _lib.js
//
// ODOLNOST REZERVACÍ: zápis rezervace zkusí Airtable; když je nedostupné
// (typicky 429 = překročený měsíční API limit), rezervace se uloží do Supabase
// bufferu (tabulka rezervace_zahrada_buffer) a zákazníkovi to vyjde jako úspěch
// (200) — potvrzovací e-mail odejde. Po obnově Airtable se buffer při příštím
// úspěšném zápisu sám dosynchronizuje. Žádná rezervace se tak neztratí.
//
// Operace:
//   GET                                  → veřejné: seznam zavřených dnů (z cache; fallback Airtable)
//   POST {action:'reservation', fields}  → veřejné: zápis rezervace zahrady (Airtable → fallback Supabase buffer)
//   POST {action:'pobyt', fields}        → veřejné: pobytová rezervace (proxy → fallback Supabase buffer)
//   POST {action:'close', datum, heslo}  → admin: označí den jako zavřený
//   POST {action:'open',  id, heslo}     → admin: zruší zavřený den

const { supaRest } = require('./_lib');

const BASE      = 'appRwBZ3wWbId3bTM';
const T_REZ     = 'Rezervace_zahrada';
const T_CLOSED  = 'Zavrete_dny_zahrada';
const CACHE_KEY = 'closed_days_zahrada_v1';

// ── Pobyt ve světle ───────────────────────────────────────────────
// Tento endpoint hostí i odolný zápis POBYTOVÝCH rezervací (action:'pobyt'),
// aby se projekt vešel do limitu 12 Vercel funkcí na Hobby plánu (jinak by
// samostatný api/pobyt-rezervace.js byl 13. funkce a deploy by spadl).
// Pobyt rezervaci jen přepošleme do její proxy; když je proxy/Airtable na
// limitu, odložíme ji do Supabase bufferu a po obnově přehrajeme. VS dělá
// stránka a posílá ho ve fields, takže odložená rezervace nese stejný VS.
const POBYT_PROXY = 'https://rezervace-proxy.vercel.app/api/airtable';
const POBYT_BUF   = 'rezervace_pobyt_buffer';
function pobytOverlaps(aIn, aOut, bIn, bOut) {
  if (!aIn || !aOut || !bIn || !bOut) return false;
  return aIn < bOut && bIn < aOut; // [in, out) překryv
}

module.exports = async function handler(req, res) {
  const TOKEN = process.env.ZAHRADA_AIRTABLE_TOKEN;
  const HESLO = process.env.ZAHRADA_ADMIN_HESLO;

  if (!TOKEN) {
    return res.status(500).json({ error: 'Server není nakonfigurován (chybí ZAHRADA_AIRTABLE_TOKEN).' });
  }

  // --- Airtable fetch (jen pro zápisy + studený fallback čtení) ----
  const at = (path, opts = {}) =>
    fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });

  // --- Supabase cache helpers --------------------------------------
  // Vrátí pole [{id, datum}] z cache, nebo null když cache chybí/je prázdná.
  async function cacheRead() {
    const rows = await supaRest(
      `airtable_cache?cache_key=eq.${CACHE_KEY}&select=payload&limit=1`
    );
    if (rows && rows[0] && Array.isArray(rows[0].payload)) return rows[0].payload;
    return null;
  }
  // Upsert celého pole zavřených dnů do cache (stejný vzor jako eshop-admin).
  async function cacheWrite(arr) {
    await supaRest('airtable_cache?on_conflict=cache_key', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [{
        cache_key: CACHE_KEY,
        payload: arr,
        http_status: 200,
        refreshed_at: new Date().toISOString(),
      }],
    });
  }
  // Studený fallback: dočte zavřené dny přímo z Airtable.
  async function airtableClosed() {
    const r = await at(`${encodeURIComponent(T_CLOSED)}?fields%5B%5D=datum&pageSize=100`);
    const data = await r.json();
    if (!r.ok) throw new Error('Airtable GET selhal: ' + JSON.stringify(data));
    return (data.records || [])
      .filter((x) => x.fields && x.fields.datum)
      .map((x) => ({ id: x.id, datum: x.fields.datum }));
  }

  // Dosynchronizace bufferu: zapíše do Airtable rezervace, které tam dřív
  // nemohly (nedostupné Airtable / překročený limit). Volá se POUZE po
  // úspěšném zápisu (tj. když víme, že Airtable jede), takže během výpadku
  // se zbytečně nebombarduje. Best-effort, nikdy nehází.
  async function flushBuffer() {
    let rows;
    try {
      rows = await supaRest(
        'rezervace_zahrada_buffer?synced=eq.false&order=created_at.asc&limit=25&select=id,payload'
      );
    } catch (e) { return; }
    if (!rows || !rows.length) return;
    for (const row of rows) {
      let r;
      try {
        r = await at(encodeURIComponent(T_REZ), {
          method: 'POST',
          body: JSON.stringify({ fields: row.payload }),
        });
      } catch (e) { return; } // síťová chyba → zkus celé příště
      if (r.status === 429) return; // limit zase aktivní → přeruš, zkus příště
      if (!r.ok) {
        // chyba jen u TÉTO rezervace → zaznamenej a přeskoč (neblokuj frontu)
        const txt = await r.text().catch(() => '');
        await supaRest(`rezervace_zahrada_buffer?id=eq.${row.id}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: { last_error: 'HTTP ' + r.status + ' ' + txt.slice(0, 200) },
        }).catch(() => {});
        continue;
      }
      const j = await r.json();
      await supaRest(`rezervace_zahrada_buffer?id=eq.${row.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { synced: true, synced_at: new Date().toISOString(), airtable_record_id: j.id },
      }).catch(() => {});
    }
  }

  // přehraje odložené POBYTOVÉ rezervace do proxy (volá se po úspěšném zápisu)
  async function flushPobytBuffer() {
    let rows;
    try {
      rows = await supaRest(`${POBYT_BUF}?synced=eq.false&order=created_at.asc&limit=25&select=id,payload`);
    } catch (e) { return; }
    if (!rows || !rows.length) return;
    for (const row of rows) {
      let r;
      try {
        r = await fetch(POBYT_PROXY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: row.payload }),
        });
      } catch (e) { return; }
      if (r.status === 429) return;
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        await supaRest(`${POBYT_BUF}?id=eq.${row.id}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: { last_error: 'HTTP ' + r.status + ' ' + txt.slice(0, 200) },
        }).catch(() => {});
        continue;
      }
      await supaRest(`${POBYT_BUF}?id=eq.${row.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { synced: true, synced_at: new Date().toISOString() },
      }).catch(() => {});
    }
  }

  try {
    // ── VEŘEJNÉ: načtení zavřených dnů (z cache) ─────────────
    if (req.method === 'GET') {
      let closed = null;
      try {
        closed = await cacheRead();
      } catch (e) {
        closed = null; // cache nedostupná → fallback níže
      }
      // studený start / prázdná cache → dočti z Airtable a nasaď cache
      if (closed === null) {
        closed = await airtableClosed();
        cacheWrite(closed).catch(() => {}); // best-effort, neblokuje odpověď
      }
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
      return res.status(200).json({ closed });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const action = body.action;

      // ── VEŘEJNÉ: pobytová rezervace (obal proxy + buffer) ──
      if (action === 'pobyt') {
        const pf = body.fields || {};
        if (!pf.jmeno || !pf.email || !pf.datum_prijezdu || !pf.datum_odjezdu) {
          return res.status(400).json({ error: 'Chybí povinná pole rezervace.' });
        }
        // 1) přepošli do pobytové proxy (ta zapíše do Airtable jako vždy)
        let ppr = null;
        try {
          ppr = await fetch(POBYT_PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: pf }),
          });
        } catch (netErr) { ppr = null; }

        if (ppr && ppr.ok) {
          const pj = await ppr.json().catch(() => ({ ok: true }));
          try { await flushPobytBuffer(); } catch (e) {} // proxy jede → dožeň odložené
          return res.status(200).json(pj);
        }
        // 2) jiná 4xx než limit (validace) → vrať reálnou chybu proxy
        if (ppr && ppr.status >= 400 && ppr.status < 500 && ppr.status !== 429) {
          const pj = await ppr.json().catch(() => ({ error: 'Rezervace odmítnuta' }));
          return res.status(ppr.status).json(pj);
        }
        // 3) proxy/Airtable nedostupná (429/5xx/síť) → buffer, ať NEUTČE
        let pending = [];
        try { pending = await supaRest(`${POBYT_BUF}?synced=eq.false&select=payload`); } catch (e) { pending = []; }
        const clash = (pending || []).some((p) =>
          pobytOverlaps(pf.datum_prijezdu, pf.datum_odjezdu,
                        p.payload && p.payload.datum_prijezdu, p.payload && p.payload.datum_odjezdu));
        if (clash) {
          return res.status(409).json({ error: 'Tento termín byl právě rezervován. Zvolte prosím jiný.' });
        }
        try {
          await supaRest(POBYT_BUF, { method: 'POST', prefer: 'return=minimal', body: [{ payload: pf }] });
          return res.status(200).json({ ok: true, buffered: true });
        } catch (bufErr) {
          return res.status(502).json({ error: 'Rezervaci se nepodařilo uložit', detail: String((bufErr && bufErr.message) || bufErr) });
        }
      }

      // ── VEŘEJNÉ: zápis rezervace ───────────────────────────
      if (action === 'reservation') {
        const f = body.fields || {};
        if (!f.jmeno || !f.email || !f.datum || !f.cas_prijezdu) {
          return res.status(400).json({ error: 'Chybí povinná pole (jméno, email, datum, čas).' });
        }
        // 1) zkus zapsat do Airtable
        let r = null;
        try {
          r = await at(encodeURIComponent(T_REZ), {
            method: 'POST',
            body: JSON.stringify({ fields: f }),
          });
        } catch (netErr) {
          r = null; // síťová chyba → spadne do bufferu níže
        }
        if (r && r.ok) {
          const j = await r.json();
          // Airtable jede → dožeň zpožděné rezervace z bufferu (await, ať doběhne
          // v rámci požadavku; při prázdném bufferu je to jen jedno rychlé čtení)
          try { await flushBuffer(); } catch (e) {}
          return res.status(200).json({ ok: true, id: j.id });
        }
        // 2) Airtable selhal (nejčastěji 429 = překročený měsíční limit) →
        //    ulož rezervaci do Supabase bufferu, ať NEUTČE. Zákazníkovi to
        //    vyjde jako úspěch (HTTP 200) a potvrzovací e-mail odejde.
        try {
          await supaRest('rezervace_zahrada_buffer', {
            method: 'POST', prefer: 'return=minimal',
            body: [{ payload: f }],
          });
          return res.status(200).json({ ok: true, buffered: true });
        } catch (bufErr) {
          // i buffer selhal → teprve teď vrať chybu (nemáme kam uložit)
          return res.status(502).json({ error: 'Rezervaci se nepodařilo uložit', detail: String((bufErr && bufErr.message) || bufErr) });
        }
      }

      // ── ADMIN (na heslo): zavřít / otevřít den ─────────────
      if (action === 'close' || action === 'open') {
        if (!HESLO || body.heslo !== HESLO) {
          return res.status(401).json({ error: 'Neautorizováno' });
        }

        if (action === 'close') {
          if (!body.datum) return res.status(400).json({ error: 'Chybí datum' });
          const r = await at(encodeURIComponent(T_CLOSED), {
            method: 'POST',
            body: JSON.stringify({ fields: { datum: body.datum } }),
          });
          const j = await r.json();
          if (!r.ok) return res.status(502).json({ error: 'Uzavření dne selhalo', detail: j });
          // ihned propíšeme do cache, ať to ostatní vidí hned (jinak až po cronu)
          try {
            const cur = (await cacheRead()) || [];
            if (!cur.some((x) => x.id === j.id)) cur.push({ id: j.id, datum: body.datum });
            await cacheWrite(cur);
          } catch (e) { /* cron dorovná do 6 h */ }
          return res.status(200).json({ ok: true, id: j.id });
        } else {
          if (!body.id) return res.status(400).json({ error: 'Chybí id' });
          const r = await at(`${encodeURIComponent(T_CLOSED)}/${body.id}`, { method: 'DELETE' });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            return res.status(502).json({ error: 'Otevření dne selhalo', detail: j });
          }
          // odebereme z cache
          try {
            const cur = (await cacheRead()) || [];
            await cacheWrite(cur.filter((x) => x.id !== body.id));
          } catch (e) { /* cron dorovná do 6 h */ }
          return res.status(200).json({ ok: true });
        }
      }

      return res.status(400).json({ error: 'Neznámá akce' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Metoda nepovolena' });
  } catch (e) {
    return res.status(500).json({ error: 'Serverová chyba', detail: String((e && e.message) || e) });
  }
};
