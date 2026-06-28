import { pool } from '../db/client.js'
import { config } from '../config.js'
import { encrypt, decrypt } from '../crypto.js'
import { fetchZohoEvents, refreshZohoToken } from './zoho.service.js'
import {
  createBusyEvent,
  updateBusyEvent,
  deleteGoogleEvent,
  refreshGoogleToken,
} from './google.service.js'

async function getValidZohoToken(userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT access_token, refresh_token, token_expires_at FROM zoho_connections WHERE user_id = $1',
    [userId]
  )
  if (!rows[0]) return null

  let accessToken = decrypt(rows[0].access_token, config.TOKEN_ENCRYPTION_KEY)
  const expiresAt = new Date(rows[0].token_expires_at)

  if (expiresAt <= new Date(Date.now() + 5 * 60 * 1000)) {
    const refreshToken = decrypt(rows[0].refresh_token, config.TOKEN_ENCRYPTION_KEY)
    const refreshed = await refreshZohoToken(refreshToken)
    accessToken = refreshed.accessToken
    await pool.query(
      'UPDATE zoho_connections SET access_token = $1, token_expires_at = $2 WHERE user_id = $3',
      [encrypt(refreshed.accessToken, config.TOKEN_ENCRYPTION_KEY), refreshed.expiresAt, userId]
    )
  }

  return accessToken
}

async function getValidGoogleToken(userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT access_token, refresh_token, token_expires_at FROM google_connections WHERE user_id = $1',
    [userId]
  )
  if (!rows[0]) return null

  let accessToken = decrypt(rows[0].access_token, config.TOKEN_ENCRYPTION_KEY)
  const expiresAt = new Date(rows[0].token_expires_at)

  if (expiresAt <= new Date(Date.now() + 5 * 60 * 1000)) {
    const refreshToken = decrypt(rows[0].refresh_token, config.TOKEN_ENCRYPTION_KEY)
    const refreshed = await refreshGoogleToken(refreshToken)
    accessToken = refreshed.accessToken
    await pool.query(
      'UPDATE google_connections SET access_token = $1, token_expires_at = $2 WHERE user_id = $3',
      [encrypt(refreshed.accessToken, config.TOKEN_ENCRYPTION_KEY), refreshed.expiresAt, userId]
    )
  }

  return accessToken
}

function toIso(zohoDate: string): string {
  // UTC iCal: 20260629T110000Z → 2026-06-29T11:00:00Z
  if (/^\d{8}T\d{6}Z$/.test(zohoDate)) {
    return `${zohoDate.slice(0, 4)}-${zohoDate.slice(4, 6)}-${zohoDate.slice(6, 8)}T${zohoDate.slice(9, 11)}:${zohoDate.slice(11, 13)}:${zohoDate.slice(13, 15)}Z`
  }
  // Local iCal with offset: 20260629T110000+0530 → 2026-06-29T11:00:00+05:30
  const offsetMatch = zohoDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-])(\d{2})(\d{2})$/)
  if (offsetMatch) {
    const [, yr, mo, dy, hh, mm, ss, sign, offH, offM] = offsetMatch
    return `${yr}-${mo}-${dy}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`
  }
  return zohoDate
}

