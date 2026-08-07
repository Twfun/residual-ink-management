import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { NextFunction, Request, Response } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: { origin: true, credentials: false } });
  app.setGlobalPrefix('api');
  // The desktop WebView caches GET responses and revalidates with conditional
  // requests; a 304 is not `response.ok` and silently broke the fetch wrapper.
  // The API is local and cheap, so always answer with a fresh 200 payload.
  app.getHttpAdapter().getInstance().set('etag', false);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));
  // Request log: stdout/stderr are captured by the desktop launcher into
  // logs/residual-ink-api.log, so every API call leaves a trace there.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      console.log(
        '' +
          new Date().toISOString() +
          ' [http] ' +
          req.method +
          ' ' +
          req.originalUrl +
          ' -> ' +
          res.statusCode +
          ' ' +
          (Date.now() - started) +
          'ms',
      );
    });
    next();
  });
  await app.listen(Number(process.env.RIM_API_PORT || 39080), '127.0.0.1');
}
void bootstrap();
