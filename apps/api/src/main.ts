import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // 允許前端攜帶 session cookie 跨來源呼叫（SSO 需要 credentials）。
  const webOrigins = (process.env.WEB_BASE_URL ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: webOrigins, credentials: true });
  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`WFMS API listening on http://localhost:${port}`);
}

void bootstrap();
