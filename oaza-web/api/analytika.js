// =====================================================================
//  Oáza Adamanthea — serverless funkce pro počítadlo návštěvnosti
//  Umístění v repu:  oaza-web/api/analytika.js
//
//  POST  /api/analytika            → zapíše jednu návštěvu (volá tracker)
//  GET   /api/analytika?heslo=…     → statistiky pro admin přehled
//                       &dny=dnes   → dnešní den (po hodinách, čas ČR)
//                       &dny=7|30|90 → posledních N dní (výchozí 30)
//
//  Env Variables ve Vercel projektu:
//    SUPABASE_URL          (výchozí: https://myybuesoourgpbouwwst.supabase.co)
//    SUPABASE_SERVICE_KEY  (service_role klíč)
//    ANALYTIKA_HESLO       (heslo k přehledu)
//  Bez npm závislostí — nativní fetch (Node 18+).
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
const TZ = "Europe/Prague";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// posun českého času oproti UTC v ms (řeší letní/zimní čas)
function offsetCR(d) {
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const cr = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
  return cr.getTime() - utc.getTime();
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

  // ---------- POST: zápis návštěvy ----------
  if (req.method === "POST") {
    try {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      if (!body || typeof body !== "object") body = {};

      const zaznam = {
        session_id: String(body.session_id || "").slice(0, 80) || "neznama",
        stranka: String(body.stranka || "/").slice(0, 300),
        titulek: body.titulek ? String(body.titulek).slice(0, 200) : null,
        referrer: body.referrer ? String(body.referrer).slice(0, 300) : null,
        zarizeni: body.zarizeni === "mobil" ? "mobil" : "desktop",
        doba_sekundy: Math.max(0, Math.min(86400, parseInt(body.doba_sekundy, 10) || 0)),
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

  // ---------- GET: statistiky ----------
  if (req.method === "GET") {
    try {
      const url = new URL(req.url, "http://x");
      const heslo = url.searchParams.get("heslo") || "";
      if (!HESLO || heslo !== HESLO) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ chyba: "Špatné heslo." }));
      }

      const param = (url.searchParams.get("dny") || "30").toLowerCase();
      const jeDnes = param === "dnes" || param === "0";
      let dny = parseInt(param, 10);
      if (![7, 30, 90].includes(dny)) dny = 30;

      const now = new Date();
      const off = offsetCR(now);
      let odUtc;
      if (jeDnes) {
        const crNow = new Date(now.getTime() + off);
        const crMidnight = Date.UTC(
          crNow.getUTCFullYear(),
          crNow.getUTCMonth(),
          crNow.getUTCDate(),
          0, 0, 0
        );
        odUtc = new Date(crMidnight - off);
      } else {
        odUtc = new Date(Date.now() - dny * 86400000);
      }

      const dotaz =
        `${SUPABASE_URL}/rest/v1/${TABULKA}` +
        `?select=stranka,session_id,zarizeni,referrer,doba_sekundy,created_at` +
        `&created_at=gte.${encodeURIComponent(odUtc.toISOString())}` +
        `&order=created_at.desc&limit=50000`;

      const r = await fetch(dotaz, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });

      if (!r.ok) {
        const t = await r.text();
        res.statusCode = 502;
        return res.end(JSON.stringify({ chyba: "Čtení selhalo", detail: t }));
      }

      const radky = await r.json();
      const souhrn = agreguj(radky, { jeDnes, dny, off });

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
function agreguj(radky, opt) {
  const relace = new Set();
  const stranky = {};
  const referrery = {};
  let mobil = 0, desktop = 0, soucetDoby = 0, pocetSDobou = 0;

  for (const x of radky) {
    relace.add(x.session_id);

    const s = x.stranka || "/";
    if (!stranky[s]) stranky[s] = { stranka: s, navstev: 0, celkovaDoba: 0, sDobou: 0 };
    stranky[s].navstev++;
    if (x.doba_sekundy > 0) {
      stranky[s].celkovaDoba += x.doba_sekundy;
      stranky[s].sDobou++;
      soucetDoby += x.doba_sekundy;
      pocetSDobou++;
    }

    if (x.zarizeni === "mobil") mobil++; else desktop++;

    const ref = normalizujReferrer(x.referrer);
    referrery[ref] = (referrery[ref] || 0) + 1;
  }

  const podleStranky = Object.values(stranky)
    .map((s) => ({
      stranka: s.stranka,
      navstev: s.navstev,
      prumDoba: s.sDobou ? Math.round(s.celkovaDoba / s.sDobou) : 0,
      celkovaDoba: s.celkovaDoba,
    }))
    .sort((a, b) => b.navstev - a.navstev);

  // časová řada: hodinová (dnes) nebo denní (N dní)
  const podleDne = opt.jeDnes ? hodinovaRada(radky, opt.off) : denniRada(radky, opt.dny);

  const topReferrery = Object.entries(referrery)
    .map(([zdroj, pocet]) => ({ zdroj, pocet }))
    .sort((a, b) => b.pocet - a.pocet)
    .slice(0, 10);

  return {
    obdobiPopis: opt.jeDnes ? "dnes" : `za ${opt.dny} dní`,
    obdobiDnu: opt.jeDnes ? 0 : opt.dny,
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

function denniRada(radky, dny) {
  const mapa = {};
  for (const x of radky) {
    const den = (x.created_at || "").slice(0, 10);
    mapa[den] = (mapa[den] || 0) + 1;
  }
  const out = [];
  for (let i = dny - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ den: d, navstev: mapa[d] || 0 });
  }
  return out;
}

function hodinovaRada(radky, off) {
  const mapa = {};
  for (const x of radky) {
    const t = new Date(new Date(x.created_at).getTime() + off);
    const h = t.getUTCHours();
    mapa[h] = (mapa[h] || 0) + 1;
  }
  const aktHod = new Date(Date.now() + off).getUTCHours();
  const out = [];
  for (let h = 0; h <= aktHod; h++) {
    out.push({ den: String(h).padStart(2, "0") + ":00", navstev: mapa[h] || 0 });
  }
  return out;
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
