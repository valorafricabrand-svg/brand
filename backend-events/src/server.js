require('dotenv').config();
const { createApp, initializeAdmin } = require('./app');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must contain at least 32 characters.');
  process.exit(1);
}

try {
  initializeAdmin();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const port = Number(process.env.PORT || 4001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be a valid TCP port.');
  process.exit(1);
}

const app = createApp();
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Valor Africa event service listening on port ${port}.`);
  console.log(`M-Pesa checkout: ${require('./mpesa').isConfigured() ? 'enabled' : 'disabled until Daraja credentials and HTTPS callback are configured'}.`);
});

function shutdown(signal) {
  console.log(`${signal} received; closing event service.`);
  server.close(() => {
    require('./db').close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
