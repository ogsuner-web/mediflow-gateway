// Planes: límite de pacientes y de usos de IA por mes. (TRIAL también define los días de prueba.)
module.exports = {
  TRIAL:    { label: 'Prueba',      patients: 3,   ai: 20,   trialDays: 5 },
  INICIAL:  { label: 'Inicial',     patients: 50,  ai: 150 },
  PRO:      { label: 'Profesional', patients: 200, ai: 500 },
  AVANZADO: { label: 'Avanzado',    patients: 500, ai: 1500 },
  EXPIRED:  { label: 'Vencido',     patients: 0,   ai: 0 },
};
