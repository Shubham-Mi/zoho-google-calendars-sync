import { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/client.js'

interface HistoryQuery {
  page?: string
  limit?: string
  action?: string
}

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: HistoryQuery }>('/', { preHandler: [app.authenticate] }, async (request) => {
    const { userId } = request.user as { userId: string }
    const page = Math.max(1, parseInt(request.query.page ?? '1'))
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '50')))
    const offset = (page - 1) * limit
    const action = request.query.action

    const params: any[] = [userId, limit, offset]
    if (action) params.push(action)
    const actionFilter = action ? `AND action = $${params.length}` : ''

    const { rows: items } = await pool.query(
      `SELECT id, action, zoho_event_id, zoho_event_title, google_calendar_id, detail, synced_at
       FROM sync_history
       WHERE user_id = $1 ${actionFilter}
       ORDER BY synced_at DESC
       LIMIT $2 OFFSET $3`,
      params
    )

    const countParams: any[] = [userId]
    if (action) countParams.push(action)
    const countActionFilter = action ? `AND action = $${countParams.length}` : ''
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM sync_history WHERE user_id = $1 ${countActionFilter}`,
      countParams
    )

    return { items, total: parseInt(countRows[0].total), page }
  })
}
