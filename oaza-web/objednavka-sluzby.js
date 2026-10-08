/* =====================================================================
   Oáza Adamanthea — objednávkový formulář na stránkách služeb
   Umístění v repu:  oaza-web/objednavka-sluzby.js

   Jak to funguje:
   • stránka služby načte tento skript:  <script defer src="/objednavka-sluzby.js"></script>
   • tlačítko s atributem  data-objednat          otevře objednávku dané služby
   • tlačítko s atributem  data-objednat="dotaz"  otevře krátký formulář pro dotaz
   • formulář se odešle na /api/objednavka?akce=sluzba (api/_sluzba.js):
     Oáze přijde e-mail s objednávkou; zákazník dostane kopii se shrnutím,
     když nechá zaškrtnuté „Chci kopii do svého e-mailu"
   • odkaz mailto: v href tlačítka zůstává jako záloha
   • prvek s atributem  data-objednat-zde  dostane formulář vložený přímo do stránky
     (Portálová zahrada); jeho původní obsah je záloha pro případ, že se skript nenačte

   Nová služba = nový blok v SLUZBY níže + řádek v api/_sluzba.js.
   Klíč je adresa stránky (např. /terapie-v-oaze → 'terapie-v-oaze').
   Typy polí: text (výchozí) · 'dlouhy' (víceřádkový) · 'vyber' (rozbalovací) · 'volba' (přepínač)
              · 'zaskrt' (zaškrtávací políčko) · vstup:'date' (den) · vstup:'number' (počet, od–do)
   druh: 'poptávka' změní oslovení v textech a e-mailech (výchozí je objednávka).
   ===================================================================== */
