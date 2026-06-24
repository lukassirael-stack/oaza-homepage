// api/objednavka.js — vytvoření objednávky v Bali Shopu
// Ceny se VŽDY přepočítávají na serveru (klientovi se nevěří).
// Platba: QR/SPAYD (bankovní převod). Stripe doplníme později.

const IBAN_CZK = 'CZ1655000000008159854004';      // Raiffeisenbank 8159854004/5500
const IBAN_EUR = 'CZ1820100000002500144501';      // Fio (EUR)
const VS_BASE  = 700000;                            // VS = 700000 + číslo objednávky

export default async function handler(req, res) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL || !KEY) return res.status(500).json({ error: 'Chybí SUPABASE_URL nebo SUPABASE_SERVICE_KEY.' });

  async function rest(path, opts = {}) {
    const r = await fetch(`${URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: KEY, Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: opts.prefer || 'return=representation',
        ...(opts.headers || {}),
      },
    });
    const txt = await r.text();
    let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!r.ok) throw new Error(typeof data === 'string' ? data : (data?.message || `HTTP ${r.status}`));
    return data;
  }

  // GET = ceny dopravy + kurz (pro pokladnu)
  if (req.method === 'GET') {
    try {
      const nast = await rest('nastaveni?select=klic,hodnota');
      const N = Object.fromEntries((nast || []).map(x => [x.klic, x.hodnota]));
      return res.status(200).json({
        kurz: parseFloat(N.kurz_eur) || 25,
        doprava: {
          box_czk: parseInt(N.doprava_box_czk, 10) || 0,
          adresa_czk: parseInt(N.doprava_adresa_czk, 10) || 0,
          box_eur: parseInt(N.doprava_box_eur, 10) || 0,
          adresa_eur: parseInt(N.doprava_adresa_eur, 10) || 0,
          zdarma_od_czk: parseInt(N.doprava_zdarma_od_czk, 10) || 0,
          zdarma_od_eur: parseInt(N.doprava_zdarma_od_eur, 10) || 0,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Použij POST.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  try {
    // --- nastavení (kurz + ceny dopravy) ---
    const nast = await rest('nastaveni?select=klic,hodnota');
    const N = Object.fromEntries((nast || []).map(x => [x.klic, x.hodnota]));
    const kurz = parseFloat(N.kurz_eur) || 25;
    const eur = (czk, override) => (override != null ? override : Math.round(czk / kurz));

    // --- měna ---
    const mena = (body.mena === 'EUR') ? 'EUR' : 'CZK';

    // --- položky: ověř proti DB (skladem) a přepočítej ceny ---
    const slugy = [...new Set((body.polozky || []).map(p => p && p.slug).filter(Boolean))];
    if (!slugy.length) return res.status(400).json({ error: 'Košík je prázdný.' });

    const inList = slugy.join(',');
    const produkty = await rest(`produkty?slug=in.(${inList})&stav=eq.skladem&select=slug,nazev,cena,cena_eur,digitalni`);
    const mapa = Object.fromEntries((produkty || []).map(p => [p.slug, p]));

    const chybi = slugy.filter(s => !mapa[s]);
    if (chybi.length) {
      return res.status(409).json({ error: 'Některé položky už nejsou skladem.', nedostupne: chybi });
    }

    const polozky = slugy.map(s => {
      const p = mapa[s];
      return {
        slug: p.slug, nazev: p.nazev,
        cena: p.cena, cena_eur: eur(p.cena, p.cena_eur),
        digitalni: !!p.digitalni,
      };
    });
    const cena_zbozi = polozky.reduce((sum, p) => sum + (mena === 'EUR' ? p.cena_eur : p.cena), 0);

    // --- doprava ---
    const vseDigital = polozky.every(p => p.digitalni);
    let doprava, doprava_cena = 0, adresa = null, packeta_point = null;
    const zeme = (body.zeme === 'SK') ? 'SK' : 'CZ';

    if (vseDigital) {
      doprava = 'digital';
    } else {
      doprava = ['mezi_nami', 'vydejni_misto', 'adresa'].includes(body.doprava) ? body.doprava : null;
      if (!doprava) return res.status(400).json({ error: 'Zvol způsob dopravy.' });

      if (doprava === 'mezi_nami') {
        // zákazník si zásilku vytvoří ve své aplikaci a pošle nám podací kód; dopravu neúčtujeme
        doprava_cena = 0;
        const kod = String(body.podaci_kod || '').trim().slice(0, 40);
        packeta_point = { typ: 'mezi_nami', kod: kod || null };
      } else {
        const klic = (doprava === 'vydejni_misto' ? 'doprava_box_' : 'doprava_adresa_') + mena.toLowerCase();
        doprava_cena = parseInt(N[klic], 10) || 0;
        const prah = parseInt(N['doprava_zdarma_od_' + mena.toLowerCase()], 10) || 0;
        if (prah > 0 && cena_zbozi >= prah) doprava_cena = 0;

        if (doprava === 'adresa') {
          const a = body.adresa || {};
          if (!a.ulice || !a.mesto || !a.psc) return res.status(400).json({ error: 'Vyplň ulici, město a PSČ.' });
          adresa = { ulice: String(a.ulice).slice(0, 120), mesto: String(a.mesto).slice(0, 80), psc: String(a.psc).slice(0, 12) };
        } else {
          const vm = String(body.vydejni_misto || '').trim().slice(0, 200);
          if (!vm) return res.status(400).json({ error: 'Napiš výdejní místo Zásilkovny.' });
          packeta_point = { typ: 'vydejni_misto', text: vm }; // po napojení Packeta API doplníme id pobočky
        }
      }
    }

    // --- zákazník ---
    const jmeno = String(body.jmeno || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().slice(0, 160);
    const telefon = String(body.telefon || '').trim().slice(0, 40);
    if (!jmeno) return res.status(400).json({ error: 'Vyplň jméno.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Vyplň platný e-mail.' });

    const cena_celkem = cena_zbozi + doprava_cena;
    const poznamka = String(body.poznamka || '').slice(0, 1000);

    // --- vlož objednávku ---
    const vlozeno = await rest('objednavky', {
      method: 'POST',
      body: JSON.stringify({
        stav: 'ceka_platba', zpusob_platby: 'qr',
        jmeno, email, telefon, zeme,
        doprava, doprava_cena, adresa, packeta_point,
        polozky, mena, cena_zbozi, cena_celkem, poznamka,
      }),
    });
    const obj = Array.isArray(vlozeno) ? vlozeno[0] : vlozeno;
    const cislo = obj.cislo;
    const vs = String(VS_BASE + Number(cislo));

    // doplň VS
    await rest(`objednavky?id=eq.${obj.id}`, { method: 'PATCH', body: JSON.stringify({ vs }) });

    // --- QR / SPAYD ---
    const iban = mena === 'EUR' ? IBAN_EUR : IBAN_CZK;
    const am = `${cena_celkem}.00`;
    const spayd = `SPD*1.0*ACC:${iban}*AM:${am}*CC:${mena}*X-VS:${vs}*MSG:OAZA OBCHOD ${cislo}`;
    const symb = mena === 'EUR' ? '€' : 'Kč';
    const ucet = mena === 'EUR'
      ? { popis: 'Fio banka (EUR)', iban: IBAN_EUR }
      : { popis: 'Raiffeisenbank', cislo: '8159854004/5500', iban: IBAN_CZK };

    // QR obrázek (generátor českých QR plateb) — funguje v prohlížeči i v e-mailu, bez JS knihovny
    const qrMsg = encodeURIComponent(`OAZA OBCHOD ${cislo}`);
    const qr_url = mena === 'EUR'
      ? `https://api.paylibo.com/paylibo/generator/czech/image?accountNumber=2500144501&bankCode=2010&amount=${cena_celkem}&currency=EUR&vs=${vs}&message=${qrMsg}&size=240&branding=false`
      : `https://api.paylibo.com/paylibo/generator/czech/image?accountNumber=8159854004&bankCode=5500&amount=${cena_celkem}&currency=CZK&vs=${vs}&message=${qrMsg}&size=240&branding=false`;

    // --- e-mail (best-effort, nesmí shodit objednávku) ---
    let email_sent = false;
    try { email_sent = await posliMaily(); } catch (e) { email_sent = false; }

    async function posliMaily() {
      const API = process.env.BREVO_API_KEY;
      if (!API) return false;
      const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const cena = v => `${Number(v).toLocaleString('cs-CZ')} ${symb}`;

      const radkyPolozek = polozky.map(p =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #E2D6BC">${esc(p.nazev)}${p.digitalni ? ' · digitální' : ''}</td>
         <td style="padding:6px 0;border-bottom:1px solid #E2D6BC;text-align:right;white-space:nowrap">${cena(mena === 'EUR' ? p.cena_eur : p.cena)}</td></tr>`).join('');

      let dopravaText;
      if (doprava === 'digital') dopravaText = 'Digitální obsah zašleme e-mailem po zaplacení.';
      else if (doprava === 'mezi_nami') dopravaText = (packeta_point && packeta_point.kod)
        ? `Zásilkovna „Mezi námi“ — podací kód: <b>${esc(packeta_point.kod)}</b>.`
        : 'Zásilkovna „Mezi námi“ — vytvoř zásilku ve své aplikaci Zásilkovna a pošli nám podací kód na oaza.adamanthea@gmail.com.';
      else if (doprava === 'vydejni_misto') dopravaText = `Zásilkovna — výdejní místo: ${esc(packeta_point && packeta_point.text || '')}.`;
      else dopravaText = `Doručení na adresu: ${esc(adresa ? `${adresa.ulice}, ${adresa.psc} ${adresa.mesto}` : '')}.`;

      const platBlok = `
        <table style="width:100%;border-collapse:collapse;margin:6px 0 0">
          ${ucet.cislo ? `<tr><td style="color:#7A715F;padding:3px 0">Účet</td><td style="text-align:right">${ucet.cislo}</td></tr>` : `<tr><td style="color:#7A715F;padding:3px 0">Banka</td><td style="text-align:right">${ucet.popis}</td></tr>`}
          <tr><td style="color:#7A715F;padding:3px 0">IBAN</td><td style="text-align:right">${ucet.iban}</td></tr>
          <tr><td style="color:#7A715F;padding:3px 0">Částka</td><td style="text-align:right"><b>${cena(cena_celkem)}</b></td></tr>
          <tr><td style="color:#7A715F;padding:3px 0">Variabilní symbol</td><td style="text-align:right"><b>${vs}</b></td></tr>
          <tr><td style="color:#7A715F;padding:3px 0">Zpráva</td><td style="text-align:right">OAZA OBCHOD ${cislo}</td></tr>
        </table>`;

      const obal = (nadpis, telo) => `
        <div style="font-family:Georgia,'Times New Roman',serif;color:#1B2A41;background:#F6F1E7;padding:26px">
          <div style="max-width:560px;margin:0 auto;background:#FBF8F1;border:1px solid #E2D6BC;border-radius:12px;padding:26px">
            <div style="text-align:center;color:#B8924A;letter-spacing:.3em;font-size:12px;text-transform:uppercase">Oáza Adamanthea</div>
            <h1 style="text-align:center;font-weight:500;font-size:24px;margin:8px 0 4px">${nadpis}</h1>
            <div style="text-align:center;color:#B8924A;margin-bottom:14px">✦</div>
            ${telo}
            <p style="color:#7A715F;font-size:13px;text-align:center;margin-top:22px">Oáza Adamanthea · oaza.adamanthea@gmail.com</p>
          </div>
        </div>`;

      // ---- zákazník ----
      const teloZak = `
        <p>Děkujeme za tvou objednávku <b>#${cislo}</b>. Níže najdeš souhrn a údaje k platbě.</p>
        <table style="width:100%;border-collapse:collapse;margin:10px 0">${radkyPolozek}
          <tr><td style="padding:8px 0">Doprava</td><td style="padding:8px 0;text-align:right">${doprava_cena ? cena(doprava_cena) : (doprava === 'mezi_nami' ? 'platíš v aplikaci' : 'zdarma')}</td></tr>
          <tr><td style="padding:8px 0;font-size:18px"><b>Celkem</b></td><td style="padding:8px 0;text-align:right;font-size:18px"><b>${cena(cena_celkem)}</b></td></tr>
        </table>
        <p style="margin:4px 0 2px"><b>Doprava:</b> ${dopravaText}</p>
        <h3 style="margin:18px 0 4px;font-weight:500">Platba převodem / QR</h3>
        <div style="text-align:center;margin:8px 0"><img src="${qr_url}" alt="QR platba" width="200" height="200" style="border:1px solid #E2D6BC;border-radius:10px;padding:8px;background:#fff"></div>
        ${platBlok}
        <p style="color:#7A715F;font-size:13px;margin-top:14px">Po přijetí platby objednávku potvrdíme${doprava === 'digital' ? ' a zašleme digitální obsah' : ''}. Jakákoli otázka? Stačí odpovědět na tento e-mail.</p>`;

      // ---- interní ----
      const teloNas = `
        <p><b>Nová objednávka #${cislo}</b> — ${esc(jmeno)} (${esc(email)}${telefon ? ', ' + esc(telefon) : ''}), ${zeme}.</p>
        <table style="width:100%;border-collapse:collapse;margin:10px 0">${radkyPolozek}
          <tr><td style="padding:8px 0">Doprava</td><td style="padding:8px 0;text-align:right">${doprava_cena ? cena(doprava_cena) : (doprava === 'mezi_nami' ? '0 (Mezi námi)' : 'zdarma')}</td></tr>
          <tr><td style="padding:8px 0"><b>Celkem</b></td><td style="padding:8px 0;text-align:right"><b>${cena(cena_celkem)}</b></td></tr>
        </table>
        <p><b>Doprava:</b> ${dopravaText}</p>
        ${poznamka ? `<p><b>Poznámka:</b> ${esc(poznamka)}</p>` : ''}
        <p style="color:#7A715F;font-size:13px">VS ${vs} · stav: čeká na platbu</p>`;

      async function send(to, subject, html, replyTo) {
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': API, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender: { name: 'Oáza Adamanthea', email: 'info@oaza-adamanthea.cz' },
            to: [{ email: to }],
            replyTo: replyTo ? { email: replyTo } : undefined,
            subject, htmlContent: html,
          }),
        });
        return r.ok;
      }

      const okZak = await send(email, `Objednávka #${cislo} — Oáza Adamanthea`, obal('Objednávka přijata', teloZak), 'oaza.adamanthea@gmail.com');
      // interní upozornění (neblokuje výsledek zákaznického mailu)
      try { await send('oaza.adamanthea@gmail.com', `Nová objednávka #${cislo} (${cena(cena_celkem)})`, obal('Nová objednávka', teloNas), email); } catch (e) {}
      return okZak;
    }

    return res.status(200).json({
      ok: true, cislo, vs, mena, cena_zbozi, doprava_cena, cena_celkem,
      doprava, vseDigital, spayd, iban, ucet, email_sent, qr_url,
      polozky,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Objednávku se nepodařilo vytvořit: ' + (e.message || e) });
  }
}
