import { FastifyPluginAsync } from 'fastify'
import { randomBytes } from 'node:crypto'
import { pool } from '../db/client.js'
import { config } from '../config.js'
import { encrypt } from '../crypto.js'
import { exchangeZohoCode } from '../services/zoho.service.js'

const ZOHO_AUTH_URL = 'https://accounts.zoho.in/oauth/v2/auth'

const isProduction = process.env.NODE_ENV === 'production'

export const zohoRoutes: FastifyPluginAsync = async (app) => {
  // Redirect user to Zoho OAuth consent screen
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
    reply.setCookie('zoho_oauth_state', state, cookieOpts)
    reply.setCookie('pending_user_id', userId, cookieOpts)

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.ZOHO_CLIENT_ID,
      redirect_uri: config.ZOHO_REDIRECT_URI,
      scope: 'ZohoCalendar.calendar.READ,ZohoCalendar.event.READ',
      access_type: 'offline',
      state,
    })
    return reply.redirect(`${ZOHO_AUTH_URL}?${params}`)
  })

  // Zoho redirects here after user approves
  app.get<{ Querystring: { code: string; state: string } }>(
    '/callback',
    async (request, reply) => {
      const { code, state } = request.query
      const cookieState = request.cookies.zoho_oauth_state

      if (!cookieState || cookieState !== state) {
        return reply.status(400).send({ error: 'Invalid state' })
      }
      reply.clearCookie('zoho_oauth_state', { path: '/' })

      // We need the user from a short-lived cookie set before /connect
      const userCookie = request.cookies.pending_user_id
      if (!userCookie) return reply.status(401).send({ error: 'Not authenticated' })
      const userId = userCookie

      const { accessToken, refreshToken, expiresAt } = await exchangeZohoCode(code)

      // Zoho only sends refresh_token on first auth. If absent, reuse the stored one.
      let encryptedRefresh: string
      if (refreshToken) {
        encryptedRefresh = encrypt(refreshToken, config.TOKEN_ENCRYPTION_KEY)
      } else {
        const { rows: existing } = await pool.query(
          'SELECT refresh_token FROM zoho_connections WHERE user_id = $1',
          [userId]
        )
        if (!existing[0]) {
          return reply.status(400).send({
            error: 'No refresh token available. Please revoke the app in Zoho (My Account → Security → Connected Apps) and reconnect.',
          })
        }
        encryptedRefresh = existing[0].refresh_token
      }

      await pool.query(
        `INSERT INTO zoho_connections (user_id, access_token, refresh_token, token_expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
         SET access_token = $2, refresh_token = $3, token_expires_at = $4`,
        [userId, encrypt(accessToken, config.TOKEN_ENCRYPTION_KEY), encryptedRefresh, expiresAt]
      )

      reply.clearCookie('pending_user_id', { path: '/' })
      return reply.redirect(`${config.CLIENT_URL}/dashboard`)
    }
  )

  app.get('/status', { preHandler: [app.authenticate] }, async (request) => {
    const { userId } = request.user as { userId: string }
    const { rows } = await pool.query(
      'SELECT zoho_account_id FROM zoho_connections WHERE user_id = $1',
      [userId]
    )
    return { connected: rows.length > 0, accountId: rows[0]?.zoho_account_id ?? null }
  })

  app.delete('/disconnect', { preHandler: [app.authenticate] }, async (request) => {
    const { userId } = request.user as { userId: string }
    await pool.query('DELETE FROM zoho_connections WHERE user_id = $1', [userId])
    return { ok: true }
  })
}
