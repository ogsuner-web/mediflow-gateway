// Planes: precio mensual (USD), límite de pacientes y de usos de IA por mes.
// (TRIAL también define los días de prueba. El cobro real se hace en pesos: USD * USD_ARS.)
module.exports = {
  TRIAL:    { label: 'Prueba',      usd: 0,     patients: 3,   ai: 20,   trialDays: 5 },
  INICIAL:  { label: 'Inicial',     usd: 9.99,  patients: 50,  ai: 150 },
  PRO:      { label: 'Profesional', usd: 16.99, patients: 200, ai: 500 },
  AVANZADO: { label: 'Avanzado',    usd: 29.99, patients: 500, ai: 1500 },
  EXPIRED:  { label: 'Vencido',     usd: 0,     patients: 0,   ai: 0 },
};
