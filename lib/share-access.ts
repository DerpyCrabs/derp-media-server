import { getShare, isShareAccessAuthorized, resolveShareSubPath, type ShareLink } from './shares'

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

interface ShareAccess {
  share: ShareLink
}

export async function validateShareAccess(
  cookies: { [key: string]: string | undefined },
  token: string,
): Promise<ShareAccess> {
  const share = await getShare(token)
  if (!share) throw new HttpError(404, 'Share not found')
  const authorized = isShareAccessAuthorized(share, {
    get: (name: string) => (cookies[name] ? { value: cookies[name]! } : undefined),
  })
  if (!authorized) throw new HttpError(401, 'Passcode required')
  return { share }
}

export function resolveSharePath(share: ShareLink, subPath: string): string {
  const resolved = resolveShareSubPath(share, subPath)
  if (resolved === null) throw new HttpError(403, 'Path outside share boundary')
  return resolved
}
