// api/sitemap-produkty.js — sitemapa produktů Bali Shopu, generovaná živě ze Supabase.
// Dostupná na /sitemap-produkty.xml (rewrite ve vercel.json), odkázaná z robots.txt.

const WEB = 'https://oaza-adamanthea.cz';
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default async function handler(req, res) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL || !KEY) return res.status(500).send('Chybí SUPABASE_URL / SUPABASE_SERVICE_KEY.');

  try {
    const r = await fetch(
      `${URL}/rest/v1/produkty?stav=eq.skladem&select=slug,vytvoreno&order=vytvoreno.desc&limit=1000`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
    );
    if (!r.ok) throw new Error('GET ' + r.status);
    const produkty = await r.json();

    const urls = produkty.map(p => {
      const lastmod = p.vytvoreno ? `\n    <lastmod>${String(p.vytvoreno).slice(0, 10)}</lastmod>` : '';
      return `  <url>\n    <loc>${WEB}/produkt/${esc(encodeURIComponent(p.slug))}</loc>${lastmod}\n  </url>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(xml);
  } catch (e) {
    return res.status(500).send('Chyba sitemapy: ' + String(e.message || e).slice(0, 200));
  }
}
