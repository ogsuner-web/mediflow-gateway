# MediFlow Gateway

Servidor de licencias + cuota de IA (+ pagos de Mercado Pago, en camino) para MediFlow.

## Desplegar en Railway

1. Subí esta carpeta a un repositorio de **GitHub** (público o privado).
2. En Railway: **New Project → Deploy from GitHub repo** → elegí este repo.
3. Agregá un **Volume** al servicio (para que los datos no se borren):
   - Settings del servicio → **Volumes** → New Volume → Mount path: `/data`
4. En **Variables** del servicio, agregá:
   - `GEMINI_API_KEY` = tu clave de Google Gemini
   - `DATABASE_URL` = `file:/data/gateway.db`
   - (el `PORT` lo pone Railway solo)
5. Railway instala, genera la base y arranca (`npm start`). Cuando esté verde, tu gateway
   queda en una URL tipo `https://tu-proyecto.up.railway.app`.

## Probar
- `GET /api/health` → `{ ok: true }`
- `POST /api/register` `{ "installationId": "<uuid>" }`
- `GET /api/status?installationId=<uuid>`
- `POST /api/ai` `{ "installationId": "<uuid>", "parts": "texto" }`

## Mercado Pago (suscripciones)

Endpoints: `POST /api/subscribe` (crea el link de pago), `GET /subscribe` (puente que redirige al checkout) y `POST /api/mp/webhook` (MP avisa y se activa el plan).

Para activarlo, en **Variables** de Railway agregá:
- `MP_ACCESS_TOKEN` = token de tu cuenta de MP (`TEST-...` para pruebas, `APP_USR-...` en producción)
- `USD_ARS` = cotización del día (los planes están en USD, MP cobra en pesos)
- `WEB_URL` = `https://mediflow-med.netlify.app` (opcional)

Después, en el panel de Mercado Pago (tu aplicación → Webhooks/Notificaciones), configurá la URL:
`https://mediflow-gateway-production.up.railway.app/api/mp/webhook` y suscribite al evento de **suscripciones (preapproval)**.

## Pendiente
- Botón "Suscribirme" en la app MediFlow (que llame a `/api/subscribe` con su installationId).
- Panel de administración de planes/instalaciones.
