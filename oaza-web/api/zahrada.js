// api/zahrada.js — bezpečný endpoint pro Portálovou zahradu
// Token a admin heslo žijí POUZE zde (Vercel env), nikdy v prohlížeči.
//
// Potřebné Environment Variables v projektu oaza-web:
//   ZAHRADA_AIRTABLE_TOKEN  – nový Airtable PAT s přístupem k bázi appRwBZ3wWbId3bTM
//   ZAHRADA_ADMIN_HESLO     – heslo pro Správu (zavírání/otevírání dnů)
//
// Operace:
//   GET                                  → veřejné: seznam zavřených dnů (jen datumy, žádné PII)
//   POST {action:'reservation', fields}  → veřejné: zápis rezervace do Rezervace_zahrada
//   POST {action:'close', datum, heslo}  → admin: označí den jako zavřený
//   POST {action:'open',  id, heslo}     → admin: zruší zavřený den

const BASE      = 'appRwBZ3wWbId3bTM';
const T_REZ     = 'Rezervace_zahrada';
const T_CLOSED  = 'Zavrete_dny_zahrada';

module.exports = async function handler(req, res) {
  const TOKEN = process.env.ZAHRADA_AIRTABLE_TOKEN;
  const HESLO = process.env.ZAHRADA_ADMIN_HESLO;

  if (!TOKEN) {
    return res.status(500).json({ error: 'Server není nakonfigurován (chybí ZAHRADA_AIRTABLE_TOKEN).' });
  }

  const at = (path, opts = {}) =>
    fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });

  try {
    // ── VEŘEJNÉ: načtení zavřených dnů ──────────────────────
    if (req.method === 'GET') {
      const r = await at(`${encodeURIComponent(T_CLOSED)}?fields%5B%5D=datum&pageSize=100`);
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ error: 'Airtable GET selhal', detail: data });
      const closed = (data.records || [])
        .filter((x) => x.fields && x.fields.datum)
        .map((x) => ({ id: x.id, datum: x.fields.datum }));
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ closed });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const action = body.action;

      // ── VEŘEJNÉ: zápis rezervace ──────────────────────────
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

      // ── ADMIN (na heslo): zavřít / otevřít den ────────────
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
          return res.status(200).json({ ok: true, id: j.id });
        } else {
          if (!body.id) return res.status(400).json({ error: 'Chybí id' });
          const r = await at(`${encodeURIComponent(T_CLOSED)}/${body.id}`, { method: 'DELETE' });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            return res.status(502).json({ error: 'Otevření dne selhalo', detail: j });
          }
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
}
