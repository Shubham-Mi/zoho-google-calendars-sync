import 'dotenv/config'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyCookie from '@fastify/cookie'
import { config } from './config.js'
import { authRoutes } from './routes/auth.js'
import { zohoRoutes } from './routes/zoho.js'
import { googleRoutes } from './routes/google.js'

export async function buildApp() {
  const app = Fastify({ logger: true })

  await app.register(fastifyJwt, { secret: config.JWT_SECRET })
  await app.register(fastifyCors, { origin: true, credentials: true })
  await app.register(fastifyCookie)

  app.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(zohoRoutes, { prefix: '/api/zoho' })
  await app.register(googleRoutes, { prefix: '/api/google' })

  return app
}

if (process.env.NODE_ENV !== 'test') {
  const app = await buildApp()
  await app.listen({ port: parseInt(config.PORT), host: '0.0.0.0' })
}
