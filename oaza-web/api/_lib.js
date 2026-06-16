// _lib.js — sdílené pomocné funkce pro systém akcí Oázy
// (soubory s podtržítkem Vercel neroutuje jako endpoint)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

// Bankovní účty (stejné jako u pyramid)
const BANKY = {
  czk: {
    iban: 'CZ1655000000008159854004',
    bic: 'RZBCCZPP',
    cislo: '8159854004/5500',
    banka: 'Raiffeisenbank',
  },
  eur: {
    iban: 'CZ1820100000002500144501',
    bic: 'FIOBCZPPXXX',
    cislo: 'IBAN CZ1820100000002500144501',
    banka: 'Fio banka',
  },
};

const PRIJEMCE = 'Lukas Hudecek';
const SENDER = { name: 'Oáza Adamanthea', email: 'info@oaza-adamanthea.cz' };
const ADMIN_EMAIL = 'oaza.adamanthea@gmail.com';

// Odstraní diakritiku a hvězdičky (kvůli SPAYD i bezpečnosti)
function asciiClean(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\*/g, ' ')
    .trim();
}

// --- Supabase REST -------------------------------------------------
async function supaRest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

// Nahraje binární soubor do Storage bucketu "akce" a vrátí veřejnou URL
async function supaUpload(pathInBucket, buffer, contentType) {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/akce/${pathInBucket}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: buffer,
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Storage upload ${res.status}: ${t}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/akce/${pathInBucket}`;
}

// --- SPAYD platební řetězec ---------------------------------------
function spayd({ mena, amount, vs, msg }) {
  const b = BANKY[mena];
  const parts = [
    'SPD', '1.0',
    `ACC:${b.iban}+${b.bic}`,
    `AM:${Number(amount).toFixed(2)}`,
    `CC:${mena.toUpperCase()}`,
    `X-VS:${vs}`,
  ];
  if (msg) parts.push(`MSG:${asciiClean(msg).slice(0, 60)}`);
  parts.push(`RN:${PRIJEMCE}`);
  return parts.join('*');
}

// --- Brevo transakční e-mail --------------------------------------
async function brevoSend({ to, toName, subject, html, bcc }) {
  const body = {
    sender: SENDER,
    to: [{ email: to, name: toName || to }],
    subject,
    htmlContent: html,
  };
  if (bcc) body.bcc = [{ email: bcc }];
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Brevo ${res.status}: ${t}`);
  }
  return res.json();
}

// Jednoduchý CORS / preflight helper
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = {
  SUPABASE_URL, SERVICE_KEY, BREVO_API_KEY,
  BANKY, PRIJEMCE, SENDER, ADMIN_EMAIL,
  asciiClean, supaRest, supaUpload, spayd, brevoSend, cors,
};
