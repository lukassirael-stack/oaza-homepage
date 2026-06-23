// api/eshop-admin.js — backend administrace e-shopu Oázy
// Vše chráněno heslem (env ESHOP_HESLO). Service key zůstává na serveru.
// Akce: list, save, delete, kategorie-list, kategorie-save, kategorie-delete, upload-url

const BUCKET = 'eshop';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Použij POST.' });
  }

  const spravne = process.env.ESHOP_HESLO;
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!spravne) return res.status(500).json({ error: 'ESHOP_HESLO není nastaveno na Vercelu.' });
  if (!URL || !KEY) return res.status(500).json({ error: 'Chybí SUPABASE_URL nebo SUPABASE_SERVICE_KEY.' });

  const heslo = req.headers['x-heslo'] || '';
  if (heslo !== spravne) return res.status(401).json({ error: 'Neplatné heslo.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { action } = body;

  // pomocník na volání PostgREST
  async function rest(path, opts = {}) {
    const r = await fetch(`${URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: opts.prefer || 'return=representation',
        ...(opts.headers || {}),
      },
    });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!r.ok) throw new Error(typeof data === 'string' ? data : (data?.message || `HTTP ${r.status}`));
    return data;
  }

  function bezpecny(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // diakritika pryč
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'polozka';
  }

  try {
    switch (action) {

      // ---------- PRODUKTY ----------
      case 'list': {
        const data = await rest('produkty?select=*&order=poradi.asc,vytvoreno.desc');
        return res.status(200).json({ produkty: data });
      }

      case 'save': {
        const p = body.produkt || {};
        const radek = {
          slug: p.slug || bezpecny(p.nazev) + '-' + Date.now().toString(36),
          nazev: p.nazev,
          popis: p.popis ?? null,
          cena: parseInt(p.cena, 10) || 0,
          mena: 'CZK',
          kategorie: p.kategorie ?? null,
          barva: p.barva || [],
          velikost: p.velikost || [],
          material: p.material || [],
          fotky: p.fotky || [],
          videa: p.videa || [],
          stav: p.stav || 'skladem',
          doporucujeme: !!p.doporucujeme,
          stitek: p.stitek || null,
          poradi: parseInt(p.poradi, 10) || 0,
          vlastnosti: p.vlastnosti || {},
        };
        let out;
        if (p.id) {
          out = await rest(`produkty?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify(radek) });
        } else {
          out = await rest('produkty', { method: 'POST', body: JSON.stringify(radek) });
        }
        return res.status(200).json({ produkt: Array.isArray(out) ? out[0] : out });
      }

      case 'delete': {
        if (!body.id) return res.status(400).json({ error: 'Chybí id.' });
        await rest(`produkty?id=eq.${body.id}`, { method: 'DELETE', prefer: 'return=minimal' });
        return res.status(200).json({ ok: true });
      }

      case 'bulk-save': {
        const vstup = Array.isArray(body.produkty) ? body.produkty : [];
        if (!vstup.length) return res.status(400).json({ error: 'Prázdný seznam.' });
        const radky = vstup.map(p => ({
          slug: p.slug || (bezpecny(p.nazev) + '-' + Math.random().toString(36).slice(2, 8)),
          nazev: p.nazev,
          popis: p.popis ?? null,
          cena: parseInt(p.cena, 10) || 0,
          mena: 'CZK',
          kategorie: p.kategorie ?? null,
          barva: p.barva || [],
          velikost: p.velikost || [],
          material: p.material || [],
          fotky: p.fotky || [],
          videa: p.videa || [],
          stav: p.stav || 'skladem',
          doporucujeme: !!p.doporucujeme,
          stitek: p.stitek || null,
          poradi: parseInt(p.poradi, 10) || 0,
          vlastnosti: p.vlastnosti || {},
        }));
        // upsert podle slug (slug má unique constraint)
        const out = await rest('produkty?on_conflict=slug', {
          method: 'POST',
          prefer: 'return=representation,resolution=merge-duplicates',
          body: JSON.stringify(radky),
        });
        return res.status(200).json({ vlozeno: Array.isArray(out) ? out.length : 0 });
      }

      // ---------- KATEGORIE ----------
      case 'kategorie-list': {
        const data = await rest('kategorie?select=*&order=poradi.asc');
        return res.status(200).json({ kategorie: data });
      }

      case 'kategorie-save': {
        const k = body.kategorie || {};
        const slug = k.slug || bezpecny(k.nazev);
        const radek = { slug, nazev: k.nazev, poradi: parseInt(k.poradi, 10) || 0 };
        // upsert podle slug (primární klíč)
        const out = await rest('kategorie', {
          method: 'POST',
          prefer: 'return=representation,resolution=merge-duplicates',
          body: JSON.stringify(radek),
        });
        return res.status(200).json({ kategorie: Array.isArray(out) ? out[0] : out });
      }

      case 'kategorie-delete': {
        if (!body.slug) return res.status(400).json({ error: 'Chybí slug.' });
        await rest(`kategorie?slug=eq.${encodeURIComponent(body.slug)}`, { method: 'DELETE', prefer: 'return=minimal' });
        return res.status(200).json({ ok: true });
      }

      // ---------- UPLOAD (signed URL) ----------
      case 'upload-url': {
        const slug = bezpecny(body.slug || 'produkt');
        const ext = bezpecny(body.ext || 'jpg').replace(/-/g, '') || 'jpg';
        const path = `${slug}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const r = await fetch(`${URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
          method: 'POST',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const j = await r.json();
        if (!r.ok || !j.url) {
          return res.status(502).json({ error: 'Nepodařilo se vytvořit upload URL', detail: JSON.stringify(j).slice(0, 200) });
        }
        return res.status(200).json({
          uploadUrl: `${URL}/storage/v1${j.url}`,
          publicUrl: `${URL}/storage/v1/object/public/${BUCKET}/${path}`,
          path,
        });
      }

      default:
        return res.status(400).json({ error: 'Neznámá akce: ' + action });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 400) });
  }
}
