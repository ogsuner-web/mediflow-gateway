require('dotenv/config');
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const PLANS = require('./plans');
const { geminiGenerate } = require('./ai');

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

// --- Mercado Pago (se completa con las credenciales del usuario) ---
// POST /api/mp/webhook  -> recibe el aviso de pago/suscripción y activa el plan.
// POST /api/subscribe   -> crea el link de suscripción (preapproval).
// (Pendiente: requiere MP_ACCESS_TOKEN en el .env del gateway.)

app.listen(PORT, () => console.log(`[gateway] escuchando en http://localhost:${PORT}`));
