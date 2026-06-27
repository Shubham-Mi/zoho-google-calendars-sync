import { FastifyPluginAsync } from 'fastify'
import { PgBoss } from 'pg-boss'
import { enqueueSyncForUser } from '../jobs/sync-user.job.js'

export const syncRoutes = (boss: PgBoss): FastifyPluginAsync => async (app) => {
  app.post('/trigger', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user as { userId: string }
    const jobId = await enqueueSyncForUser(boss, userId)
    return { jobId }
  })
}
