require('dotenv/config');
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const PLANS = require('./plans');
const { geminiGenerate } = require('./ai');
const mp = require('./mp');

const prisma = new PrismaClient();
const app = express();
app.use(express.json({ limit: '25mb' }));
const PORT = process.env.PORT || 4000;

process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

const yearMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Estado (plan efectivo, días de prueba, uso y límites) de una instalación.
async function statusOf(inst) {
  let effectivePlan = inst.plan;
  let trialDaysLeft = null;
  if (inst.plan === 'TRIAL') {
    const end = new Date(inst.trialStart.getTime() + PLANS.TRIAL.trialDays * 86400000);
    trialDaysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
    if (Date.now() > end) effectivePlan = 'EXPIRED';
  }
  const limits = PLANS[effectivePlan] || PLANS.EXPIRED;
  const usage = await prisma.usageMonth.findUnique({
    where: { installationId_yearMonth: { installationId: inst.id, yearMonth: yearMonth() } },
  });
  const aiLimit = limits.ai + (usage?.extraAi || 0);
  return {
    plan: inst.plan,
    effectivePlan,
    active: inst.active && effectivePlan !== 'EXPIRED',
    trialDaysLeft,
    patientLimit: limits.patients,
    aiLimit,
    aiUsed: usage?.aiCount || 0,
    aiLeft: Math.max(0, aiLimit - (usage?.aiCount || 0)),
    latestVersion: process.env.LATEST_VERSION || null, // para avisar en la app si hay update
  };
}

const validId = (id) => typeof id === 'string' && /^[0-9a-fA-F-]{10,80}$/.test(id);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'mediflow-gateway' }));

// El cliente se registra al instalar. Si es nuevo, arranca la prueba (fecha del lado del servidor).
app.post('/api/register', async (req, res) => {
  const id = req.body?.installationId;
  if (!validId(id)) return res.status(400).json({ error: 'installationId inválido' });
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.slice(0, 200) : undefined;
    const inst = await prisma.installation.upsert({ where: { id }, update: email ? { email } : {}, create: { id, email } });
    res.json(await statusOf(inst));
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo registrar' }); }
});

// El cliente pregunta su estado al arrancar / cada tanto.
app.get('/api/status', async (req, res) => {
  const id = req.query.installationId;
  if (!validId(id)) return res.status(400).json({ error: 'installationId inválido' });
  const inst = await prisma.installation.findUnique({ where: { id: String(id) } });
  if (!inst) return res.status(404).json({ error: 'No registrado' });
  res.json(await statusOf(inst));
});

// Proxy de IA con cuota. El cliente NO tiene la clave de Gemini: pasa por acá.
app.post('/api/ai', async (req, res) => {
  const { installationId, parts } = req.body || {};
  if (!validId(installationId)) return res.status(400).json({ error: 'installationId inválido' });
  if (!parts) return res.status(400).json({ error: 'Falta el contenido para la IA' });
  const inst = await prisma.installation.findUnique({ where: { id: String(installationId) } });
  if (!inst) return res.status(404).json({ error: 'No registrado' });
  const st = await statusOf(inst);
  if (!st.active) return res.status(403).json({ error: 'Suscripción vencida o inactiva', status: st });
  if (st.aiUsed >= st.aiLimit) return res.status(429).json({ error: 'Llegaste al límite de IA de este mes', status: st });

  let text;
  try { text = await geminiGenerate(parts); }
  catch (e) { console.error('[ai]', e.message); return res.status(502).json({ error: 'La IA no respondió, reintentá' }); }

  await prisma.usageMonth.upsert({
    where: { installationId_yearMonth: { installationId: inst.id, yearMonth: yearMonth() } },
    update: { aiCount: { increment: 1 } },
    create: { installationId: inst.id, yearMonth: yearMonth(), aiCount: 1 },
  });
  const after = await statusOf(inst);
  res.json({ text, aiLeft: after.aiLeft });
});

// --- Mercado Pago (suscripciones) ---
// Config necesaria en el entorno del gateway: MP_ACCESS_TOKEN y USD_ARS (ver src/mp.js).

const PAID_PLANS = ['INICIAL', 'PRO', 'AVANZADO'];

