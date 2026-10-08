// api/zahrada.js — odolný zápis rezervací Pobytu ve světle + jeho obsazenost
//
// Portálová zahrada tu od 10/2026 rezervace nemá: návštěva se domlouvá poptávkou
// přes společný formulář (/objednavka-sluzby.js → /api/objednavka?akce=sluzba, Brevo).
// Zavřené dny, zápis rezervací zahrady do Airtable ani správa se už nepoužívají;
// adresa /api/zahrada zůstává, protože ji volá stránka Pobytu ve světle.
//
// Environment Variables v projektu oaza-web:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY – sdílené přes _lib.js
//
// Operace:
//   GET ?ranges=pobyt                    → veřejné: obsazené termíny chatky (z cache v Supabase)
//   GET                                  → { closed: [] } (jen pro starší otevřené stránky zahrady)
//   POST {action:'pobyt', fields}        → veřejné: pobytová rezervace (proxy → fallback Supabase buffer)

const { supaRest } = require('./_lib');

// ── Pobyt ve světle ───────────────────────────────────────────────
// Tento endpoint hostí odolný zápis POBYTOVÝCH rezervací (action:'pobyt'),
// aby se projekt vešel do limitu 12 Vercel funkcí na Hobby plánu (jinak by
// samostatný api/pobyt-rezervace.js byl 13. funkce a deploy by spadl).
// Pobyt rezervaci jen přepošleme do její proxy; když je proxy/Airtable na
// limitu, odložíme ji do Supabase bufferu a po obnově přehrajeme. VS dělá
// stránka a posílá ho ve fields, takže odložená rezervace nese stejný VS.
const POBYT_PROXY = 'https://rezervace-proxy.vercel.app/api/airtable';
const POBYT_BUF   = 'rezervace_pobyt_buffer';
// Faktura na přání hosta: web zapíše VS do Supabase fronty (faktury_fronta)
// a hned spustí vystavení. Cron faktury-pobyt se Airtable ptá jen tehdy,
// když ve frontě něco čeká — spotřeba API volání tak odpovídá počtu faktur.
function chceFakturu(pf) {
  return /^\s*ano/i.test(String((pf && pf.faktura) || ''));
}
async function zaradFakturu(pf) {
  await supaRest('faktury_fronta', {
    method: 'POST', prefer: 'return=minimal',
    body: [{ vs: String(pf.variabilni_symbol || ''), email: String(pf.email || '') }],
  });
}
async function vystavFakturuHned() {
  // max. 8 s, ať host nečeká; co nestihne, dožene cron do 10 minut
  await Promise.race([
    supaRest('rpc/vystav_faktury_pobyt', { method: 'POST', body: {} }),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
}
// Obsazenost chatky se z Airtable obnovuje pravidelně jen 4× denně (šetří měsíční
// limit volání). Po rezervaci z webu ji proto obnovíme hned, ať je termín obsazený
// do pár minut i v kalendáři pro Airbnb a e-chalupy. Stojí to 1 volání na rezervaci.
async function obnovObsazenostHned() {
  // max. 6 s, ať host nečeká; kdyby to nestihla, dožene to pravidelná obnova
  await Promise.race([
    supaRest('rpc/refresh_booked_ranges', { method: 'POST', body: {} }),
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]);
}
function pobytOverlaps(aIn, aOut, bIn, bOut) {
  if (!aIn || !aOut || !bIn || !bOut) return false;
  return aIn < bOut && bIn < aOut; // [in, out) překryv
}

module.exports = async function handler(req, res) {
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
    if (req.method === 'GET') {
      // Pobyt – dostupnost (obsazené termíny) z cron-cache booked_ranges_v3,
      // ať funguje i když je Airtable/proxy na limitu. Tvar {start,end}→{from,to}.
      if (req.query && req.query.ranges === 'pobyt') {
        try {
          const rows = await supaRest('airtable_cache?cache_key=eq.booked_ranges_v3&select=payload&limit=1');
          const arr = (rows && rows[0] && Array.isArray(rows[0].payload)) ? rows[0].payload : [];
          const ranges = arr
            .map((r) => ({ from: r.from || r.start, to: r.to || r.end }))
            .filter((r) => r.from && r.to);
          res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
          return res.status(200).json({ ranges });
        } catch (e) {
          return res.status(200).json({ ranges: [] }); // ať stránka nespadne (použije localStorage)
        }
      }
      // starší otevřená stránka zahrady se ptá na zavřené dny → prázdný seznam
      return res.status(200).json({ closed: [] });
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
          try { await obnovObsazenostHned(); } catch (e) {} // nový termín hned do obsazenosti
          if (chceFakturu(pf)) {
            try { await zaradFakturu(pf); await vystavFakturuHned(); } catch (e) {}
          }
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
          // faktura počká ve frontě, cron ji vystaví po přehrání rezervace do Airtable
          if (chceFakturu(pf)) { try { await zaradFakturu(pf); } catch (e) {} }
          return res.status(200).json({ ok: true, buffered: true });
        } catch (bufErr) {
          return res.status(502).json({ error: 'Rezervaci se nepodařilo uložit', detail: String((bufErr && bufErr.message) || bufErr) });
        }
      }

      // starší otevřená stránka zahrady (rezervace přes Airtable) → ať si ji člověk obnoví
      if (action === 'reservation') {
        return res.status(410).json({ error: 'Formulář se změnil. Obnovte prosím stránku a odešlete poptávku znovu.' });
      }

      return res.status(400).json({ error: 'Neznámá akce' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Metoda nepovolena' });
  } catch (e) {
    return res.status(500).json({ error: 'Serverová chyba', detail: String((e && e.message) || e) });
  }
};
