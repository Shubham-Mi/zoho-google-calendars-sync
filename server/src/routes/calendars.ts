import { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/client.js'
import { config } from '../config.js'
import { decrypt, encrypt } from '../crypto.js'
import { fetchGoogleCalendars, refreshGoogleToken } from '../services/google.service.js'

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const { userId } = request.user as { userId: string }
    const { rows } = await pool.query(
      'SELECT google_calendar_id as id, name, enabled FROM google_calendars WHERE user_id = $1 ORDER BY name',
      [userId]
    )
    return rows
  })

  app.post<{ Params: { id: string } }>(
    '/:id/enable',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { userId } = request.user as { userId: string }
      await pool.query(
        'UPDATE google_calendars SET enabled = true WHERE user_id = $1 AND google_calendar_id = $2',
        [userId, request.params.id]
      )
      return { ok: true }
    }
  )

  app.post<{ Params: { id: string } }>(
    '/:id/disable',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { userId } = request.user as { userId: string }
      await pool.query(
        'UPDATE google_calendars SET enabled = false WHERE user_id = $1 AND google_calendar_id = $2',
        [userId, request.params.id]
      )
      return { ok: true }
    }
  )

  app.post('/refresh', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user as { userId: string }

    const { rows: connRows } = await pool.query(
      'SELECT access_token, refresh_token, token_expires_at FROM google_connections WHERE user_id = $1',
      [userId]
    )
    if (!connRows[0]) return reply.status(400).send({ error: 'Google not connected' })

    let accessToken = decrypt(connRows[0].access_token, config.TOKEN_ENCRYPTION_KEY)
    if (new Date(connRows[0].token_expires_at) <= new Date(Date.now() + 5 * 60 * 1000)) {
      const refreshToken = decrypt(connRows[0].refresh_token, config.TOKEN_ENCRYPTION_KEY)
      const refreshed = await refreshGoogleToken(refreshToken)
      accessToken = refreshed.accessToken
      await pool.query(
        'UPDATE google_connections SET access_token = $1, token_expires_at = $2 WHERE user_id = $3',
        [encrypt(refreshed.accessToken, config.TOKEN_ENCRYPTION_KEY), refreshed.expiresAt, userId]
      )
    }

    const calendars = await fetchGoogleCalendars(accessToken)
    for (const cal of calendars) {
      await pool.query(
        `INSERT INTO google_calendars (user_id, google_calendar_id, name, enabled)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (user_id, google_calendar_id) DO UPDATE SET name = $3`,
        [userId, cal.id, cal.summary]
      )
    }

    return { count: calendars.length }
  })
}
