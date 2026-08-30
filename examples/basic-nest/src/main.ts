import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { AppModule } from './app.module'
import { runManagedBootstrap } from 'vite-kit/runtime'

export async function createApp() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter())
  app.enableShutdownHooks()
  return app
}

export async function start() {
  const app = await createApp()
  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1')
  return app
}

void runManagedBootstrap(start)
