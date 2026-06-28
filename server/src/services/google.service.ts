import axios from 'axios'
import { config } from '../config.js'

export interface GoogleCalendar {
  id: string
  summary: string
}

const GOOGLE_API = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

export async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  try {
    const { data } = await axios.get(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return data.email ?? null
  } catch {
    return null
  }
}

function authHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` }
}

export async function fetchGoogleCalendars(accessToken: string): Promise<GoogleCalendar[]> {
  const { data } = await axios.get(`${GOOGLE_API}/users/me/calendarList`, {
    headers: authHeader(accessToken),
  })
  return (data.items ?? []).map((c: any) => ({ id: c.id, summary: c.summary }))
}

export async function createBusyEvent(
  accessToken: string,
  calendarId: string,
  start: string,
  end: string,
  timezone: string
): Promise<string> {
  const { data } = await axios.post(
    `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      summary: 'Busy',
      transparency: 'opaque',
      start: { dateTime: start, timeZone: timezone },
      end: { dateTime: end, timeZone: timezone },
    },
    { headers: authHeader(accessToken) }
  )
  return data.id
}

export async function updateBusyEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  start: string,
  end: string,
  timezone: string
): Promise<void> {
  await axios.put(
    `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      summary: 'Busy',
      transparency: 'opaque',
      start: { dateTime: start, timeZone: timezone },
      end: { dateTime: end, timeZone: timezone },
    },
    { headers: authHeader(accessToken) }
  )
}

export async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await axios.delete(
    `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: authHeader(accessToken) }
  )
}

export async function refreshGoogleToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
  })
  const { data } = await axios.post(GOOGLE_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

export async function exchangeGoogleCode(code: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
}> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    code,
  })
  const { data } = await axios.post(GOOGLE_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}
