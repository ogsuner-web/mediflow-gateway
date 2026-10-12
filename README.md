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

## Pendiente
- Integración de Mercado Pago (suscripción + webhook).
- Conectar MediFlow (la app) para que pida la IA a este gateway.