export async function syncUser(userId: string): Promise<void> {
  console.log(`[sync] starting for user ${userId}`)

  const zohoToken = await getValidZohoToken(userId)
  if (!zohoToken) { console.log('[sync] no zoho token, skipping'); return }

  const googleToken = await getValidGoogleToken(userId)
  if (!googleToken) { console.log('[sync] no google token, skipping'); return }

  const { rows: calRows } = await pool.query(
    'SELECT google_calendar_id FROM google_calendars WHERE user_id = $1 AND enabled = true',
    [userId]
  )
  if (calRows.length === 0) { console.log('[sync] no enabled calendars, skipping'); return }

  const enabledCalendarIds = calRows.map((r: any) => r.google_calendar_id)
  console.log(`[sync] enabled calendars: ${enabledCalendarIds.length}`)

  const now = new Date()
  const from = new Date(now.getTime() - 24 * 3600 * 1000)
  const to = new Date(now.getTime() + 30 * 24 * 3600 * 1000)

  let zohoEvents
  try {
    zohoEvents = await fetchZohoEvents(zohoToken, from, to)
    console.log(`[sync] fetched ${zohoEvents.length} Zoho events`)
  } catch (err: any) {
    console.error('[sync] fetchZohoEvents failed:', err.message, err.response?.data)
    return
  }
  const zohoEventMap = new Map(zohoEvents.map(e => [e.uid, e]))

  const { rows: mappingRows } = await pool.query(
    'SELECT zoho_event_id, zoho_event_etag, google_calendar_id, google_event_id FROM sync_mappings WHERE user_id = $1',
    [userId]
  )

  // Group existing mappings by zoho_event_id
  const mappingsByZohoId = new Map<string, Array<{ googleCalendarId: string; googleEventId: string; etag: string }>>()
  for (const row of mappingRows) {
    if (!mappingsByZohoId.has(row.zoho_event_id)) {
      mappingsByZohoId.set(row.zoho_event_id, [])
    }
    mappingsByZohoId.get(row.zoho_event_id)!.push({
      googleCalendarId: row.google_calendar_id,
      googleEventId: row.google_event_id,
      etag: row.zoho_event_etag,
    })
  }

  // Process each Zoho event
  for (const [zohoId, event] of zohoEventMap) {
    const start = toIso(event.dateandtime.start)
    const end = toIso(event.dateandtime.end)
    const timezone = event.dateandtime.timezone ?? 'UTC'

    const existingMappings = mappingsByZohoId.get(zohoId) ?? []
    const mappedCalendarIds = new Set(existingMappings.map(m => m.googleCalendarId))

    // CREATE: calendars that don't have a mapping yet
    for (const calId of enabledCalendarIds) {
      if (!mappedCalendarIds.has(calId)) {
        try {
          const googleEventId = await createBusyEvent(googleToken, calId, start, end, timezone)
          await pool.query(
            `INSERT INTO sync_mappings (user_id, zoho_event_id, zoho_event_etag, google_calendar_id, google_event_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, zohoId, event.etag, calId, googleEventId]
          )
          await pool.query(
            `INSERT INTO sync_history (user_id, action, zoho_event_id, zoho_event_title, google_calendar_id, synced_at)
             VALUES ($1, 'created', $2, $3, $4, NOW())`,
            [userId, zohoId, event.title, calId]
          )
        } catch (err: any) {
          console.error(`[sync] create error for ${zohoId} on ${calId}:`, err.message)
          await pool.query(
            `INSERT INTO sync_history (user_id, action, zoho_event_id, zoho_event_title, google_calendar_id, detail, synced_at)
             VALUES ($1, 'error', $2, $3, $4, $5, NOW())`,
            [userId, zohoId, event.title, calId, err.message]
          )
        }
      }
    }

    // UPDATE: existing mappings where etag changed
    for (const mapping of existingMappings) {
      if (mapping.etag !== event.etag) {
        try {
          await updateBusyEvent(googleToken, mapping.googleCalendarId, mapping.googleEventId, start, end, timezone)
          await pool.query(
            `UPDATE sync_mappings SET zoho_event_etag = $1, last_synced_at = NOW()
             WHERE user_id = $2 AND zoho_event_id = $3 AND google_calendar_id = $4`,
            [event.etag, userId, zohoId, mapping.googleCalendarId]
          )
          await pool.query(
            `INSERT INTO sync_history (user_id, action, zoho_event_id, zoho_event_title, google_calendar_id, synced_at)
             VALUES ($1, 'updated', $2, $3, $4, NOW())`,
            [userId, zohoId, event.title, mapping.googleCalendarId]
          )
        } catch (err: any) {
          await pool.query(
            `INSERT INTO sync_history (user_id, action, zoho_event_id, zoho_event_title, google_calendar_id, detail, synced_at)
             VALUES ($1, 'error', $2, $3, $4, $5, NOW())`,
            [userId, zohoId, event.title, mapping.googleCalendarId, err.message]
          )
        }
      }
    }
  }

  // DELETE: mappings for Zoho events that no longer exist
  for (const [zohoId, mappings] of mappingsByZohoId) {
    if (!zohoEventMap.has(zohoId)) {
      for (const mapping of mappings) {
        try {
          await deleteGoogleEvent(googleToken, mapping.googleCalendarId, mapping.googleEventId)
          await pool.query(
            `DELETE FROM sync_mappings WHERE user_id = $1 AND zoho_event_id = $2 AND google_calendar_id = $3`,
            [userId, zohoId, mapping.googleCalendarId]
          )
          await pool.query(
            `INSERT INTO sync_history (user_id, action, zoho_event_id, google_calendar_id, synced_at)
             VALUES ($1, 'deleted', $2, $3, NOW())`,
            [userId, zohoId, mapping.googleCalendarId]
          )
        } catch (err: any) {
          await pool.query(
            `INSERT INTO sync_history (user_id, action, zoho_event_id, google_calendar_id, detail, synced_at)
             VALUES ($1, 'error', $2, $3, $4, NOW())`,
            [userId, zohoId, mapping.googleCalendarId, err.message]
          )
        }
      }
    }
  }
}
