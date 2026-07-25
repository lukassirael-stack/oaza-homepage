// api/stary-produkt.js — staré wixové adresy /product-page/<slug>
//
// Wix měl produkty na /product-page/<slug>. Ty adresy jsou pořád v Googlu
// i v odkazech, které si lidé kdysi uložili. Tenhle endpoint se pokusí
// najít odpovídající produkt v novém katalogu a poslat návštěvníka rovnou
// na něj. Když si jistý není, pošle ho do výpisu obchodu — to je pořád
// lepší než 404 nebo špatný produkt.
//
// Párování řeší SQL funkce najdi_stary_produkt() (prefix nebo dost vysoká
// podobnost slugu). Ta raději nevrátí nic, než aby hádala.

export default async function handler(req, res) {
  const OBCHOD = '/bali-shop';

  const naObchod = () => {
    // 302 — kdyby produkt někdy přibyl, ať Google adresu nezahodí natrvalo
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.writeHead(302, { Location: OBCHOD });
    return res.end();
  };

  try {
    const URL_SUPA = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!URL_SUPA || !KEY) return naObchod();

    // slug může přijít jako string i jako pole (/product-page/a/b)
    let slug = (req.query && req.query.slug) || '';
    if (Array.isArray(slug)) slug = slug.join('-');
    try { slug = decodeURIComponent(slug); } catch (e) { /* ponecháme jak přišlo */ }
    slug = String(slug).trim();

    if (!slug || slug.length < 6) return naObchod();

    const r = await fetch(`${URL_SUPA}/rest/v1/rpc/najdi_stary_produkt`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!r.ok) return naObchod();

    const nalezeny = await r.json();
    if (!nalezeny || typeof nalezeny !== 'string') return naObchod();

    // 301 — stará adresa má novou trvalou podobu, ať se přenese i síla odkazů
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.writeHead(301, { Location: `/produkt/${encodeURIComponent(nalezeny)}` });
    return res.end();
  } catch (e) {
    return naObchod();
  }
}
