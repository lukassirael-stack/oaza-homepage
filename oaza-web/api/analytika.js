// =====================================================================
//  Oáza Adamanthea — serverless funkce pro počítadlo návštěvnosti
//  Umístění v repu:  oaza-web/api/analytika.js
//
//  POST  /api/analytika            → zapíše jednu návštěvu (volá tracker)
//  GET   /api/analytika?heslo=…     → statistiky pro admin přehled
//                       &dny=dnes   → dnešní den (po hodinách, čas ČR)
//                       &dny=7|30|90 → posledních N dní (výchozí 30)
//
//  Souhrn se počítá v databázi (funkce analytika_souhrn) — žádný limit
//  1000 řádků, počítá vždy přes všechna data v období.
//
//  Env Variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANALYTIKA_HESLO
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

// IP adresy, ze kterých se návštěvy NEzapisují (vlastní zařízení).
// Nastav ve Vercel env proměnné ANALYTIKA_IGNORE_IP, oddělené čárkou.
const IGNORE_IPS = (process.env.ANALYTIKA_IGNORE_IP || "")
  .split(",").map((x) => x.trim()).filter(Boolean);

function klientIP(req) {
  const xff = req.headers["x-forwarded-for"] || "";
  const prvni = String(xff).split(",")[0].trim();
  return prvni || req.headers["x-real-ip"] || "";
}
const TZ = "Europe/Prague";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

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
      // vlastní zařízení podle IP → nezapisuj (nic se neukládá)
      if (IGNORE_IPS.includes(klientIP(req))) {
        res.statusCode = 204;
        return res.end();
      }
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

      // pomocník BEZ hesla: zjisti svou IP a jestli jsi vyřazený
      if (url.searchParams.get("mojeip")) {
        const ip = klientIP(req);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.statusCode = 200;
        return res.end(JSON.stringify({ moje_ip: ip, vyrazena: IGNORE_IPS.includes(ip) }));
      }
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

      // souhrn počítaný v databázi (bez limitu 1000)
      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analytika_souhrn`, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ p_od: odUtc.toISOString(), p_hodinove: jeDnes }),
      });

      if (!rpc.ok) {
        const t = await rpc.text();
        res.statusCode = 502;
        return res.end(JSON.stringify({ chyba: "Souhrn selhal", detail: t }));
      }

      const s = await rpc.json();
      const vystup = sestav(s, { jeDnes, dny, off });

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 200;
      return res.end(JSON.stringify(vystup));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ chyba: "Chyba serveru", detail: String(e) }));
    }
  }

  res.statusCode = 405;
  return res.end(JSON.stringify({ chyba: "Metoda není povolena." }));
};

// --------------------------------------------------------------------
function sestav(s, opt) {
  s = s || {};

  const podleStranky = (s.stranky || []).map((p) => ({
    stranka: p.stranka,
    navstev: p.navstev,
    prumDoba: p.prum_doba || 0,
    celkovaDoba: p.celkova_doba || 0,
  }));

  // referrery → kategorie
  const ref = {};
  for (const r of s.referrery || []) {
    const cat = normalizujReferrer(r.referrer);
    ref[cat] = (ref[cat] || 0) + r.pocet;
  }
  const topReferrery = Object.entries(ref)
    .map(([zdroj, pocet]) => ({ zdroj, pocet }))
    .sort((a, b) => b.pocet - a.pocet)
    .slice(0, 10);

  // časová řada s vyplněnými prázdnými body
  const podleDne = opt.jeDnes
    ? radaHodinova(s.rada || [], opt.off)
    : radaDenni(s.rada || [], opt.dny, opt.off);

  return {
    obdobiPopis: opt.jeDnes ? "dnes" : `za ${opt.dny} dní`,
    obdobiDnu: opt.jeDnes ? 0 : opt.dny,
    celkemNavstev: s.celkem || 0,
    unikatnichRelaci: s.relace || 0,
    prumernaDoba: s.prum_doba || 0,
    mobil: s.mobil || 0,
    desktop: s.desktop || 0,
    podleStranky,
    podleDne,
    topReferrery,
  };
}

function radaDenni(rada, dny, off) {
  const mapa = {};
  for (const x of rada) mapa[x.k] = x.navstev;
  const out = [];
  for (let i = dny - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000 + off).toISOString().slice(0, 10);
    out.push({ den: d, navstev: mapa[d] || 0 });
  }
  return out;
}

function radaHodinova(rada, off) {
  const mapa = {};
  for (const x of rada) mapa[x.k] = x.navstev;
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
