import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/client.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../crypto.js', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace('enc:', '')),
}))
vi.mock('../config.js', () => ({
  config: { TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) },
}))
vi.mock('../services/zoho.service.js', () => ({
  fetchZohoEvents: vi.fn(),
  refreshZohoToken: vi.fn(),
}))
vi.mock('../services/google.service.js', () => ({
  createBusyEvent: vi.fn(),
  updateBusyEvent: vi.fn(),
  deleteGoogleEvent: vi.fn(),
  refreshGoogleToken: vi.fn(),
}))

import { pool } from '../db/client.js'
import { fetchZohoEvents, refreshZohoToken } from '../services/zoho.service.js'
import { createBusyEvent, updateBusyEvent, deleteGoogleEvent } from '../services/google.service.js'
import { syncUser } from '../services/sync-engine.js'

const mockQuery = pool.query as ReturnType<typeof vi.fn>
const mockFetchZoho = fetchZohoEvents as ReturnType<typeof vi.fn>
const mockCreate = createBusyEvent as ReturnType<typeof vi.fn>
const mockUpdate = updateBusyEvent as ReturnType<typeof vi.fn>
const mockDelete = deleteGoogleEvent as ReturnType<typeof vi.fn>

const USER_ID = 'user-123'
const FUTURE = new Date(Date.now() + 3600 * 1000).toISOString()

function makeZohoEvent(uid: string, etag: string) {
  return {
    uid,
    etag,
    title: 'Test Event',
    dateandtime: { start: FUTURE, end: FUTURE, timezone: 'UTC' },
  }
}

function setupDb(zohoConn: any, googleConn: any, calendars: any[], mappings: any[]) {
  mockQuery
    .mockResolvedValueOnce({ rows: zohoConn ? [zohoConn] : [] })   // zoho_connections
    .mockResolvedValueOnce({ rows: googleConn ? [googleConn] : [] }) // google_connections
    .mockResolvedValueOnce({ rows: calendars })                       // enabled google_calendars
    .mockResolvedValueOnce({ rows: mappings })                        // sync_mappings
}

const ZOHO_CONN = {
  access_token: 'enc:zoho-token',
  refresh_token: 'enc:zoho-refresh',
  token_expires_at: new Date(Date.now() + 3600 * 1000),
}
const GOOGLE_CONN = {
  access_token: 'enc:google-token',
  refresh_token: 'enc:google-refresh',
  token_expires_at: new Date(Date.now() + 3600 * 1000),
}
const CALENDAR = { google_calendar_id: 'cal-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue({ rows: [] }) // safe default
})

describe('syncUser', () => {
  it('creates busy block for new Zoho events', async () => {
    setupDb(ZOHO_CONN, GOOGLE_CONN, [CALENDAR], [])
    mockFetchZoho.mockResolvedValueOnce([makeZohoEvent('evt-1', 'etag-1')])
    mockCreate.mockResolvedValueOnce('g-event-1')

    await syncUser(USER_ID)

    expect(mockCreate).toHaveBeenCalledWith('google-token', 'cal-1', FUTURE, FUTURE, 'UTC')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sync_mappings'),
      expect.arrayContaining([USER_ID, 'evt-1', 'etag-1', 'cal-1', 'g-event-1'])
    )
  })

  it('updates busy block when Zoho event etag changes', async () => {
    const mapping = { zoho_event_id: 'evt-1', zoho_event_etag: 'old-etag', google_calendar_id: 'cal-1', google_event_id: 'g-event-1' }
    setupDb(ZOHO_CONN, GOOGLE_CONN, [CALENDAR], [mapping])
    mockFetchZoho.mockResolvedValueOnce([makeZohoEvent('evt-1', 'new-etag')])

    await syncUser(USER_ID)

    expect(mockUpdate).toHaveBeenCalledWith('google-token', 'cal-1', 'g-event-1', FUTURE, FUTURE, 'UTC')
  })

  it('skips update when etag is unchanged', async () => {
    const mapping = { zoho_event_id: 'evt-1', zoho_event_etag: 'same-etag', google_calendar_id: 'cal-1', google_event_id: 'g-event-1' }
    setupDb(ZOHO_CONN, GOOGLE_CONN, [CALENDAR], [mapping])
    mockFetchZoho.mockResolvedValueOnce([makeZohoEvent('evt-1', 'same-etag')])

    await syncUser(USER_ID)

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('deletes Google event when Zoho event is gone', async () => {
    const mapping = { zoho_event_id: 'evt-deleted', zoho_event_etag: 'old', google_calendar_id: 'cal-1', google_event_id: 'g-event-del' }
    setupDb(ZOHO_CONN, GOOGLE_CONN, [CALENDAR], [mapping])
    mockFetchZoho.mockResolvedValueOnce([]) // no Zoho events

    await syncUser(USER_ID)

    expect(mockDelete).toHaveBeenCalledWith('google-token', 'cal-1', 'g-event-del')
  })

  it('skips sync if Zoho not connected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }) // no zoho connection
    await syncUser(USER_ID)
    expect(mockFetchZoho).not.toHaveBeenCalled()
  })

  it('creates busy blocks on newly enabled calendar for existing events', async () => {
    const existingMapping = {
      zoho_event_id: 'evt-1', zoho_event_etag: 'etag-1',
      google_calendar_id: 'cal-1', google_event_id: 'g-1',
    }
    // Two calendars enabled, but only one mapped
    setupDb(ZOHO_CONN, GOOGLE_CONN, [CALENDAR, { google_calendar_id: 'cal-2' }], [existingMapping])
    mockFetchZoho.mockResolvedValueOnce([makeZohoEvent('evt-1', 'etag-1')])
    mockCreate.mockResolvedValueOnce('g-new')

    await syncUser(USER_ID)

    expect(mockCreate).toHaveBeenCalledWith('google-token', 'cal-2', FUTURE, FUTURE, 'UTC')
  })
})
