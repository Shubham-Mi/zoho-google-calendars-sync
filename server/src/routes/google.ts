import { FastifyPluginAsync } from 'fastify'
import { randomBytes } from 'node:crypto'
import { pool } from '../db/client.js'
import { config } from '../config.js'
import { encrypt } from '../crypto.js'
import { exchangeGoogleCode, fetchGoogleCalendars } from '../services/google.service.js'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

const isProduction = process.env.NODE_ENV === 'production'

export const googleRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { token?: string } }>('/connect', async (request, reply) => {
    const token = request.query.token
    if (!token) return reply.status(401).send({ error: 'Unauthorized' })
    let userId: string
    try {
      const payload = app.jwt.verify(token) as { userId: string }
      userId = payload.userId
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const state = randomBytes(16).toString('hex')
    const cookieOpts = { httpOnly: true, path: '/', maxAge: 600, secure: isProduction, sameSite: 'lax' as const }
    reply.setCookie('google_oauth_state', state, cookieOpts)
    reply.setCookie('pending_user_id', userId, cookieOpts)

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params}`)
  })

  app.get<{ Querystring: { code: string; state: string } }>(
    '/callback',
    async (request, reply) => {
      const { code, state } = request.query
      const cookieState = request.cookies.google_oauth_state
      const userId = request.cookies.pending_user_id

      if (!cookieState || cookieState !== state) {
        return reply.status(400).send({ error: 'Invalid state' })
      }
      if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

      reply.clearCookie('google_oauth_state', { path: '/' })
      reply.clearCookie('pending_user_id', { path: '/' })

      const { accessToken, refreshToken, expiresAt } = await exchangeGoogleCode(code)

      await pool.query(
        `INSERT INTO google_connections (user_id, access_token, refresh_token, token_expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
         SET access_token = $2, refresh_token = $3, token_expires_at = $4`,
        [userId, encrypt(accessToken, config.TOKEN_ENCRYPTION_KEY),
         encrypt(refreshToken, config.TOKEN_ENCRYPTION_KEY), expiresAt]
      )

      // Fetch and store all of the user's Google Calendars (all enabled by default)
      const calendars = await fetchGoogleCalendars(accessToken)
      for (const cal of calendars) {
        await pool.query(
          `INSERT INTO google_calendars (user_id, google_calendar_id, name, enabled)
           VALUES ($1, $2, $3, true)
           ON CONFLICT (user_id, google_calendar_id) DO UPDATE SET name = $3`,
          [userId, cal.id, cal.summary]
        )
      }

      return reply.redirect('/dashboard')
    }
  )

  app.get('/status', { preHandler: [app.authenticate] }, async (request) => {
    const { userId } = request.user as { userId: string }
    const { rows } = await pool.query(
      'SELECT id FROM google_connections WHERE user_id = $1',
      [userId]
    )
    return { connected: rows.length > 0 }
  })

  app.delete('/disconnect', { preHandler: [app.authenticate] }, async (request) => {
    const { userId } = request.user as { userId: string }
    await pool.query('DELETE FROM google_connections WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM google_calendars WHERE user_id = $1', [userId])
    return { ok: true }
  })
}
