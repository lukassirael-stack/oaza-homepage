// api/produkt-render.js — HTML verze detailu produktu pro vyhledávací a sociální boty.
// Lidé dostávají interaktivní produkt.html; boti přes rewrite ve vercel.json dostanou
// tuto stránku se stejným obsahem (název, fotky, cena, popis) + JSON-LD Product.
// GET /api/produkt-render?slug=X

const WEB = 'https://oaza-adamanthea.cz';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export default async function handler(req, res) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL || !KEY) return res.status(500).send('Chybí SUPABASE_URL / SUPABASE_SERVICE_KEY.');

  async function rest(path) {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error('GET ' + r.status);
    return r.json();
  }

  const slug = req.query && req.query.slug;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  try {
    if (!slug) throw { kod: 404 };
    const rows = await rest(`produkty?slug=eq.${encodeURIComponent(slug)}&stav=neq.skryto&limit=1`);
    if (!rows.length) throw { kod: 404 };
    const p = rows[0];

    const rezervovano = !!(p.rezervovano_do && new Date(p.rezervovano_do) > new Date());
    const dostupny = p.stav === 'skladem' && !rezervovano;
    const url = `${WEB}/produkt/${encodeURIComponent(p.slug)}`;
    const fotky = p.fotky || [];
    const popisCisty = String(p.popis || '').replace(/\s+/g, ' ').trim();
    const desc = (popisCisty || `Ručně vybraný kus z Bali Shopu Oázy Adamanthea — ${p.nazev}.`).slice(0, 158);

    // mapa kategorií slug → název
    let katNazev = p.kategorie || '';
    try {
      const kat = await rest(`kategorie?slug=eq.${encodeURIComponent(p.kategorie || '')}&select=nazev&limit=1`);
      if (kat.length) katNazev = kat[0].nazev;
    } catch {}

    const ld = {
      '@context': 'https://schema.org', '@type': 'Product',
      name: p.nazev, image: fotky, description: desc,
      sku: String(p.id || p.slug), url,
      offers: {
        '@type': 'Offer', url, priceCurrency: 'CZK', price: String(p.cena || 0),
        availability: dostupny ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: 'Oáza Adamanthea', url: WEB }
      }
    };

    const vlastnosti = [];
    if ((p.barva || []).length) vlastnosti.push(`<p><b>Barva:</b> ${esc(p.barva.join(', '))}</p>`);
    if ((p.velikost || []).length) vlastnosti.push(`<p><b>Velikost:</b> ${esc(p.velikost.join(', '))}</p>`);
    const ucel = (p.vlastnosti && p.vlastnosti.ucel) || [];
    if (ucel.length) vlastnosti.push(`<p><b>Zaměření:</b> ${esc(ucel.join(', '))}</p>`);

    const odstavce = String(p.popis || '').split(/\n+/).map(o => o.trim()).filter(Boolean)
      .map(o => `<p>${esc(o)}</p>`).join('\n');

    const html = `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(p.nazev)} — Bali Shop | Oáza Adamanthea</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(p.nazev)} — Oáza Adamanthea">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Oáza Adamanthea">
<meta property="og:locale" content="cs_CZ">
<meta property="og:url" content="${esc(url)}">
${fotky[0] ? `<meta property="og:image" content="${esc(fotky[0])}">` : ''}
<meta property="product:price:amount" content="${esc(p.cena || 0)}">
<meta property="product:price:currency" content="CZK">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>body{font-family:Georgia,serif;max-width:760px;margin:0 auto;padding:24px;color:#1B2A41;background:#F6F1E7;line-height:1.6}img{max-width:100%;height:auto;border-radius:12px}a{color:#B8924A}</style>
</head>
<body>
<p><a href="${WEB}/bali-shop">← Bali Shop</a> · <a href="${WEB}/">Oáza Adamanthea</a></p>
<article>
  <p>${esc(katNazev)}</p>
  <h1>${esc(p.nazev)}</h1>
  <p><strong>${Number(p.cena || 0).toLocaleString('cs-CZ')} Kč</strong> · ${dostupny ? 'Skladem — jediný kus' : (rezervovano ? 'Momentálně rezervováno' : 'Prodáno')}</p>
  ${fotky[0] ? `<img src="${esc(fotky[0])}" alt="${esc(p.nazev)}">` : ''}
  ${odstavce}
  ${vlastnosti.join('\n')}
  ${fotky.slice(1).map((f, i) => `<img src="${esc(f)}" alt="${esc(p.nazev)} — foto ${i + 2}" loading="lazy">`).join('\n')}
  <p><a href="${esc(url)}">Zobrazit produkt v Bali Shopu</a> · <a href="${WEB}/kontakt">Kontakt</a></p>
</article>
<footer><p>Oáza Adamanthea — krystal &amp; retreat centrum, Halenkovice</p></footer>
</body>
</html>`;

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).send(html);
  } catch (e) {
    const kod = e && e.kod === 404 ? 404 : 500;
    return res.status(kod).send(`<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>Produkt nenalezen — Oáza Adamanthea</title></head><body><p>Produkt nenalezen. <a href="${WEB}/bali-shop">Zpět do Bali Shopu</a></p></body></html>`);
  }
}
