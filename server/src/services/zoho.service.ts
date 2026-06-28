import axios from 'axios'
import { config } from '../config.js'

export interface ZohoCalendar {
  uid: string
  name: string
  isdefault: boolean
}

export interface ZohoEvent {
  uid: string
  etag: string
  title: string
  dateandtime: {
    start: string
    end: string
    timezone?: string
  }
}

const ZOHO_API = 'https://calendar.zoho.in/api/v1'
const ZOHO_TOKEN_URL = 'https://accounts.zoho.in/oauth/v2/token'

export async function fetchZohoCalendars(accessToken: string): Promise<ZohoCalendar[]> {
  const { data } = await axios.get(`${ZOHO_API}/calendars`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  })
  return data.calendars ?? []
}

export async function fetchZohoEvents(
  accessToken: string,
  from: Date,
  to: Date
): Promise<ZohoEvent[]> {
  const calendars = await fetchZohoCalendars(accessToken)
  const allEvents: ZohoEvent[] = []

  const toZohoDate = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'

  for (const calendar of calendars) {
    const range = JSON.stringify({ start: toZohoDate(from), end: toZohoDate(to) })
    const { data } = await axios.get(`${ZOHO_API}/calendars/${calendar.uid}/events`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      params: { range },
    })
    const events = (data.events ?? []).filter((e: any) => e.uid)
    allEvents.push(...events)
  }

  return allEvents
}

export async function refreshZohoToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.ZOHO_CLIENT_ID,
    client_secret: config.ZOHO_CLIENT_SECRET,
    refresh_token: refreshToken,
  })
  const { data } = await axios.post(ZOHO_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

export async function exchangeZohoCode(code: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
}> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.ZOHO_CLIENT_ID,
    client_secret: config.ZOHO_CLIENT_SECRET,
    redirect_uri: config.ZOHO_REDIRECT_URI,
    code,
  })
  const { data } = await axios.post(ZOHO_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (data.error) {
    throw new Error(`Zoho token exchange failed: ${data.error} — ${data.error_description ?? ''}`)
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}
