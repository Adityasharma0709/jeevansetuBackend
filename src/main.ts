import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: 'https://www.jeevansetu.org', // allowed origins (reflects request origin)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger setup MUST be before listen()
  const config = new DocumentBuilder()
    .setTitle('Jeevan Setu API')
    .setDescription('Backend APIs')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Listen should ALWAYS be last
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`Application is running on: ${port}`, 'Bootstrap');
  Logger.log(`Swagger UI is available at: ${port}/api`, 'Bootstrap');
}

bootstrap();