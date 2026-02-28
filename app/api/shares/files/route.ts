import { NextResponse } from 'next/server'
import { getSharesAsFileItems } from '@/lib/shares'

export async function GET() {
  try {
    const files = await getSharesAsFileItems()
    return NextResponse.json({ files })
  } catch (error) {
    console.error('Error listing shares as files:', error)
    return NextResponse.json({ error: 'Failed to list shares' }, { status: 500 })
  }
}