(function () {
  'use strict';

  var OAZA_EMAIL = 'oaza.adamanthea@gmail.com';
  var OAZA_TEL = '+420 737 869 752';
  var API = '/api/objednavka?akce=sluzba';

  // ---- opakovaná pole ------------------------------------------------
  function termin(n) { return { n: n || 'Preferovaný termín', ph: 'např. všední den dopoledne, víkend…' }; }
  function forma(a, b, n) { return { n: n || 'Forma', typ: 'volba', povinne: true, moznosti: [a, b] }; }
  function vzkaz(ph) { return { n: 'Vzkaz pro nás', typ: 'dlouhy', nizky: true, ph: ph || '' }; }
  var PLATBA = { n: 'Informace o platbě', ph: 'např. zaplaceno převodem v Kč' };

  // ---- formuláře jednotlivých služeb ---------------------------------
  var SLUZBY = {
    'harmonizace-a-ocista-prostoru': {
      nazev: 'Harmonizace a očista prostoru',
      titul: 'Objednávka analýzy prostoru',
      uvod: 'Analýzu vám pošleme do 3 dnů e-mailem spolu s předběžnou cenou.',
      odeslat: 'Odeslat objednávku',
      pole: [
        { n: 'Adresa prostoru', povinne: true, ph: 'ulice a číslo, obec', ac: 'street-address' },
        { n: 'Jméno uživatele prostor', ph: 'pokud prostor užívá někdo jiný' },
        { n: 'Velikost', povinne: true, ph: 'm² nebo počet místností', pul: true },
        { n: 'Číslo patra', ph: 'u nadzemních podlaží', pul: true },
        { n: 'Druh objektu', typ: 'vyber', povinne: true, moznosti: ['Byt', 'Rodinný dům', 'Komerční prostory', 'Rekreační objekt', 'Jiné místo'] },
        { n: 'Důvod harmonizace', typ: 'dlouhy', povinne: true, ph: 'co vás k harmonizaci vede' }
      ]
    },
    'dalkova-harmonizace-aury': {
      nazev: 'Dálková harmonizace aury',
      titul: 'Objednávka dálkové harmonizace aury',
      uvod: 'Po odeslání se vám ozveme a domluvíme přesný den a čas.',
      jmeno: 'Celé jméno',
      pole: [
        { n: 'Datum narození', povinne: true, ph: 'den. měsíc. rok', ac: 'bday', pul: true },
        { n: PLATBA.n, ph: PLATBA.ph, pul: true },
        vzkaz()
      ]
    },
    'harmonizace-jmena-a-prijmeni': {
      nazev: 'Harmonizace jména a příjmení',
      titul: 'Objednávka harmonizace jména a příjmení',
      uvod: 'Po odeslání se vám ozveme a domluvíme termín.',
      jmeno: 'Celé jméno a příjmení',
      pole: [forma('Osobně', 'Na dálku'), PLATBA, vzkaz()]
    },
    'karma-minule-zivoty': {
      nazev: 'Karma a minulé životy',
      titul: 'Objednávka terapie',
      uvod: 'Karma a minulé životy · po odeslání se vám ozveme s nabídkou termínu.',
      pole: [termin(), forma('Osobně', 'Na dálku'), { n: 'Téma, které chcete řešit', typ: 'dlouhy', nizky: true }]
    },
    'foceni-aury-a-caker': {
      nazev: 'Focení aury a diagnostika čaker',
      titul: 'Objednávka focení aury',
      uvod: 'Po odeslání se vám ozveme s nabídkou termínu.',
      pole: [
        { n: 'Pro koho', typ: 'volba', povinne: true, moznosti: ['Pro mě', 'Pro skupinu'], vychozi: 'Pro mě' },
        termin(),
        vzkaz('u skupiny napište počet osob a místo')
      ]
    },
    'shamballa-zasveceni': {
      nazev: 'Shamballa zasvěcení',
      titul: 'Přihláška na zasvěcení',
      uvod: 'Kurz probíhá individuálně · po odeslání se vám ozveme a domluvíme termín.',
      odeslat: 'Odeslat přihlášku',
      jmeno: 'Celé jméno',
      telefonPovinny: true,
      pole: [
        { n: 'Stupeň / typ zasvěcení', typ: 'vyber', povinne: true, moznosti: [
          '1. a 2. stupeň — základní zasvěcení', '3. a 4. stupeň — Mistr–učitel',
          'Shamballa 2002', 'Shamballa 3110', 'Shamballa 12D', 'Shamballa 15D', 'Shamballa 18D',
          'Kristova Shamballa', 'Královská Shamballa', 'Bílá Shamballa'] },
        forma('Osobně', 'Na dálku'),
        vzkaz()
      ]
    },
    'terapie-hojnosti-a-prosperity': {
      nazev: 'Terapie hojnosti a prosperity',
      titul: 'Objednávka terapie',
      uvod: 'Hojnost a prosperita · po odeslání se vám ozveme s nabídkou termínu.',
      pole: [termin(), forma('Osobně v Oáze', 'Online'), vzkaz()]
    },
    'terapie-v-oaze': {
      nazev: 'Terapie v Oáze',
      titul: 'Objednávka sezení',
      uvod: 'Po odeslání se vám ozveme s nabídkou termínu.',
      pole: [termin(), forma('Osobně', 'Na dálku'), { n: 'S čím přicházíte', typ: 'dlouhy', nizky: true, ph: 'stručně, pár vět stačí' }]
    },
    'rodove-klice': {
      nazev: 'Rodové klíče',
      titul: 'Rezervace termínu',
      uvod: 'Rodové klíče · po odeslání se vám ozveme s nabídkou termínu.',
      odeslat: 'Odeslat rezervaci',
      pole: [forma('Osobně', 'Online', 'Forma setkání'), termin('Možné termíny'), { n: 'Téma, se kterým přicházíte', typ: 'dlouhy', nizky: true }]
    },
    'kraniosakralni-terapie': {
      nazev: 'Kraniosakrální terapie & Divine Healing',
      titul: 'Rezervace termínu',
      uvod: 'Ozveme se vám do 24 hodin s nabídkou termínu.',
      odeslat: 'Odeslat rezervaci',
      pole: [{ n: 'Zpráva / preferovaný termín', typ: 'dlouhy', ph: 'např. ideálně víkend, dopoledne…' }]
    },
    'lemoare-krystaly': {
      nazev: 'Lemoare Krystaly',
      druh: 'poptávka',
      titul: 'Mám zájem o krystal',
      uvod: 'Napište, jaký krystal hledáte, a pošleme vám aktuální nabídku a katalog.',
      odeslat: 'Odeslat poptávku',
      pole: [{ n: 'Jaký krystal hledáte', typ: 'dlouhy', povinne: true }]
    },
    'spoluprace': {
      nazev: 'Spolupráce s Oázou',
      druh: 'poptávka',
      titul: 'Pojďme tvořit společně',
      uvod: 'Napište nám svou představu a domluvíme se na dalším postupu.',
      odeslat: 'Odeslat poptávku',
      pole: [
        { n: 'Služba, o kterou máte zájem', povinne: true, ph: 'focení aury, kakaová ceremonie, kurz…' },
        { n: 'Místo', typ: 'volba', povinne: true, moznosti: ['U vás', 'U nás v Oáze'] },
        { n: 'Preferovaný termín', pul: true },
        { n: 'Počet lidí', pul: true },
        { n: 'Vaše představa', typ: 'dlouhy', nizky: true }
      ]
    },
    'portalova-zahrada': {
      nazev: 'Portálová zahrada',
      druh: 'poptávka',
      titul: 'Návštěva Portálové zahrady',
      uvod: 'Vyberte si termín a my se vám ozveme s potvrzením.',
      odeslat: 'Odeslat poptávku',
      pole: [
        { n: 'Preferovaný den', vstup: 'date', povinne: true, pul: true },
        { n: 'Hodina příjezdu', typ: 'vyber', povinne: true, pul: true,
          moznosti: ['8:00', '9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'] },
        { n: 'Návštěva', typ: 'volba', povinne: true, moznosti: ['Samostatně', 'S průvodcem'], vychozi: 'Samostatně' },
        { n: 'Dospělí', vstup: 'number', od: 1, 'do': 30, hodnota: 1, povinne: true, pul: true },
        { n: 'Děti do 12 let', vstup: 'number', od: 0, 'do': 20, hodnota: 0, pul: true },
        { n: 'Mám zájem i o ubytování', typ: 'zaskrt' },
        { n: 'Poznámka', typ: 'dlouhy', nizky: true, ph: 'delší čas v zahradě, speciální přání, otázky…' }
      ]
    }
  };

  // krátký formulář pro dotaz — stejný na všech stránkách
  var DOTAZ = {
    titul: 'Napište nám',
    uvod: 'Rádi vám vše zodpovíme.',
    odeslat: 'Odeslat dotaz',
    pole: [{ n: 'Váš dotaz', typ: 'dlouhy', povinne: true }]
  };

  // ---- která služba? (z adresy stránky, případně z data-sluzba na <script>) ----
  var skript = document.currentScript;
  var slug = (skript && skript.getAttribute('data-sluzba')) ||
    location.pathname.replace(/\/+$/, '').replace(/\.html$/, '').split('/').pop();
  var SLUZBA = SLUZBY[slug];
  if (!SLUZBA) return;

  // ---- vzhled (barvy si bere z proměnných stránky, takže ladí s každou službou) ----
  var CSS =
    '.os-o{position:fixed;top:0;right:0;bottom:0;left:0;z-index:10000;display:none;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:24px 14px;background:rgba(44,37,51,.64)}' +
    '.os-o,.os-in{--os-a:var(--gold,#c9a14a);--os-ad:var(--gold-deep,#9a7628);--os-ink:var(--ink,#2c2533);--os-soft:var(--ink-soft,#6b4a55);--os-line:rgba(120,96,60,.3)}' +
    '.os-o.os-on{display:flex;align-items:flex-start;justify-content:center}' +
    '.os-o,.os-o *,.os-o *::before,.os-o *::after,.os-in,.os-in *,.os-in *::before,.os-in *::after{box-sizing:border-box}' +
    '.os-in{font-family:"Cormorant Garamond",Georgia,serif;font-size:18px;line-height:1.5;color:var(--os-soft);text-align:left}' +
    '.os-b{position:relative;width:100%;max-width:560px;margin:auto;padding:36px 34px 28px;background:#fffdf8;border:1px solid var(--os-line);border-radius:18px;box-shadow:0 30px 80px -20px rgba(0,0,0,.5);' +
      'font-family:"Cormorant Garamond",Georgia,serif;font-size:18px;line-height:1.5;color:var(--os-soft);text-align:left;outline:0}' +
    '@media(prefers-reduced-motion:no-preference){.os-o.os-on{animation:osFade .2s ease}.os-o.os-on .os-b{animation:osUp .26s ease}}' +
    '@keyframes osFade{from{opacity:0}to{opacity:1}}@keyframes osUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}' +
    '.os-x{position:absolute;top:8px;right:8px;width:44px;height:44px;margin:0;padding:0;border:0;border-radius:50%;background:none;color:var(--os-soft);font:400 30px/1 Georgia,serif;cursor:pointer}' +
    '.os-x:hover{color:var(--os-ad)}' +
    '.os-e{margin:0 0 8px;font-family:"Jost",system-ui,sans-serif;font-size:11.5px;font-weight:500;letter-spacing:.24em;text-transform:uppercase;color:var(--os-ad)}' +
    '.os-t{margin:0 34px 6px 0;font-family:"Cinzel","Cormorant Garamond",Georgia,serif;font-size:25px;font-weight:500;line-height:1.25;letter-spacing:.01em;color:var(--os-ink);text-wrap:balance}' +
    '.os-u{margin:0 0 22px;font-size:18px;font-style:italic;color:var(--os-soft)}' +
    '.os-g{display:grid;grid-template-columns:1fr 1fr;gap:16px 14px;margin:0;padding:0;border:0}' +
    '.os-f{grid-column:1/-1;min-width:0;margin:0;padding:0;border:0}' +
    '.os-f.os-pul{grid-column:auto}' +
    '.os-l{display:block;margin:0 0 6px;padding:0;font-family:"Jost",system-ui,sans-serif;font-size:12px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;color:var(--os-ad)}' +
    '.os-l i{font-style:normal;font-weight:400;letter-spacing:.04em;text-transform:none;color:var(--os-soft)}' +
    '.os-i{display:block;width:100%;margin:0;padding:12px 14px;border:1px solid var(--os-line);border-radius:10px;background:#fff;color:var(--os-ink);font-family:"Jost",system-ui,sans-serif;font-size:16px;font-weight:400;line-height:1.4;letter-spacing:0;text-transform:none;-webkit-appearance:none;appearance:none;transition:border-color .15s,box-shadow .15s}' +
    '.os-i::placeholder{color:var(--os-soft);opacity:.62}' +
    '.os-i:focus{outline:0;border-color:var(--os-a);box-shadow:0 0 0 3px rgba(201,161,74,.22)}' +
    'textarea.os-i{min-height:120px;resize:vertical}textarea.os-i.os-nizky{min-height:84px}' +
    'input[type=date].os-i{min-height:48px}' +
    'select.os-i{padding-right:40px;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1.5l5 5 5-5\' fill=\'none\' stroke=\'%236b4a55\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;background-size:12px 8px;cursor:pointer}' +
    '.os-v{display:flex;flex-wrap:wrap;gap:8px}' +
    '.os-v label{position:relative;flex:1 1 0;min-width:120px;margin:0;cursor:pointer}' +
    '.os-v input{position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;margin:0;cursor:pointer}' +
    '.os-v span{display:block;padding:11px 12px;border:1px solid var(--os-line);border-radius:10px;background:#fff;color:var(--os-ink);font-family:"Jost",system-ui,sans-serif;font-size:15.5px;line-height:1.4;text-align:center;transition:.15s}' +
    '.os-v input:checked+span{border-color:var(--os-ad);background:var(--os-ad);color:#fff}' +
    '.os-v input:focus-visible+span{box-shadow:0 0 0 3px rgba(201,161,74,.32)}' +
    '.os-f.os-chyba .os-i,.os-f.os-chyba .os-v span{border-color:#b3261e;box-shadow:0 0 0 1px #b3261e;background-color:#fef6f5}' +
    '.os-f.os-chyba .os-l{color:#b3261e}' +
    '.os-c{grid-column:1/-1;display:flex;align-items:center;gap:11px;min-height:40px;margin:-2px 0;padding:0;font-family:"Jost",system-ui,sans-serif;font-size:15.5px;font-weight:400;line-height:1.4;letter-spacing:0;text-transform:none;color:var(--os-ink);cursor:pointer}' +
    '.os-c input{flex:0 0 auto;width:22px;height:22px;margin:0;accent-color:var(--os-ad);cursor:pointer}' +
    '.os-c input:focus-visible{outline:2px solid var(--os-ad);outline-offset:2px}' +
    '.os-m{grid-column:1/-1;min-height:0;margin:0;font-family:"Jost",system-ui,sans-serif;font-size:15px;line-height:1.5;color:#b3261e}' +
    '.os-m:empty{display:none}' +
    '.os-m a{color:inherit;text-decoration:underline}' +
    '.os-s{grid-column:1/-1;display:block;width:100%;margin:4px 0 0;padding:16px 24px;border:0;border-radius:40px;background:linear-gradient(180deg,var(--os-a),var(--os-ad));color:#fff;font-family:"Jost",system-ui,sans-serif;font-size:14px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;box-shadow:0 12px 30px -14px rgba(0,0,0,.55);transition:transform .15s,opacity .15s}' +
    '.os-s:hover{transform:translateY(-1px)}.os-s:disabled{opacity:.6;cursor:default;transform:none}' +
    '.os-x:focus-visible,.os-s:focus-visible,.os-n a:focus-visible{outline:2px solid var(--os-ad);outline-offset:2px}' +
    '.os-n{grid-column:1/-1;margin:0;font-family:"Jost",system-ui,sans-serif;font-size:13px;line-height:1.5;color:var(--os-soft);text-align:center}' +
    '.os-n a{color:var(--os-ad);text-decoration:underline}' +
    '.os-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
    '.os-ok{padding:14px 0 6px;text-align:center}' +
    '.os-ok .os-hv{margin:0 0 10px;font-size:26px;line-height:1;color:var(--os-a)}' +
    '.os-ok .os-t{margin:0 0 12px}.os-ok .os-t:focus{outline:0}' +
    '.os-ok .os-p{margin:0 0 10px;font-size:19px;color:var(--os-soft)}' +
    '.os-ok .os-s{width:auto;min-width:180px;margin:16px auto 0}' +
    '@media(max-width:560px){.os-o{padding:12px 10px}.os-b{padding:30px 20px 22px;border-radius:16px}.os-t{font-size:22px}.os-g{grid-template-columns:1fr}.os-f.os-pul{grid-column:1/-1}}';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var overlay, box, otevirac, puvodniOverflow, pocitadlo = 0;
  var panely = {};   // typ → { uzel, hotovo }

  var stylHotov = false;
  function styl() {
    if (stylHotov) return;
    stylHotov = true;
    var st = el('style'); st.textContent = CSS; document.head.appendChild(st);
  }

  // slovo pro tento formulář: dotaz · poptávka · objednávka
  function slovo(typ) { return typ === 'dotaz' ? 'dotaz' : (SLUZBA.druh || 'objednávka'); }
  var DNY = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  function dnesISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function zaklad() {
    if (overlay) return;
    styl();
    overlay = el('div', 'os-o');
    box = el('div', 'os-b');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.tabIndex = -1;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) zavrit(); });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); zavrit(); return; }
      if (e.key !== 'Tab') return;
      var f = box.querySelectorAll('button:not([disabled]),input:not([tabindex="-1"]),select,textarea,a[href]');
      if (!f.length) return;
      var prvni = f[0], posledni = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === prvni || document.activeElement === box)) { e.preventDefault(); posledni.focus(); }
      else if (!e.shiftKey && document.activeElement === posledni) { e.preventDefault(); prvni.focus(); }
    });
  }

  // jedno pole formuláře; vrací { uzel, cti(), prvek, platne() }
  function postavPole(p, typ) {
    var id = 'os-' + typ + '-' + (++pocitadlo);
    var obal = el('div', 'os-f' + (p.pul ? ' os-pul' : ''));
    var prvek, cti, platne;

    if (p.typ === 'zaskrt') {
      var zl = el('label', 'os-c');
      prvek = el('input'); prvek.type = 'checkbox'; prvek.id = id;
      zl.appendChild(prvek); zl.appendChild(el('span', '', p.n));
      obal.appendChild(zl);
      cti = function () { return prvek.checked ? 'Ano' : ''; };
    } else if (p.typ === 'volba') {
      obal.setAttribute('role', 'radiogroup');
      var nadpis = el('span', 'os-l', p.n); nadpis.id = id + '-l';
      obal.setAttribute('aria-labelledby', nadpis.id);
      obal.appendChild(nadpis);
      var rada = el('div', 'os-v');
      p.moznosti.forEach(function (m) {
        var l = el('label');
        var r = el('input'); r.type = 'radio'; r.name = id; r.value = m;
        if (p.vychozi === m) r.checked = true;
        l.appendChild(r); l.appendChild(el('span', '', m));
        rada.appendChild(l);
      });
      obal.appendChild(rada);
      prvek = rada.querySelector('input');
      cti = function () { var c = rada.querySelector('input:checked'); return c ? c.value : ''; };
    } else {
      var lab = el('label', 'os-l', p.n); lab.htmlFor = id;
      if (!p.povinne) { lab.appendChild(document.createTextNode(' ')); lab.appendChild(el('i', '', '· volitelné')); }
      obal.appendChild(lab);
      if (p.typ === 'vyber') {
        prvek = el('select', 'os-i');
        var prazdna = el('option', '', 'Vyberte…'); prazdna.value = ''; prvek.appendChild(prazdna);
        p.moznosti.forEach(function (m) { var o = el('option', '', m); o.value = m; prvek.appendChild(o); });
      } else if (p.typ === 'dlouhy') {
        prvek = el('textarea', 'os-i' + (p.nizky ? ' os-nizky' : ''));
        prvek.maxLength = 2000;
      } else {
        prvek = el('input', 'os-i');
        prvek.type = p.vstup || 'text';
        if (p.vstup === 'number') {
          prvek.min = p.od; prvek.max = p['do']; prvek.inputMode = 'numeric';
          if (p.hodnota != null) prvek.value = p.hodnota;
        } else if (p.vstup === 'date') {
          prvek.min = dnesISO();
        } else {
          prvek.maxLength = p.max || 200;
        }
        if (p.rezim) prvek.inputMode = p.rezim;
      }
      prvek.id = id;
      if (p.ph) prvek.placeholder = p.ph;
      if (p.ac) prvek.autocomplete = p.ac;
      if (p.povinne) prvek.setAttribute('aria-required', 'true');
      obal.appendChild(prvek);
      cti = function () { return prvek.value.trim(); };
      if (p.vstup === 'date') {
        // do e-mailu jde den česky (např. „neděle 12. 10. 2026"); den musí být dnes nebo později
        cti = function () {
          var v = prvek.value.trim(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
          if (!m) return v;
          return DNY[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ' ' + (+m[3]) + '. ' + (+m[2]) + '. ' + m[1];
        };
        platne = function () { var v = prvek.value.trim(); return !/^\d{4}-\d{2}-\d{2}$/.test(v) || v >= dnesISO(); };
      } else if (p.vstup === 'number') {
        platne = function () {
          var v = prvek.value.trim(); if (!v) return true;
          var n = Number(v); return n === Math.floor(n) && n >= p.od && n <= p['do'];
        };
      }
    }
    return { uzel: obal, cti: cti, prvek: prvek, def: p, platne: platne };
  }

  // vlozeny = formulář přímo ve stránce (nadpis dodává stránka), jinak obsah okna
  function postavPanel(typ, vlozeny) {
    var C = typ === 'dotaz' ? DOTAZ : SLUZBA;
    var uzel = el('div');
    var titulId = 'os-titul-' + typ + (vlozeny ? '-v' : '');
    if (!vlozeny) {
      var zavrBtn = el('button', 'os-x', '×'); zavrBtn.type = 'button'; zavrBtn.setAttribute('aria-label', 'Zavřít');
      zavrBtn.addEventListener('click', zavrit);
      uzel.appendChild(zavrBtn);
      uzel.appendChild(el('p', 'os-e', typ === 'dotaz' ? SLUZBA.nazev : 'Oáza Adamanthea'));
      var titul = el('p', 'os-t', C.titul); titul.id = titulId; titul.setAttribute('role', 'heading'); titul.setAttribute('aria-level', '2');
      uzel.appendChild(titul);
      if (C.uvod) uzel.appendChild(el('p', 'os-u', C.uvod));
    }

    var form = el('form', 'os-g'); form.noValidate = true;
    var jmeno = postavPole({ n: (typ !== 'dotaz' && SLUZBA.jmeno) || 'Jméno a příjmení', povinne: true, ac: 'name', max: 120 }, typ);
    var email = postavPole({ n: 'E-mail', povinne: true, vstup: 'email', rezim: 'email', ac: 'email', max: 160, pul: true }, typ);
    var telPovinny = typ !== 'dotaz' && !!SLUZBA.telefonPovinny;
    var telefon = postavPole({ n: 'Telefon', povinne: telPovinny, vstup: 'tel', rezim: 'tel', ac: 'tel', max: 40, pul: true }, typ);
    var vlastni = C.pole.map(function (p) { return postavPole(p, typ); });
    var vsechna = [jmeno, email, telefon].concat(vlastni);
    vsechna.forEach(function (f) { form.appendChild(f.uzel); });

    // skryté kontrolní pole (vyplní ho jen automat)
    var hp = el('div', 'os-hp'); hp.setAttribute('aria-hidden', 'true');
    var hpIn = el('input'); hpIn.type = 'text'; hpIn.name = 'kontrola'; hpIn.tabIndex = -1; hpIn.autocomplete = 'off';
    hp.appendChild(hpIn); form.appendChild(hp);

    // kopie odeslané zprávy na e-mail zákazníka (zaškrtnuto = pošle se shrnutí)
    var kopie = el('label', 'os-c');
    var kopieIn = el('input'); kopieIn.type = 'checkbox'; kopieIn.checked = true;
    kopie.appendChild(kopieIn); kopie.appendChild(el('span', '', 'Chci kopii do svého e-mailu'));
    form.appendChild(kopie);

    var msg = el('p', 'os-m'); msg.setAttribute('role', 'alert');
    form.appendChild(msg);
    var popisek = C.odeslat || 'Odeslat objednávku';
    var odeslat = el('button', 'os-s', popisek); odeslat.type = 'submit';
    form.appendChild(odeslat);
    var gdpr = el('p', 'os-n', 'Údaje použijeme k vyřízení vaší ' + (typ === 'dotaz' ? 'zprávy' : (SLUZBA.druh === 'poptávka' ? 'poptávky' : 'objednávky')) + '. ');
    var gl = el('a', '', 'Ochrana osobních údajů'); gl.href = '/gdpr'; gl.target = '_blank'; gl.rel = 'noopener';
    gdpr.appendChild(gl); form.appendChild(gdpr);
    uzel.appendChild(form);

    // opravené pole hned ztrácí zvýraznění; s posledním zmizí i výzva
    function opraveno(f) {
      if (!f.uzel.classList.contains('os-chyba')) return;
      f.uzel.classList.remove('os-chyba');
      if (f.prvek) f.prvek.removeAttribute('aria-invalid');
      if (!form.querySelector('.os-chyba')) msg.textContent = '';
    }
    vsechna.forEach(function (f) {
      f.uzel.addEventListener('input', function () { opraveno(f); });
      f.uzel.addEventListener('change', function () { opraveno(f); });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.textContent = '';
      var chybne = vsechna.filter(function (f) {
        var h = f.cti();
        var ok = f === email ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(h) : ((!f.def.povinne || !!h) && (!f.platne || f.platne()));
        f.uzel.classList.toggle('os-chyba', !ok);
        if (f.prvek) f.prvek.setAttribute('aria-invalid', ok ? 'false' : 'true');
        return !ok;
      });
      if (chybne.length) {
        msg.textContent = chybne.length === 1 && chybne[0] === email && email.cti()
          ? 'Zkontrolujte prosím e-mail, ať vám odpověď spolehlivě dojde.'
          : 'Doplňte prosím zvýrazněná pole.';
        if (chybne[0].prvek) chybne[0].prvek.focus();
        return;
      }
      var data = {
        sluzba: slug, typ: typ,
        jmeno: jmeno.cti(), email: email.cti(), telefon: telefon.cti(),
        pole: vlastni.map(function (f) { return [f.def.n, f.cti()]; }).filter(function (p) { return p[1]; }),
        kopie: kopieIn.checked,
        kontrola: hpIn.value
      };
      odeslat.disabled = true; odeslat.textContent = 'Odesílám…';
      var ctrl = window.AbortController ? new AbortController() : null;
      var casovac = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : 0;
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          clearTimeout(casovac);
          if (!x.ok || !x.j || !x.j.ok) throw new Error((x.j && x.j.error) || '');
          hotovo(typ, uzel, data, x.j, vlozeny);
        })
        .catch(function (err) {
          clearTimeout(casovac);
          odeslat.disabled = false; odeslat.textContent = popisek;
          msg.textContent = '';
          msg.appendChild(document.createTextNode(((err && err.name !== 'AbortError' && err.name !== 'TypeError' && err.message) || 'Zkuste to prosím za chvíli znovu.') + ' '));
          var z = el('a', '', 'Poslat ze svého e-mailu'); z.href = zalozniMailto(typ, data);
          msg.appendChild(z);
          msg.appendChild(document.createTextNode(' · '));
          var t = el('a', '', 'Zavolat ' + OAZA_TEL); t.href = 'tel:' + OAZA_TEL.replace(/\s/g, '');
          msg.appendChild(t);
        });
    });

    return { uzel: uzel, titulId: titulId, prvni: jmeno.prvek, hotovo: false };
  }

  function zalozniMailto(typ, d) {
    var r = ['Jméno: ' + d.jmeno, 'E-mail: ' + d.email];
    if (d.telefon) r.push('Telefon: ' + d.telefon);
    d.pole.forEach(function (p) { r.push(p[0] + ': ' + p[1]); });
    return 'mailto:' + OAZA_EMAIL + '?subject=' + encodeURIComponent(slovo(typ).charAt(0).toUpperCase() + slovo(typ).slice(1) + ' – ' + SLUZBA.nazev) +
      '&body=' + encodeURIComponent(r.join('\n') + '\n');
  }

  function hotovo(typ, uzel, data, odp, vlozeny) {
    while (uzel.firstChild) uzel.removeChild(uzel.firstChild);
    var ok = el('div', 'os-ok');
    ok.appendChild(el('p', 'os-hv', '✦'));
    var t = el('p', 'os-t', 'Děkujeme, ' + slovo(typ) + ' je u nás');
    t.setAttribute('role', 'heading'); t.setAttribute('aria-level', vlozeny ? '3' : '2');
    ok.appendChild(t);
    ok.appendChild(el('p', 'os-p', odp.dalsi || 'Brzy se vám ozveme.'));
    if (odp.potvrzeni) ok.appendChild(el('p', 'os-p', 'Shrnutí najdete ve svém e-mailu ' + data.email + '.'));
    if (vlozeny) {
      // ve stránce: poděkování zůstane na místě formuláře a čtečka ho ohlásí
      ok.setAttribute('role', 'status');
      t.tabIndex = -1;
      uzel.appendChild(ok);
      if (ok.scrollIntoView) ok.scrollIntoView({ block: 'center' });
      t.focus({ preventScroll: true });
      return;
    }
    var P = panely[typ]; P.hotovo = true;
    t.id = P.titulId;
    var z = el('button', 'os-s', 'Zavřít'); z.type = 'button'; z.addEventListener('click', zavrit);
    ok.appendChild(z);
    uzel.appendChild(ok);
    P.prvni = z;
    overlay.scrollTop = 0;
    z.focus();
  }

  function otevrit(typ, zdroj) {
    typ = typ === 'dotaz' ? 'dotaz' : 'objednavka';
    zaklad();
    if (!panely[typ] || panely[typ].hotovo) panely[typ] = postavPanel(typ);
    var P = panely[typ];
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(P.uzel);
    box.setAttribute('aria-labelledby', P.titulId);
    otevirac = zdroj || document.activeElement;
    if (!overlay.classList.contains('os-on')) {
      puvodniOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    overlay.classList.add('os-on');
    overlay.scrollTop = 0;
    // na dotykových zařízeních necháme klávesnici zavřenou, dokud si člověk pole sám nevybere
    var dotyk = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    (dotyk ? box : (P.prvni || box)).focus({ preventScroll: true });
  }

  function zavrit() {
    if (!overlay || !overlay.classList.contains('os-on')) return;
    overlay.classList.remove('os-on');
    document.body.style.overflow = puvodniOverflow || '';
    if (otevirac && otevirac.focus) otevirac.focus({ preventScroll: true });
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-objednat]') : null;
    if (!t) return;
    e.preventDefault();
    otevrit(t.getAttribute('data-objednat'), t);
  });

  // formulář vložený přímo do stránky: <div data-objednat-zde>záložní obsah</div>
  Array.prototype.forEach.call(document.querySelectorAll('[data-objednat-zde]'), function (misto) {
    styl();
    var typ = misto.getAttribute('data-objednat-zde') === 'dotaz' ? 'dotaz' : 'objednavka';
    while (misto.firstChild) misto.removeChild(misto.firstChild);
    misto.classList.add('os-in');
    misto.appendChild(postavPanel(typ, true).uzel);
  });

  window.OazaObjednavka = { otevrit: otevrit, zavrit: zavrit };
})();
