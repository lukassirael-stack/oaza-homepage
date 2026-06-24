// api/eshop-admin.js — backend administrace e-shopu Oázy
// Vše chráněno heslem (env ESHOP_HESLO). Service key zůstává na serveru.
// Akce: produkty, kategorie, nastaveni, upload, objednávky (+ faktura PDF e-mailem při zaplacení)

import { vytvorFakturaPDF } from '../lib/faktura.js';

const BUCKET = 'eshop';
const DODAVATEL = {
  jmeno: 'Lukáš Hudeček',
  adresa: 'Halenkovice 400',
  psc_mesto: '763 63 Halenkovice',
  ico: '76564410',
  dph: 'Neplátce DPH',
};

// Odeslání faktury zákazníkovi přes Brevo (PDF v příloze). Best-effort.
async function posliFakturuEmail(o, fc, pdfB64) {
  const API = process.env.BREVO_API_KEY;
  if (!API || !o.email) return false;
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const symb = o.mena === 'EUR' ? '€' : 'Kč';
  const total = `${Number(o.cena_celkem || 0).toLocaleString('cs-CZ')} ${symb}`;
  const dalsi = o.doprava === 'digital'
    ? 'Digitální obsah ti pošleme e-mailem.'
    : (o.doprava === 'mezi_nami'
        ? 'Jakmile vytvoříš zásilku v aplikaci Zásilkovna, pošli nám podací kód (pokud jsi tak ještě neučinil).'
        : 'Objednávku co nejdříve odešleme.');
  const html = `
    <div style="font-family:Georgia,serif;color:#1B2A41;background:#F6F1E7;padding:26px">
      <div style="max-width:560px;margin:0 auto;background:#FBF8F1;border:1px solid #E2D6BC;border-radius:12px;padding:26px">
        <div style="text-align:center;color:#B8924A;letter-spacing:.3em;font-size:12px;text-transform:uppercase">Oáza Adamanthea</div>
        <h1 style="text-align:center;font-weight:500;font-size:23px;margin:8px 0 4px">Platba přijata, děkujeme!</h1>
        <div style="text-align:center;color:#B8924A;margin-bottom:14px">✦</div>
        <p>Tvá platba za objednávku <b>#${o.cislo}</b> (${total}) dorazila. V příloze najdeš fakturu <b>${esc(fc)}</b>.</p>
        <p>${dalsi}</p>
        <p style="color:#7A715F;font-size:13px;margin-top:18px">Jakákoli otázka? Stačí odpovědět na tento e-mail.</p>
        <p style="color:#7A715F;font-size:13px;text-align:center;margin-top:18px">Oáza Adamanthea · oaza.adamanthea@gmail.com</p>
      </div>
    </div>`;
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': API, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Oáza Adamanthea', email: 'info@oaza-adamanthea.cz' },
      to: [{ email: o.email }],
      replyTo: { email: 'oaza.adamanthea@gmail.com' },
      subject: `Faktura ${fc} — Oáza Adamanthea`,
      htmlContent: html,
      attachment: [{ content: pdfB64, name: `faktura-${fc}.pdf` }],
    }),
  });
  return r.ok;
}

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
          cena_eur: (p.cena_eur === '' || p.cena_eur == null) ? null : parseInt(p.cena_eur, 10),
          mena: 'CZK',
          kategorie: p.kategorie ?? null,
          barva: p.barva || [],
          velikost: p.velikost || [],
          material: p.material || [],
          fotky: p.fotky || [],
          videa: p.videa || [],
          stav: p.stav || 'skladem',
          digitalni: !!p.digitalni,
          soubor: p.soubor || null,
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
          cena_eur: (p.cena_eur === '' || p.cena_eur == null) ? null : parseInt(p.cena_eur, 10),
          mena: 'CZK',
          kategorie: p.kategorie ?? null,
          barva: p.barva || [],
          velikost: p.velikost || [],
          material: p.material || [],
          fotky: p.fotky || [],
          videa: p.videa || [],
          stav: p.stav || 'skladem',
          digitalni: !!p.digitalni,
          soubor: p.soubor || null,
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

      // ---------- NASTAVENÍ (kurz EUR ap.) ----------
      case 'nastaveni-get': {
        const data = await rest('nastaveni?select=klic,hodnota');
        const obj = {}; (data || []).forEach(r => obj[r.klic] = r.hodnota);
        return res.status(200).json({ nastaveni: obj });
      }
      case 'nastaveni-save': {
        const klic = body.klic, hodnota = String(body.hodnota ?? '');
        if (!klic) return res.status(400).json({ error: 'Chybí klíč.' });
        await rest('nastaveni', {
          method: 'POST',
          prefer: 'return=minimal,resolution=merge-duplicates',
          body: JSON.stringify({ klic, hodnota }),
        });
        return res.status(200).json({ ok: true });
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

      // ---------- OBJEDNÁVKY ----------
      case 'objednavky-list': {
        const data = await rest('objednavky?select=*&order=cislo.desc');
        return res.status(200).json({ objednavky: data });
      }

      case 'objednavka-stav': {
        const { id, stav } = body;
        const platne = ['nova', 'ceka_platba', 'zaplaceno', 'odeslano', 'zruseno'];
        if (!id || !platne.includes(stav)) return res.status(400).json({ error: 'Chybí id nebo neplatný stav.' });

        const got = await rest(`objednavky?id=eq.${encodeURIComponent(id)}&select=*`);
        const obj = got && got[0];
        if (!obj) return res.status(404).json({ error: 'Objednávka nenalezena.' });

        const patch = { stav };
        if (stav === 'zaplaceno' && !obj.zaplaceno_kdy) patch.zaplaceno_kdy = new Date().toISOString();
        await rest(`objednavky?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' });

        // produkty: zaplaceno -> prodano (zmizí z obchodu); zruseno -> zpět na skladem (jen co bylo prodáno)
        const slugy = (obj.polozky || []).map(p => p && p.slug).filter(Boolean);
        if (slugy.length) {
          const inList = slugy.join(',');
          if (stav === 'zaplaceno') {
            await rest(`produkty?slug=in.(${inList})`, { method: 'PATCH', body: JSON.stringify({ stav: 'prodano' }), prefer: 'return=minimal' });
          } else if (stav === 'zruseno') {
            await rest(`produkty?slug=in.(${inList})&stav=eq.prodano`, { method: 'PATCH', body: JSON.stringify({ stav: 'skladem' }), prefer: 'return=minimal' });
          }
        }

        // faktura — jen při prvním přechodu na zaplaceno (best-effort)
        let faktura_ok = null;
        if (stav === 'zaplaceno' && !obj.faktura_cislo) {
          const rok = new Date().getFullYear();
          const fc = `${rok}-${String(obj.cislo).padStart(4, '0')}`;
          try {
            const objF = { ...obj, faktura_cislo: fc, zaplaceno_kdy: patch.zaplaceno_kdy || obj.zaplaceno_kdy };
            const pdf = await vytvorFakturaPDF(objF, DODAVATEL);
            const b64 = Buffer.from(pdf).toString('base64');
            faktura_ok = await posliFakturuEmail(objF, fc, b64);
          } catch (e) { faktura_ok = false; }
          await rest(`objednavky?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ faktura_cislo: fc }), prefer: 'return=minimal' });
        }
        return res.status(200).json({ ok: true, faktura_ok });
      }

      case 'objednavka-kod': {
        const { id } = body;
        if (!id) return res.status(400).json({ error: 'Chybí id.' });
        const got = await rest(`objednavky?id=eq.${encodeURIComponent(id)}&select=packeta_point`);
        const pp = (got && got[0] && got[0].packeta_point) || {};
        pp.kod = String(body.kod || '').trim().slice(0, 40) || null;
        await rest(`objednavky?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ packeta_point: pp }), prefer: 'return=minimal' });
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Neznámá akce: ' + action });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 400) });
  }
}
