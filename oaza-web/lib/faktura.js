// lib/faktura.js — generování PDF faktury (doklad o zaplacení) pro Bali Shop
// pdf-lib + ořezaný EB Garamond (čeština + €). Vrací Uint8Array.
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { EBG_REGULAR, EBG_SEMIBOLD } from './_pdffont.js';

const NAVY = rgb(0.106, 0.165, 0.255); // #1B2A41
const GOLD = rgb(0.722, 0.573, 0.290); // #B8924A
const GREY = rgb(0.478, 0.443, 0.373); // #7A715F
const LINE = rgb(0.886, 0.839, 0.737); // #E2D6BC

function cislaSeMezerami(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
}
function castka(v, mena) {
  return cislaSeMezerami(v || 0) + (mena === 'EUR' ? '\u00A0€' : '\u00A0Kč');
}
function datum(d) {
  const x = d ? new Date(d) : new Date();
  return `${x.getDate()}.\u00A0${x.getMonth() + 1}.\u00A0${x.getFullYear()}`;
}

export async function vytvorFakturaPDF(o, dodavatel) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(Buffer.from(EBG_REGULAR, 'base64'), { subset: true });
  const sb = await doc.embedFont(Buffer.from(EBG_SEMIBOLD, 'base64'), { subset: true });

  const W = 595.28, H = 841.89;       // A4
  const page = doc.addPage([W, H]);
  const M = 54;                        // okraj
  let y = M;                           // y = vzdálenost odshora

  const T = (str, x, yTop, { font = reg, size = 10, color = NAVY } = {}) =>
    page.drawText(String(str == null ? '' : str), { x, y: H - yTop, size, font, color });
  const TR = (str, xRight, yTop, opt = {}) => {
    const font = opt.font || reg, size = opt.size || 10;
    const w = font.widthOfTextAtSize(String(str), size);
    T(str, xRight - w, yTop, opt);
  };
  const cara = (yTop, x1 = M, x2 = W - M, color = LINE) =>
    page.drawLine({ start: { x: x1, y: H - yTop }, end: { x: x2, y: H - yTop }, thickness: 1, color });

  // ---- hlavička ----
  T('OÁZA ADAMANTHEA', M, y + 4, { font: sb, size: 9, color: GOLD });
  T('Bali Shop', M, y + 32, { font: sb, size: 21, color: NAVY });
  TR('FAKTURA', W - M, y + 26, { font: sb, size: 21, color: NAVY });
  TR('č. ' + o.faktura_cislo, W - M, y + 46, { font: reg, size: 11, color: GREY });
  y += 64;
  cara(y);
  y += 26;

  // ---- dodavatel / odběratel ----
  const colL = M, colR = W / 2 + 10;
  T('DODAVATEL', colL, y, { font: sb, size: 8, color: GOLD });
  T('ODBĚRATEL', colR, y, { font: sb, size: 8, color: GOLD });
  y += 16;

  const dodRadky = [
    [dodavatel.jmeno, sb],
    [dodavatel.adresa],
    [dodavatel.psc_mesto],
    ['IČO: ' + dodavatel.ico],
    [dodavatel.dph || 'Neplátce DPH', reg, GREY],
  ];
  const odbRadky = [[o.jmeno || '', sb], [o.email || '']];
  if (o.telefon) odbRadky.push([o.telefon]);
  if (o.doprava === 'adresa' && o.adresa) {
    odbRadky.push(['']);
    odbRadky.push([o.adresa.ulice || '']);
    odbRadky.push([`${o.adresa.psc || ''} ${o.adresa.mesto || ''}`]);
  }

  let yL = y, yR = y;
  for (const [txt, font, col] of dodRadky) { T(txt, colL, yL, { font: font || reg, size: 10, color: col || NAVY }); yL += 15; }
  for (const [txt, font, col] of odbRadky) { T(txt, colR, yR, { font: font || reg, size: 10, color: col || NAVY }); yR += 15; }
  y = Math.max(yL, yR) + 10;
  cara(y);
  y += 22;

  // ---- meta (datum, VS, úhrada) ----
  const mety = [
    ['Datum vystavení', datum(o.zaplaceno_kdy)],
    ['Datum úhrady', datum(o.zaplaceno_kdy)],
    ['Variabilní symbol', o.vs || ''],
    ['Způsob úhrady', 'Bankovní převod / QR'],
  ];
  let mx = M;
  const colW = (W - 2 * M) / 4;
  for (const [k, v] of mety) {
    T(k.toUpperCase(), mx, y, { font: sb, size: 7, color: GOLD });
    T(v, mx, y + 14, { font: reg, size: 10, color: NAVY });
    mx += colW;
  }
  y += 34;
  cara(y);
  y += 24;

  // ---- položky ----
  T('POLOŽKA', M, y, { font: sb, size: 8, color: GOLD });
  TR('CENA', W - M, y, { font: sb, size: 8, color: GOLD });
  y += 16;

  const maxNameW = (W - M) - M - 90;
  const wrap = (txt, font, size) => {
    const slova = String(txt).split(' '); const radky = []; let cur = '';
    for (const s of slova) {
      const test = cur ? cur + ' ' + s : s;
      if (font.widthOfTextAtSize(test, size) > maxNameW && cur) { radky.push(cur); cur = s; }
      else cur = test;
    }
    if (cur) radky.push(cur);
    return radky;
  };

  for (const p of (o.polozky || [])) {
    const cena = o.mena === 'EUR' ? p.cena_eur : p.cena;
    const radky = wrap(p.nazev + (p.digitalni ? ' (digitální)' : ''), reg, 10);
    radky.forEach((r, i) => T(r, M, y + i * 14, { font: reg, size: 10 }));
    TR(castka(cena, o.mena), W - M, y, { font: reg, size: 10 });
    y += radky.length * 14 + 8;
    cara(y - 4, M, W - M, rgb(0.93, 0.90, 0.82));
  }
  y += 6;

  // ---- součty ----
  const sumX = W - M - 200;
  const sumRadek = (k, v, opt = {}) => {
    T(k, sumX, y, { font: opt.font || reg, size: opt.size || 10, color: opt.color || GREY });
    TR(v, W - M, y, { font: opt.font || reg, size: opt.size || 10, color: opt.color || NAVY });
    y += opt.gap || 17;
  };
  sumRadek('Zboží', castka(o.cena_zbozi, o.mena));
  const dopravaTxt = o.doprava_cena ? castka(o.doprava_cena, o.mena) : (o.doprava === 'mezi_nami' ? 'hradí zákazník' : 'zdarma');
  sumRadek('Doprava', dopravaTxt);
  cara(y - 2, sumX, W - M);
  y += 6;
  sumRadek('Celkem', castka(o.cena_celkem, o.mena), { font: sb, size: 14, color: NAVY, gap: 24 });

  // ---- patička ----
  let fy = H - 70;
  cara(fy - 16);
  T('Neplátce DPH. Doklad slouží jako doklad o zaplacení.', M, fy, { font: reg, size: 9, color: GREY });
  T('Oáza Adamanthea · oaza.adamanthea@gmail.com · oaza-adamanthea.cz', M, fy + 14, { font: reg, size: 9, color: GREY });
  TR('Děkujeme za tvou objednávku.', W - M, fy + 14, { font: reg, size: 9, color: GOLD });

  return await doc.save();
}
