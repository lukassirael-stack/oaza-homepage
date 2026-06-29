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
// Operace:
//   GET                                  → veřejné: seznam zavřených dnů (z cache; fallback Airtable)
//   POST {action:'reservation', fields}  → veřejné: zápis rezervace do Rezervace_zahrada
//   POST {action:'close', datum, heslo}  → admin: označí den jako zavřený
//   POST {action:'open',  id, heslo}     → admin: zruší zavřený den

const { supaRest } = require('./_lib');

const BASE      = 'appRwBZ3wWbId3bTM';
const T_REZ     = 'Rezervace_zahrada';
const T_CLOSED  = 'Zavrete_dny_zahrada';
const CACHE_KEY = 'closed_days_zahrada_v1';

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

      // ── VEŘEJNÉ: zápis rezervace ───────────────────────────
      if (action === 'reservation') {
        const f = body.fields || {};
        if (!f.jmeno || !f.email || !f.datum || !f.cas_prijezdu) {
          return res.status(400).json({ error: 'Chybí povinná pole (jméno, email, datum, čas).' });
        }
        const r = await at(encodeURIComponent(T_REZ), {
          method: 'POST',
          body: JSON.stringify({ fields: f }),
        });
        const j = await r.json();
        if (!r.ok) return res.status(502).json({ error: 'Zápis rezervace selhal', detail: j });
        return res.status(200).json({ ok: true, id: j.id });
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