// Crea el link de suscripción para una instalación. Devuelve { initPoint } para abrir el checkout.
app.post('/api/subscribe', async (req, res) => {
  const { installationId, plan, email } = req.body || {};
  if (!validId(installationId)) return res.status(400).json({ error: 'installationId inválido' });
  if (!PAID_PLANS.includes(plan)) return res.status(400).json({ error: 'Plan inválido' });
  const cfg = mp.mpConfigured();
  if (!cfg.token) return res.status(503).json({ error: 'Pagos no configurados (falta MP_ACCESS_TOKEN)' });
  if (!cfg.rate) return res.status(503).json({ error: 'Falta la cotización USD_ARS en el gateway' });
  try {
    // La instalación tiene que existir (se registró al instalar). Si no, la creamos.
    await prisma.installation.upsert({ where: { id: installationId }, update: email ? { email } : {}, create: { id: installationId, email } });
    const { id, initPoint, amount } = await mp.createPreapproval({ installationId, planKey: plan, plan: PLANS[plan], email });
    res.json({ initPoint, preapprovalId: id, amountArs: amount });
  } catch (e) {
    console.error('[subscribe]', e.message, e.body || '');
    res.status(502).json({ error: 'No se pudo crear la suscripción en Mercado Pago' });
  }
});

// Página puente: redirige directo al checkout de MP (para linkear desde la app o la web).
// Uso: /subscribe?installationId=...&plan=PRO&email=...
app.get('/subscribe', async (req, res) => {
  const { installationId, plan, email } = req.query;
  if (!validId(installationId) || !PAID_PLANS.includes(String(plan))) return res.status(400).send('Datos inválidos');
  const cfg = mp.mpConfigured();
  if (!cfg.token || !cfg.rate) return res.status(503).send('Pagos no configurados todavía.');
  try {
    await prisma.installation.upsert({ where: { id: String(installationId) }, update: email ? { email: String(email) } : {}, create: { id: String(installationId), email: email ? String(email) : undefined } });
    const { initPoint } = await mp.createPreapproval({ installationId: String(installationId), planKey: String(plan), plan: PLANS[String(plan)], email: email ? String(email) : undefined });
    res.redirect(302, initPoint);
  } catch (e) {
    console.error('[subscribe-redirect]', e.message);
    res.status(502).send('No se pudo iniciar el pago, reintentá en un momento.');
  }
});

// Reconcilia una suscripción contra MP y actualiza el plan de la instalación.
async function reconcilePreapproval(preapprovalId) {
  const pre = await mp.getPreapproval(preapprovalId);
  const ref = String(pre.external_reference || '');
  const [installationId, planKey] = ref.split('|');
  if (!validId(installationId) || !PAID_PLANS.includes(planKey)) return;
  const inst = await prisma.installation.findUnique({ where: { id: installationId } });
  if (!inst) return;
  // authorized = suscripción activa; cualquier otro estado la deja sin plan pago.
  if (pre.status === 'authorized') {
    await prisma.installation.update({ where: { id: installationId }, data: { plan: planKey, active: true, mpPreapprovalId: preapprovalId } });
    console.log(`[mp] ${installationId} -> plan ${planKey} (authorized)`);
  } else if (['cancelled', 'paused'].includes(pre.status)) {
    await prisma.installation.update({ where: { id: installationId }, data: { plan: 'EXPIRED', active: false } });
    console.log(`[mp] ${installationId} -> EXPIRED (${pre.status})`);
  }
}

// Webhook de MP: avisa cambios de pago/suscripción. Respondemos 200 rápido y verificamos contra MP.
app.post('/api/mp/webhook', async (req, res) => {
  res.sendStatus(200); // MP reintenta si no recibe 200 pronto
  try {
    const type = req.body?.type || req.query?.type || req.query?.topic || '';
    const id = req.body?.data?.id || req.query?.id || req.query?.['data.id'];
    if (String(type).includes('preapproval') && id) await reconcilePreapproval(String(id));
  } catch (e) { console.error('[mp-webhook]', e.message); }
});

app.listen(PORT, () => console.log(`[gateway] escuchando en http://localhost:${PORT}`));
