// api/zdravi.js — Health check endpoint pro Oázu
// Volá Supabase RPC public.app_health() server-side se service keyem.
// Chráněno heslem (env ZDRAVI_HESLO). Anon klíč se nikam nedostane.

export default async function handler(req, res) {
  // Heslo se posílá v hlavičce, aby se neobjevilo v URL/logách
  const heslo = req.headers['x-heslo'] || (req.query && req.query.heslo) || '';
  const spravne = process.env.ZDRAVI_HESLO;

  if (!spravne) {
    return res.status(500).json({ error: 'ZDRAVI_HESLO není nastaveno na Vercelu.' });
  }
  if (heslo !== spravne) {
    return res.status(401).json({ error: 'Neplatné heslo.' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Chybí SUPABASE_URL nebo SUPABASE_SERVICE_KEY.' });
  }

  try {
    const r = await fetch(`${url}/rest/v1/rpc/app_health`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: 'Supabase RPC selhalo', detail: txt.slice(0, 300) });
    }

    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Výjimka při volání Supabase', detail: String(e).slice(0, 300) });
  }
}
