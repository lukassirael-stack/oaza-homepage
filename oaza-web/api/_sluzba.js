// api/_sluzba.js — objednávky a dotazy ze stránek služeb (formulář /objednavka-sluzby.js)
// Podtržítko = pomocný modul, Vercel z něj funkci nedělá. Volá se přes /api/objednavka?akce=sluzba.
// Pošle e-mail Oáze (odpověď míří rovnou zákazníkovi) a — když si to zákazník zaškrtne —
// kopii se shrnutím na jeho e-mail (Brevo).

import crypto from 'node:crypto';

// Stránky služeb, ze kterých formulář přijímáme: slug → název a věta o dalším kroku.
// druh: 'poptávka' změní oslovení v e-mailech (výchozí je objednávka).
// Nová stránka služby = nový řádek tady + její pole v /objednavka-sluzby.js.
const SLUZBY = {
  'harmonizace-a-ocista-prostoru': { nazev: 'Harmonizace a očista prostoru', dalsi: 'Analýzu vám pošleme do 3 dnů e-mailem spolu s předběžnou cenou.' },
  'dalkova-harmonizace-aury':      { nazev: 'Dálková harmonizace aury', dalsi: 'Brzy se vám ozveme a domluvíme přesný den a čas harmonizace.' },
  'harmonizace-jmena-a-prijmeni':  { nazev: 'Harmonizace jména a příjmení', dalsi: 'Brzy se vám ozveme a domluvíme termín.' },
  'karma-minule-zivoty':           { nazev: 'Karma a minulé životy', dalsi: 'Brzy se vám ozveme s nabídkou termínu.' },
  'foceni-aury-a-caker':           { nazev: 'Focení aury a diagnostika čaker', dalsi: 'Brzy se vám ozveme s nabídkou termínu.' },
  'shamballa-zasveceni':           { nazev: 'Shamballa zasvěcení', dalsi: 'Brzy se vám ozveme a domluvíme termín zasvěcení.' },
  'terapie-hojnosti-a-prosperity': { nazev: 'Terapie hojnosti a prosperity', dalsi: 'Brzy se vám ozveme s nabídkou termínu.' },
  'terapie-v-oaze':                { nazev: 'Terapie v Oáze', dalsi: 'Brzy se vám ozveme s nabídkou termínu.' },
  'rodove-klice':                  { nazev: 'Rodové klíče', dalsi: 'Brzy se vám ozveme s nabídkou termínu.' },
  'kraniosakralni-terapie':        { nazev: 'Kraniosakrální terapie & Divine Healing', dalsi: 'Ozveme se vám do 24 hodin s nabídkou termínu.' },
  'lemoare-krystaly':              { nazev: 'Lemoare Krystaly', druh: 'poptávka', dalsi: 'Brzy vám pošleme aktuální nabídku a katalog.' },
  'spoluprace':                    { nazev: 'Spolupráce s Oázou', druh: 'poptávka', dalsi: 'Brzy se vám ozveme a domluvíme další postup.' },
  'portalova-zahrada':             { nazev: 'Portálová zahrada', druh: 'poptávka', dalsi: 'Brzy se vám ozveme s potvrzením termínu.' },
};

const OAZA_EMAIL = 'oaza.adamanthea@gmail.com';
const OAZA_TEL = '+420 737 869 752';
const ZNOVU = `Zkuste to prosím za chvíli znovu, nebo nám napište na ${OAZA_EMAIL} či zavolejte na ${OAZA_TEL}.`;

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// text z formuláře: bez řídicích znaků, oříznutý na délku
const cisti = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const radek = (v, max) => cisti(v, max).replace(/\s+/g, ' ');

