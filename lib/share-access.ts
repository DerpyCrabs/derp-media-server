import { NextRequest, NextResponse } from 'next/server'
import { getShare, isShareAccessAuthorized, resolveShareSubPath, type ShareLink } from './shares'

interface ShareAccess {
  share: ShareLink
}

/**
 * Validates share token and authorization, returning the share or an error response.
 */
export async function validateShareAccess(
  request: NextRequest,
  token: string,
): Promise<ShareAccess | NextResponse> {
  const share = await getShare(token)
  if (!share) {
    return NextResponse.json({ error: 'Share not found' }, { status: 404 })
  }

  const authorized = await isShareAccessAuthorized(share, request.cookies)
  if (!authorized) {
    return NextResponse.json({ error: 'Passcode required' }, { status: 401 })
  }

  return { share }
}

/**
 * Resolves and validates a sub-path within a share.
 * Returns the full relative path (from mediaDir) or an error response.
 */
export function resolveSharePath(share: ShareLink, subPath: string): string | NextResponse {
  const resolved = resolveShareSubPath(share, subPath)
  if (resolved === null) {
    return NextResponse.json({ error: 'Path outside share boundary' }, { status: 403 })
  }
  return resolved
}
