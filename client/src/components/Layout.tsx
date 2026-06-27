import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './ui/button'

export function Layout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b px-6 py-3 flex items-center justify-between">
        <Link to="/dashboard" className="font-semibold text-lg">
          Calendar Sync
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/history" className="text-sm text-muted-foreground hover:text-foreground">
            History
          </Link>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </nav>
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
