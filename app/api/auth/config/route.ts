import { NextResponse } from 'next/server'
import { config } from '@/lib/config'

export async function GET() {
  const enabled = config.auth?.enabled ?? false
  return NextResponse.json({ enabled })
}
