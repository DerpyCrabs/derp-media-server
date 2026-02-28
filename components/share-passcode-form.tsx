'use client'

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Lock, AlertCircle } from 'lucide-react'

interface ShareInfo {
  token: string
  name: string
  isDirectory: boolean
  needsPasscode: boolean
}

interface SharePasscodeGateProps {
  token: string
  shareInfo: ShareInfo
  passcodeFromUrl?: string
  children: ReactNode
}

export function SharePasscodeGate({
  token,
  shareInfo,
  passcodeFromUrl,
  children,
}: SharePasscodeGateProps) {
  const [authorized, setAuthorized] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(passcodeFromUrl))
  const autoVerified = useRef(false)

  const verify = useCallback(
    async (code: string) => {
      setError('')
      setLoading(true)

      try {
        const res = await fetch(`/api/share/${token}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: code }),
        })

        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Invalid passcode')
          return
        }

        setAuthorized(true)
      } catch {
        setError('Verification failed')
      } finally {
        setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    if (passcodeFromUrl && !autoVerified.current) {
      autoVerified.current = true
      verify(passcodeFromUrl)
    }
  }, [passcodeFromUrl, verify])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      verify(passcode)
    },
    [passcode, verify],
  )

  if (authorized) {
    return <>{children}</>
  }

  return (
    <div className='min-h-screen flex items-center justify-center p-4'>
      <Card className='max-w-sm w-full'>
        <CardHeader className='text-center'>
          <div className='mx-auto mb-2 h-12 w-12 rounded-full bg-muted flex items-center justify-center'>
            <Lock className='h-6 w-6 text-muted-foreground' />
          </div>
          <CardTitle>Protected Share</CardTitle>
          <CardDescription>
            Enter the passcode to access &quot;{shareInfo.name}&quot;
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className='space-y-4'>
            <Input
              type='text'
              placeholder='Enter passcode'
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoFocus
              className='text-center tracking-widest font-mono text-lg'
            />
            {error && (
              <div className='flex items-center gap-2 text-sm text-destructive'>
                <AlertCircle className='h-4 w-4 shrink-0' />
                {error}
              </div>
            )}
            <Button type='submit' className='w-full' disabled={loading || !passcode}>
              {loading ? 'Verifying...' : 'Access Share'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
