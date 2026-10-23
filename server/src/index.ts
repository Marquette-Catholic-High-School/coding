import { createApp } from './app';
import { purgeExpiredSessions } from './auth';
import { config } from './config';
import { db } from './db';

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 86_400_000).unref();

const onListening = () => {
  const where = `http://${config.host ?? 'localhost'}:${config.port}`;
  console.log(`CodeClass API listening on ${where}${config.isProd ? '' : ' (dev; open the Vite URL)'}`);
};
const app = createApp();
const server = config.host ? app.listen(config.port, config.host, onListening) : app.listen(config.port, onListening);

// systemd stops the service with SIGTERM: finish open requests, then close the database (which checkpoints the WAL,
// so the .db file alone is a complete copy for backups).
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
