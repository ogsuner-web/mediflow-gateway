// Integración con Mercado Pago — Suscripciones (API de Preapproval).
// No usa SDK: habla con la API REST de MP con fetch (Node 20+).
//
// Config por variables de entorno (en Railway):
//   MP_ACCESS_TOKEN  -> token de la cuenta de MP (TEST-... para pruebas, APP_USR-... para producción)
//   USD_ARS          -> cotización USD→ARS del día (MP Argentina cobra en pesos). Obligatoria.
//   MP_CURRENCY      -> moneda (default "ARS")
//   WEB_URL          -> sitio público, para la vuelta post-pago (default la web de Netlify)

const MP_API = 'https://api.mercadopago.com';
const TOKEN = () => process.env.MP_ACCESS_TOKEN || '';
const CURRENCY = () => process.env.MP_CURRENCY || 'ARS';
const RATE = () => Number(process.env.USD_ARS || 0);
const WEB = () => (process.env.WEB_URL || 'https://mediflow-med.netlify.app').replace(/\/$/, '');

function mpConfigured() {
  return { token: !!TOKEN(), rate: RATE() > 0 };
}

// Monto mensual en la moneda de cobro, a partir del precio en USD del plan.
function monthlyAmount(plan) {
  return Math.round((plan.usd || 0) * RATE());
}

async function mpFetch(path, options = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.message || body?.error || `MP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Crea una suscripción (preapproval) y devuelve el link de checkout (init_point).
// external_reference = "<installationId>|<PLAN>" para reconciliar en el webhook.
async function createPreapproval({ installationId, planKey, plan, email }) {
  const amount = monthlyAmount(plan);
  const payload = {
    reason: `MediFlow ${plan.label}`,
    external_reference: `${installationId}|${planKey}`,
    payer_email: email || undefined,
    back_url: `${WEB()}/gracias.html`,
    status: 'pending',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: amount,
      currency_id: CURRENCY(),
    },
  };
  const pre = await mpFetch('/preapproval', { method: 'POST', body: JSON.stringify(payload) });
  return { id: pre.id, initPoint: pre.init_point || pre.sandbox_init_point, amount };
}

// Lee el estado de una suscripción en MP. status: "pending" | "authorized" | "paused" | "cancelled".
async function getPreapproval(id) {
  return mpFetch(`/preapproval/${encodeURIComponent(id)}`);
}

module.exports = { mpConfigured, monthlyAmount, createPreapproval, getPreapproval };