// Ochrana proti zahlcení: stejné počitadlo pokusů jako u Vyladění a meditací (Supabase overeni_pokusy).
// Když je Supabase mimo provoz, objednávka projde — přednost má doručení.
async function prekrocenLimit(req) {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL || !KEY) return false;
  const adresa = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.headers['x-real-ip'] || '');
  const ip = adresa ? crypto.createHash('sha256').update('sluzba:' + KEY.slice(-16) + adresa).digest('hex').slice(0, 24) : null;
  const hlavicky = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/overeni_limit`, {
      method: 'POST', headers: hlavicky, signal: AbortSignal.timeout(2500),
      body: JSON.stringify({ p_druh: 'sluzba_formular', p_ip: ip, p_max_ip: 8, p_max_celkem: 60, p_okno: '1 hour' }),
    });
    if (r.ok && (await r.json()) === true) return true;
    await fetch(`${URL}/rest/v1/overeni_pokusy`, {
      method: 'POST', headers: { ...hlavicky, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(2500),
      body: JSON.stringify({ druh: 'sluzba_formular', ip }),
    });
  } catch {}
  return false;
}

export async function sluzba(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Použij POST.' });
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch { b = {}; } }

  const slug = radek(b.sluzba, 80);
  const S = Object.prototype.hasOwnProperty.call(SLUZBY, slug) ? SLUZBY[slug] : null;
  if (!S) return res.status(400).json({ error: 'Otevřete prosím formulář znovu ze stránky služby.' });

  const dotaz = b.typ === 'dotaz';
  const jmeno = radek(b.jmeno, 120);
  const email = radek(b.email, 160).toLowerCase();
  const telefon = radek(b.telefon, 40);
  if (!jmeno || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ error: 'Doplňte prosím jméno a e-mail ve tvaru jmeno@domena.cz.' });

  // pole formuláře: [[popisek, hodnota], …] — jen vyplněná, omezený počet i délka
  const pole = [];
  let celkem = 0;
  for (const p of Array.isArray(b.pole) ? b.pole.slice(0, 12) : []) {
    if (!Array.isArray(p)) continue;
    const n = radek(p[0], 80), h = cisti(p[1], 2000);
    if (!n || !h) continue;
    celkem += h.length;
    if (celkem > 6000) break;
    pole.push([n, h]);
  }

  const robot = !!b.kontrola;   // skryté pole vyplní jen automat — zprávu doručíme Oáze s označením, potvrzení ven nejde
  const kopie = b.kopie !== false; // políčko „Chci kopii do svého e-mailu"; starší verze formuláře ho neposílá → kopie odchází
  if (await prekrocenLimit(req))
    return res.status(429).json({ error: `Od vás už tu několik zpráv máme. Pro rychlou domluvu nám prosím zavolejte na ${OAZA_TEL} nebo napište na ${OAZA_EMAIL}.` });

  const API = process.env.BREVO_API_KEY;
  if (!API) { console.error('sluzba: chybí BREVO_API_KEY'); return res.status(500).json({ error: ZNOVU }); }

  // slovo pro tuto zprávu: dotaz (mužský rod) · poptávka · objednávka
  const slovo = dotaz ? 'dotaz' : (S.druh || 'objednávka');
  const druh = slovo.charAt(0).toUpperCase() + slovo.slice(1);
  const tabulka = radky => `
    <table style="width:100%;border-collapse:collapse;margin:12px 0">
      ${radky.map(r => `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #E7DCC8;vertical-align:top;color:#6b4a55;width:38%">${esc(r[0])}</td><td style="padding:8px 0;border-bottom:1px solid #E7DCC8;vertical-align:top">${r[2] || esc(r[1]).replace(/\n/g, '<br>')}</td></tr>`).join('')}
    </table>`;
  const obal = (nadpis, telo) => `
    <div style="font-family:Georgia,'Times New Roman',serif;color:#4a3942;background:#faf6ee;padding:26px">
      <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e7dcc8;border-radius:12px;padding:26px">
        <div style="text-align:center;color:#9a7628;letter-spacing:.3em;font-size:12px;text-transform:uppercase">Oáza Adamanthea</div>
        <h1 style="text-align:center;font-weight:500;font-size:24px;margin:8px 0 4px">${nadpis}</h1>
        <div style="text-align:center;color:#c9a14a;margin-bottom:14px">✦</div>
        ${telo}
        <p style="color:#6b4a55;font-size:13px;text-align:center;margin-top:22px">Oáza Adamanthea · Halenkovice 400 · ${OAZA_EMAIL} · ${OAZA_TEL}</p>
      </div>
    </div>`;

  const kontakt = [
    ['Jméno', jmeno],
    ['E-mail', email, `<a href="mailto:${esc(email)}" style="color:#9a7628">${esc(email)}</a>`],
  ];
  if (telefon) kontakt.push(['Telefon', telefon, `<a href="tel:${esc(telefon.replace(/[^\d+]/g, ''))}" style="color:#9a7628">${esc(telefon)}</a>`]);

  const teloNas = `
    <p style="margin:0 0 6px"><b>${esc(S.nazev)}</b> · ${druh.toLowerCase()} z webu</p>
    ${tabulka(kontakt.concat(pole))}
    <p style="color:#6b4a55;font-size:13px">Odpovědí na tento e-mail píšete rovnou zákazníkovi.</p>`;
  const teloZak = `
    <p>Děkujeme, ${dotaz ? 'váš' : 'vaše'} ${slovo} je u nás. ${esc(dotaz ? 'Brzy vám odpovíme.' : S.dalsi)}</p>
    <p style="margin:14px 0 0"><b>${esc(S.nazev)}</b></p>
    ${tabulka(kontakt.concat(pole))}
    <p style="color:#6b4a55;font-size:13px">Chcete něco doplnit? Stačí odpovědět na tento e-mail.</p>`;

  async function send(to, subject, html, replyTo) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': API, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Oáza Adamanthea', email: 'info@oaza-adamanthea.cz' },
        to: [{ email: to }], replyTo: { email: replyTo }, subject, htmlContent: html,
      }),
    });
    if (!r.ok) console.error('sluzba: Brevo', r.status, (await r.text().catch(() => '')).slice(0, 300));
    return r.ok;
  }

  try {
    const okNas = await send(OAZA_EMAIL, `${robot ? '[automat?] ' : ''}${druh}: ${S.nazev} · ${jmeno}`, obal(`${dotaz ? 'Nový' : 'Nová'} ${slovo}`, teloNas), email);
    if (!okNas) throw new Error('brevo');
    let potvrzeni = false;
    if (!robot && kopie) {
      try { potvrzeni = await send(email, `${dotaz ? 'Váš' : 'Vaše'} ${slovo} — ${S.nazev} · Oáza Adamanthea`, obal(`${druh} ${dotaz ? 'přijat' : 'přijata'}`, teloZak), OAZA_EMAIL); } catch {}
    }
    console.log('sluzba: odesláno', slug, slovo, potvrzeni ? 'kopie-odeslana' : (kopie ? 'kopie-neodesla' : 'bez-kopie'));
    return res.status(200).json({ ok: true, potvrzeni, dalsi: dotaz ? 'Brzy vám odpovíme.' : S.dalsi });
  } catch (e) {
    console.error('sluzba: doručení selhalo', slug, e && e.message);
    return res.status(502).json({ error: ZNOVU });
  }
}
