import { createApp } from './app';
import { purgeExpiredSessions } from './auth';
import { config } from './config';

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 86_400_000).unref();

createApp().listen(config.port, () => {
  console.log(`CodeClass API listening on http://localhost:${config.port}${config.isProd ? '' : ' (dev; open the Vite URL)'}`);
});
