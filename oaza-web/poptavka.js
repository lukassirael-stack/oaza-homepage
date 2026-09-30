// Poptávka pronájmu prostor (kalkulačka na /pronajem-prostor)
// Přepočítá cenu podle ceníku a pošle e-mail Oáze + potvrzení poptávajícímu (Brevo).

const CENIK = {
  retreat: 1000,   // Shalla + meditační místnost, 24 h / os.
  den: 700,        // jednodenní akce / os.
  pulden: 400,     // půldenní akce (do 4 h) / os.
  minOsob: 7,      // minimum účastníků pro retreat
  snidane: 160, obed: 220, vecere: 220,
  pokoj: 300,      // soukromý pokoj / os. / noc
  pokojeMax: 9,
  chatka: 1700,    // Pobyt ve světle / noc
};

const int = (v, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || 0));
const kc = v => `${Number(v).toLocaleString('cs-CZ')} Kč`;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function spocitej(b) {
  const varianta = ['retreat', 'den', 'pulden'].includes(b.varianta) ? b.varianta : 'retreat';
  const osob = int(b.osob, 1, 60);
  const delka = varianta === 'pulden' ? 1 : int(b.delka, 1, 30);
  const s = int(b.snidane, 0, 60), o = int(b.obedy, 0, 60), v = int(b.vecere, 0, 60);
  const pokojeOs = varianta === 'retreat' ? int(b.pokoje, 0, Math.min(CENIK.pokojeMax, osob)) : 0;
  const chatka = varianta === 'retreat' && !!b.chatka;

  const radky = [];
  if (varianta === 'retreat') {
    const uctovano = Math.max(osob, CENIK.minOsob);
    radky.push([`Shalla + meditační místnost · ${uctovano} os. × ${delka} ${delka === 1 ? 'noc' : delka < 5 ? 'noci' : 'nocí'}`, uctovano * delka * CENIK.retreat]);
  } else if (varianta === 'den') {
    radky.push([`Jednodenní akce · ${osob} os. × ${delka} ${delka === 1 ? 'den' : delka < 5 ? 'dny' : 'dní'}`, osob * delka * CENIK.den]);
  } else {
    radky.push([`Půldenní akce · ${osob} os.`, osob * CENIK.pulden]);
  }
  const strava = (s * CENIK.snidane + o * CENIK.obed + v * CENIK.vecere) * osob;
  if (strava) radky.push([`Strava · ${s}× snídaně, ${o}× oběd, ${v}× večeře · ${osob} os.`, strava]);
  if (pokojeOs) radky.push([`Soukromé pokoje · ${pokojeOs} os. × ${delka} noc.`, pokojeOs * delka * CENIK.pokoj]);
  if (chatka) radky.push([`Chatka Pobyt ve světle · ${delka} noc.`, delka * CENIK.chatka]);
  const celkem = radky.reduce((a, r) => a + r[1], 0);
  return { varianta, osob, delka, pokojeOs, chatka, radky, celkem };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Použij POST.' });
  const b = req.body || {};
  if (b.web) return res.status(200).json({ ok: true }); // honeypot

  const jmeno = String(b.jmeno || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
  const telefon = String(b.telefon || '').trim().slice(0, 40);
  const termin1 = String(b.termin1 || '').trim().slice(0, 120);
  const termin2 = String(b.termin2 || '').trim().slice(0, 120);
  const zprava = String(b.zprava || '').trim().slice(0, 3000);
  if (!jmeno || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !termin1)
    return res.status(400).json({ error: 'Vyplňte prosím jméno, e-mail a alespoň jeden termín.' });

  const API = process.env.BREVO_API_KEY;
  if (!API) return res.status(500).json({ error: 'Odeslání se nepodařilo. Napište nám prosím na oaza.adamanthea@gmail.com.' });

  const k = spocitej(b);
  const nazevVarianty = { retreat: 'Vícedenní retreat', den: 'Jednodenní akce', pulden: 'Půldenní akce' }[k.varianta];

  const tabulka = `
    <table style="width:100%;border-collapse:collapse;margin:10px 0">
      ${k.radky.map(r => `<tr><td style="padding:7px 0;border-bottom:1px solid #E7DCC8">${esc(r[0])}</td><td style="padding:7px 0;border-bottom:1px solid #E7DCC8;text-align:right;white-space:nowrap">${kc(r[1])}</td></tr>`).join('')}
      <tr><td style="padding:10px 0;font-size:18px"><b>Orientační cena celkem</b></td><td style="padding:10px 0;text-align:right;font-size:18px"><b>${kc(k.celkem)}</b></td></tr>
    </table>`;
  const detaily = `
    <p style="margin:4px 0"><b>Typ akce:</b> ${nazevVarianty} · ${k.osob} ${k.osob === 1 ? 'osoba' : k.osob < 5 ? 'osoby' : 'osob'}</p>
    <p style="margin:4px 0"><b>Termín – 1. možnost:</b> ${esc(termin1)}</p>
    ${termin2 ? `<p style="margin:4px 0"><b>Termín – 2. možnost:</b> ${esc(termin2)}</p>` : ''}
    ${zprava ? `<p style="margin:10px 0 4px"><b>O akci:</b><br>${esc(zprava).replace(/\n/g, '<br>')}</p>` : ''}`;

  const obal = (nadpis, telo) => `
    <div style="font-family:Georgia,'Times New Roman',serif;color:#4a3942;background:#faf6ee;padding:26px">
      <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e7dcc8;border-radius:12px;padding:26px">
        <div style="text-align:center;color:#9a7628;letter-spacing:.3em;font-size:12px;text-transform:uppercase">Oáza Adamanthea</div>
        <h1 style="text-align:center;font-weight:500;font-size:24px;margin:8px 0 4px">${nadpis}</h1>
        <div style="text-align:center;color:#c9a14a;margin-bottom:14px">✦</div>
        ${telo}
        <p style="color:#6b4a55;font-size:13px;text-align:center;margin-top:22px">Oáza Adamanthea · Halenkovice 400 · oaza.adamanthea@gmail.com · +420 608 828 996</p>
      </div>
    </div>`;

  const teloZak = `
    <p>Děkujeme, ${esc(jmeno.split(' ')[0])}. Vaši poptávku jsme přijali a brzy se vám ozveme s potvrzením termínu a finální nabídkou.</p>
    ${detaily}${tabulka}
    <p style="color:#6b4a55;font-size:13px">Cena vychází z aktuálního ceníku skupinových pronájmů. Podrobnosti rádi doladíme spolu — stačí odpovědět na tento e-mail.</p>`;
  const teloNas = `
    <p><b>${esc(jmeno)}</b> · <a href="mailto:${esc(email)}">${esc(email)}</a>${telefon ? ' · ' + esc(telefon) : ''}</p>
    ${detaily}${tabulka}`;

  async function send(to, subject, html, replyTo) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': API, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Oáza Adamanthea', email: 'info@oaza-adamanthea.cz' },
        to: [{ email: to }], replyTo: { email: replyTo }, subject, htmlContent: html,
      }),
    });
    return r.ok;
  }

  try {
    const okNas = await send('oaza.adamanthea@gmail.com', `Poptávka pronájmu: ${jmeno} · ${termin1} · ${kc(k.celkem)}`, obal('Nová poptávka pronájmu', teloNas), email);
    if (!okNas) throw new Error('brevo');
    try { await send(email, 'Vaše poptávka pronájmu — Oáza Adamanthea', obal('Poptávka přijata', teloZak), 'oaza.adamanthea@gmail.com'); } catch {}
    return res.status(200).json({ ok: true, celkem: k.celkem });
  } catch {
    return res.status(502).json({ error: 'Odeslání se nepodařilo. Napište nám prosím na oaza.adamanthea@gmail.com.' });
  }
}
