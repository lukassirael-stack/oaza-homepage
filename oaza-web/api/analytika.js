// =====================================================================
//  Oáza Adamanthea — serverless funkce pro počítadlo návštěvnosti
//  Umístění v repu:  oaza-web/api/analytika.js
//
//  POST  /api/analytika           → zapíše jednu návštěvu (volá tracker)
//  GET   /api/analytika?heslo=…    → vrátí statistiky (pro admin přehled)
//                       &dny=30     → období v dnech (7 / 30 / 90), výchozí 30
//
//  Potřebné Environment Variables ve Vercel projektu:
//    SUPABASE_URL          (výchozí: https://myybuesoourgpbouwwst.supabase.co)
//    SUPABASE_SERVICE_KEY  (service_role klíč ze Supabase → Settings → API)
//    ANALYTIKA_HESLO       (heslo, kterým se otevře admin přehled)
//  Bez npm závislostí — používá nativní fetch (Node 18+).
// =====================================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.SUPABASE_PROJECT_URL ||
  "https://myybuesoourgpbouwwst.supabase.co";

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const HESLO = process.env.ANALYTIKA_HESLO || "";

const TABULKA = "navstevnost";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (!SERVICE_KEY) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ chyba: "Chybí SUPABASE_SERVICE_KEY." }));
  }

  // ------------------------------------------------------------------
  //  POST — zápis jedné návštěvy
  // ------------------------------------------------------------------
  if (req.method === "POST") {
    try {
      let body = req.body;
      // sendBeacon posílá text/plain → tělo může přijít jako string
      if (typeof body === "string") body = JSON.parse(body || "{}");
      if (!body || typeof body !== "object") body = {};

      const zaznam = {
        session_id: String(body.session_id || "").slice(0, 80) || "neznama",
        stranka: String(body.stranka || "/").slice(0, 300),
        titulek: body.titulek ? String(body.titulek).slice(0, 200) : null,
        referrer: body.referrer ? String(body.referrer).slice(0, 300) : null,
        zarizeni: body.zarizeni === "mobil" ? "mobil" : "desktop",
        doba_sekundy: Math.max(
          0,
          Math.min(86400, parseInt(body.doba_sekundy, 10) || 0)
        ),
      };

      const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABULKA}`, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(zaznam),
      });

      if (!r.ok) {
        const t = await r.text();
        res.statusCode = 502;
        return res.end(JSON.stringify({ chyba: "Zápis selhal", detail: t }));
      }

      res.statusCode = 204;
      return res.end();
    } catch (e) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ chyba: "Špatná data", detail: String(e) }));
    }
  }

  // ------------------------------------------------------------------
  //  GET — statistiky pro admin (chráněno heslem)
  // ------------------------------------------------------------------
  if (req.method === "GET") {
    try {
      const url = new URL(req.url, "http://x");
      const heslo = url.searchParams.get("heslo") || "";

      if (!HESLO || heslo !== HESLO) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ chyba: "Špatné heslo." }));
      }

      let dny = parseInt(url.searchParams.get("dny"), 10) || 30;
      if (![7, 30, 90].includes(dny)) dny = 30;

      const od = new Date(Date.now() - dny * 86400000).toISOString();

      const dotaz =
        `${SUPABASE_URL}/rest/v1/${TABULKA}` +
        `?select=stranka,session_id,zarizeni,referrer,doba_sekundy,created_at` +
        `&created_at=gte.${encodeURIComponent(od)}` +
        `&order=created_at.desc&limit=50000`;

      const r = await fetch(dotaz, {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      });

      if (!r.ok) {
        const t = await r.text();
        res.statusCode = 502;
        return res.end(JSON.stringify({ chyba: "Čtení selhalo", detail: t }));
      }

      const radky = await r.json();
      const souhrn = agreguj(radky, dny);

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 200;
      return res.end(JSON.stringify(souhrn));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ chyba: "Chyba serveru", detail: String(e) }));
    }
  }

  res.statusCode = 405;
  return res.end(JSON.stringify({ chyba: "Metoda není povolena." }));
};

// --------------------------------------------------------------------
//  Agregace dat do přehledu
// --------------------------------------------------------------------
function agreguj(radky, dny) {
  const relace = new Set();
  const stranky = {};
  const dnyMapa = {};
  const referrery = {};
  let mobil = 0,
    desktop = 0,
    soucetDoby = 0,
    pocetSDobou = 0;

  for (const x of radky) {
    relace.add(x.session_id);

    // podle stránky
    const s = x.stranka || "/";
    if (!stranky[s]) stranky[s] = { stranka: s, navstev: 0, celkovaDoba: 0, sDobou: 0 };
    stranky[s].navstev++;
    if (x.doba_sekundy > 0) {
      stranky[s].celkovaDoba += x.doba_sekundy;
      stranky[s].sDobou++;
      soucetDoby += x.doba_sekundy;
      pocetSDobou++;
    }

    // podle dne (YYYY-MM-DD)
    const den = (x.created_at || "").slice(0, 10);
    dnyMapa[den] = (dnyMapa[den] || 0) + 1;

    // zařízení
    if (x.zarizeni === "mobil") mobil++;
    else desktop++;

    // zdroje
    const ref = normalizujReferrer(x.referrer);
    referrery[ref] = (referrery[ref] || 0) + 1;
  }

  // řazení stránek podle počtu návštěv
  const podleStranky = Object.values(stranky)
    .map((s) => ({
      stranka: s.stranka,
      navstev: s.navstev,
      prumDoba: s.sDobou ? Math.round(s.celkovaDoba / s.sDobou) : 0,
      celkovaDoba: s.celkovaDoba,
    }))
    .sort((a, b) => b.navstev - a.navstev);

  // souvislá řada dní (i prázdné dny = 0)
  const podleDne = [];
  for (let i = dny - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    podleDne.push({ den: d, navstev: dnyMapa[d] || 0 });
  }

  const topReferrery = Object.entries(referrery)
    .map(([zdroj, pocet]) => ({ zdroj, pocet }))
    .sort((a, b) => b.pocet - a.pocet)
    .slice(0, 10);

  return {
    obdobiDnu: dny,
    celkemNavstev: radky.length,
    unikatnichRelaci: relace.size,
    prumernaDoba: pocetSDobou ? Math.round(soucetDoby / pocetSDobou) : 0,
    mobil,
    desktop,
    podleStranky,
    podleDne,
    topReferrery,
  };
}

function normalizujReferrer(ref) {
  if (!ref) return "Přímý / záložka";
  try {
    const h = new URL(ref).hostname.replace(/^www\./, "");
    if (h.includes("oaza-adamanthea")) return "Vlastní web";
    if (h.includes("google")) return "Google";
    if (h.includes("facebook") || h.includes("fb.")) return "Facebook";
    if (h.includes("instagram")) return "Instagram";
    if (h.includes("beehiiv") || h.includes("mail")) return "Newsletter / e-mail";
    return h;
  } catch (e) {
    return "Přímý / záložka";
  }
}
