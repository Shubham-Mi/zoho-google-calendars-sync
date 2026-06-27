import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Switch } from '../components/ui/switch'
import { Label } from '../components/ui/label'
import { Separator } from '../components/ui/separator'

interface CalendarItem {
  id: string
  name: string
  enabled: boolean
}

export function Dashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()

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
              <Button size="sm" asChild>
                <a href="/api/zoho/connect">Connect Zoho</a>
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
              <Button size="sm" asChild>
                <a href="/api/google/connect">Connect Google</a>
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

      {/* Sync Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Button
            onClick={() => triggerSync.mutate()}
            disabled={triggerSync.isPending || !zohoStatus?.connected || !googleStatus?.connected}
          >
            {triggerSync.isPending ? 'Syncing…' : 'Sync Now'}
          </Button>
          <Button variant="outline" onClick={() => navigate('/history')}>
            View History &rarr;
          </Button>
          {triggerSync.isSuccess && (
            <span className="text-sm text-muted-foreground">Sync job queued.</span>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
