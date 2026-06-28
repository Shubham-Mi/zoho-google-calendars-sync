import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Switch } from '../components/ui/switch'
import { Label } from '../components/ui/label'
import { Separator } from '../components/ui/separator'
import { Progress } from '../components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

interface CalendarItem {
  id: string
  name: string
  enabled: boolean
}

type SyncState = 'idle' | 'syncing' | 'done'

export function Dashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [progress, setProgress] = useState(0)
  const syncStartedAt = useRef<number | null>(null)
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Animate progress 0→85% over ~8s while syncing
  useEffect(() => {
    if (syncState === 'syncing') {
      setProgress(0)
      progressInterval.current = setInterval(() => {
        setProgress(p => {
          if (p >= 85) {
            clearInterval(progressInterval.current!)
            return 85
          }
          return p + 2
        })
      }, 200)
      return () => clearInterval(progressInterval.current!)
    }
    if (syncState === 'done') {
      clearInterval(progressInterval.current!)
      setProgress(100)
      const t = setTimeout(() => {
        setSyncState('idle')
        setProgress(0)
        qc.invalidateQueries({ queryKey: ['history'] })
      }, 1800)
      return () => clearTimeout(t)
    }
  }, [syncState, qc])

  // Poll history to detect sync completion.
  // If new history entries appear → changes were made, complete.
  // If no new entries after first poll → no changes, complete immediately.
  useEffect(() => {
    if (syncState !== 'syncing') return

    const complete = (reason: string) => {
      clearInterval(pollInterval.current!)
      console.log(`[sync] ${reason}`)
      setSyncState('done')
    }

    let firstPoll = true

    // Wait 2s before first poll to give the job time to run
    const initialDelay = setTimeout(() => {
      pollInterval.current = setInterval(async () => {
        try {
          const { data } = await api.get('/history?page=1&limit=5')
          const hasNewEntry = data.items?.length > 0 &&
            syncStartedAt.current &&
            new Date(data.items[0].synced_at).getTime() >= syncStartedAt.current

          if (hasNewEntry) {
            complete('changes detected')
          } else if (firstPoll) {
            firstPoll = false
            // No new entries on first check → sync ran with no changes
            complete('no changes detected')
          }
        } catch { /* ignore poll errors */ }
      }, 1500)
    }, 2000)

    return () => {
      clearTimeout(initialDelay)
      clearInterval(pollInterval.current!)
    }
  }, [syncState])

  const { data: zohoStatus } = useQuery({
    queryKey: ['zoho-status'],
    queryFn: () => api.get('/zoho/status').then(r => r.data),
  })

  const { data: googleStatus } = useQuery({
    queryKey: ['google-status'],
    queryFn: () => api.get('/google/status').then(r => r.data),
  })

  const { data: calendars = [] } = useQuery<CalendarItem[]>({
    queryKey: ['calendars'],
    queryFn: () => api.get('/calendars').then(r => r.data),
    enabled: !!googleStatus?.connected,
  })

  const toggleCalendar = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.post(`/calendars/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendars'] }),
  })

  const refreshCalendars = useMutation({
    mutationFn: () => api.post('/calendars/refresh'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendars'] }),
  })

  const triggerSync = useMutation({
    mutationFn: () => api.post('/sync/trigger'),
    onSuccess: () => {
      syncStartedAt.current = Date.now()
      setSyncState('syncing')
    },
  })

  const disconnectZoho = useMutation({
    mutationFn: () => api.delete('/zoho/disconnect'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zoho-status'] }),
  })

  const disconnectGoogle = useMutation({
    mutationFn: () => api.delete('/google/disconnect'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['google-status'] })
      qc.invalidateQueries({ queryKey: ['calendars'] })
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Sync progress dialog */}
      <Dialog open={syncState !== 'idle'} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-sm" onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>
              {syncState === 'done' ? 'Sync complete' : 'Syncing in progress'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {syncState === 'done' ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <CheckCircle2 className="text-green-500" size={40} />
                <p className="text-sm text-muted-foreground">Your calendars are up to date.</p>
              </div>
            ) : (
              <>
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-center text-muted-foreground">
                  Fetching events from Zoho and updating Google Calendar…
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Connections */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connections</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">Zoho Calendar</span>
              <Badge variant={zohoStatus?.connected ? 'default' : 'secondary'}>
                {zohoStatus?.connected ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
            {zohoStatus?.connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnectZoho.mutate()}
                disabled={disconnectZoho.isPending}
              >
                Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={() => {
                const token = localStorage.getItem('token')
                window.location.href = `/api/zoho/connect?token=${encodeURIComponent(token ?? '')}`
              }}>
                Connect Zoho
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">Google Account</span>
              <Badge variant={googleStatus?.connected ? 'default' : 'secondary'}>
                {googleStatus?.connected ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
            {googleStatus?.connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnectGoogle.mutate()}
                disabled={disconnectGoogle.isPending}
              >
                Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={() => {
                const token = localStorage.getItem('token')
                window.location.href = `/api/google/connect?token=${encodeURIComponent(token ?? '')}`
              }}>
                Connect Google
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Google Calendars */}
      {googleStatus?.connected && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Google Calendars to Sync</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refreshCalendars.mutate()}
              disabled={refreshCalendars.isPending}
            >
              {refreshCalendars.isPending ? 'Refreshing…' : 'Refresh'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {calendars.length === 0 && (
              <p className="text-sm text-muted-foreground">No calendars found.</p>
            )}
            {calendars.map((cal) => (
              <div key={cal.id} className="flex items-center justify-between">
                <Label htmlFor={`cal-${cal.id}`} className="cursor-pointer">
                  {cal.name}
                </Label>
                <Switch
                  id={`cal-${cal.id}`}
                  checked={cal.enabled}
                  onCheckedChange={(checked) =>
                    toggleCalendar.mutate({ id: cal.id, enabled: checked })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Button
            onClick={() => triggerSync.mutate()}
            disabled={triggerSync.isPending || syncState !== 'idle' || !zohoStatus?.connected || !googleStatus?.connected}
          >
            Sync Now
          </Button>
          <Button variant="outline" onClick={() => navigate('/history')}>
            View History &rarr;
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
