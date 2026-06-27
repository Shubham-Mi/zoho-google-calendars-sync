import 'dotenv/config'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { config } from './config.js'
import { authRoutes } from './routes/auth.js'
import { zohoRoutes } from './routes/zoho.js'
import { googleRoutes } from './routes/google.js'
import { calendarRoutes } from './routes/calendars.js'
import { historyRoutes } from './routes/history.js'
import { syncRoutes } from './routes/sync.js'
import { createBoss, startScheduler } from './jobs/sync-user.job.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function buildApp() {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' })

  await app.register(fastifyJwt, { secret: config.JWT_SECRET })
  await app.register(fastifyCors, { origin: true, credentials: true })
  await app.register(fastifyCookie)

  app.decorate('authenticate', async function (this: any, request: any, reply: any) {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(zohoRoutes, { prefix: '/api/zoho' })
  await app.register(googleRoutes, { prefix: '/api/google' })
  await app.register(calendarRoutes, { prefix: '/api/calendars' })
  await app.register(historyRoutes, { prefix: '/api/history' })

  // pg-boss needed for sync routes; created at startup
  if (config.NODE_ENV !== 'test') {
    const boss = await createBoss(config.DATABASE_URL)
    await app.register(syncRoutes(boss), { prefix: '/api/sync' })
    await startScheduler(boss)
  }

  // Serve React SPA in production
  if (config.NODE_ENV === 'production') {
    const clientDist = join(__dirname, '../../client/dist')
    await app.register(fastifyStatic, { root: clientDist, prefix: '/' })
    app.setNotFoundHandler((_, reply) => reply.sendFile('index.html'))
  }

  return app
}

if (process.env.NODE_ENV !== 'test') {
  const app = await buildApp()
  await app.listen({ port: parseInt(config.PORT), host: '0.0.0.0' })
}
