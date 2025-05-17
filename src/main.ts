import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: 'http://localhost:3000', credentials: true });
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(4000);
  console.log(`Server running at http://localhost:4000`);
}
bootstrap();