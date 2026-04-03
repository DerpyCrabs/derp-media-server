import path from 'path'
import { tool, zodSchema, type ToolSet } from 'ai'
import { z } from 'zod'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import {
  createDirectory,
  fileExists,
  listDirectory,
  renameFileOrDirectory,
  writeFile,
} from '@/lib/file-system'
import {
  canonicalKbRelativePath,
  kbRelativeToMediaPath,
  mediaPathToKbRelative,
  KbFsPathError,
} from '@/lib/kb-chat-fs-paths'

const KB_FS_MAX_OPS = 50

function normalizeParentDir(mediaPath: string): string {
  const p = path.dirname(mediaPath).replace(/\\/g, '/')
  return p === '.' ? '' : p
}

const kbFsOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_folder'),
    path: z
      .string()
      .describe(
        'Folder path relative to KB root only (e.g. Logs/inbox). Never prefix the host media-library folder name.',
      ),
  }),
  z.object({
    type: z.literal('create_file'),
    path: z
      .string()
      .describe(
        'File path relative to KB root only. Never prefix the host media-library folder name.',
      ),
    content: z.string().describe('Full file contents as UTF-8 text'),
  }),
  z.object({
    type: z.literal('move'),
    from: z
      .string()
      .describe('Source path relative to KB root only; no host library folder prefix.'),
    to: z
      .string()
      .describe('Destination path relative to KB root only; no host library folder prefix.'),
  }),
])

const kbApplyChangesInputSchema = z.object({
  operations: z
    .array(kbFsOpSchema)
    .min(1)
    .max(KB_FS_MAX_OPS)
    .describe(`Ordered file operations (max ${KB_FS_MAX_OPS})`),
})

export type KbApplyChangesInput = z.infer<typeof kbApplyChangesInputSchema>

function safeCanonicalKbRel(kbRoot: string, raw: string): string {
  try {
    return canonicalKbRelativePath(kbRoot, raw)
  } catch {
    return raw
  }
}

export function describeKbApplyOperations(input: KbApplyChangesInput, kbRoot: string): string[] {
  return input.operations.map((op) => {
    switch (op.type) {
      case 'create_folder': {
        const p = safeCanonicalKbRel(kbRoot, op.path || '')
        return `Create folder: ${p || '.'}`
      }
      case 'create_file':
        return `Create file: ${safeCanonicalKbRel(kbRoot, op.path)}`
      case 'move':
        return `Move or rename: ${safeCanonicalKbRel(kbRoot, op.from)} → ${safeCanonicalKbRel(kbRoot, op.to)}`
      default:
        return String(op)
    }
  })
}

export function buildKbFsTools(kbRoot: string): ToolSet {
  const kbListFolder = tool({
    description:
      'List files and folders inside the knowledge base at a path relative to the KB root. Read-only.',
    inputSchema: zodSchema(
      z.object({
        relativePath: z
          .string()
          .optional()
          .describe(
            'Path under the KB root only — e.g. "Logs" or "Projects/readme.md" parent folder "Projects"; do NOT prefix with the KB folder name again. Omit or "" for the KB root.',
          ),
      }),
    ),
    execute: async ({ relativePath = '' }) => {
      try {
        const mediaDirPath = kbRelativeToMediaPath(kbRoot, relativePath)
        const files = await listDirectory(mediaDirPath)
        return {
          entries: files
            .filter((f) => !f.isVirtual)
            .map((f) => ({
              name: f.name,
              path: mediaPathToKbRelative(kbRoot, f.path.replace(/\\/g, '/')),
              isDirectory: f.isDirectory,
            })),
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'list failed'
        return { error: msg }
      }
    },
  })

  const kbApplyChanges = tool({
    description: [
      'Apply structural changes inside this knowledge base (create folders/files, move or rename).',
      'Use one call with multiple operations when possible; the user confirms the whole batch once.',
      'Paths are always relative to the KB root with forward slashes. move covers rename.',
    ].join(' '),
    inputSchema: zodSchema(kbApplyChangesInputSchema),
    needsApproval: true,
    execute: async (input: KbApplyChangesInput) => {
      const applied: string[] = []
      try {
        for (const op of input.operations) {
          switch (op.type) {
            case 'create_folder': {
              const mediaPath = kbRelativeToMediaPath(kbRoot, op.path || '')
              if (await fileExists(mediaPath)) {
                throw new Error(`Already exists: ${op.path || '.'}`)
              }
              await createDirectory(mediaPath)
              const parent = normalizeParentDir(mediaPath)
              broadcastFileChange(parent, mediaPath)
              applied.push(`create_folder ${safeCanonicalKbRel(kbRoot, op.path || '') || '.'}`)
              break
            }
            case 'create_file': {
              const mediaPath = kbRelativeToMediaPath(kbRoot, op.path)
              if (await fileExists(mediaPath)) {
                throw new Error(`File already exists: ${op.path}`)
              }
              await writeFile(mediaPath, op.content)
              const parent = normalizeParentDir(mediaPath)
              broadcastFileChange(parent, mediaPath)
              applied.push(`create_file ${safeCanonicalKbRel(kbRoot, op.path)}`)
              break
            }
            case 'move': {
              const fromMedia = kbRelativeToMediaPath(kbRoot, op.from)
              const toMedia = kbRelativeToMediaPath(kbRoot, op.to)
              await renameFileOrDirectory(fromMedia, toMedia)
              const oldParent = normalizeParentDir(fromMedia)
              const newParent = normalizeParentDir(toMedia)
              broadcastFileChange(oldParent, fromMedia)
              if (newParent !== oldParent) {
                broadcastFileChange(newParent, toMedia)
              } else {
                broadcastFileChange(newParent, toMedia)
              }
              applied.push(
                `move ${safeCanonicalKbRel(kbRoot, op.from)} → ${safeCanonicalKbRel(kbRoot, op.to)}`,
              )
              break
            }
            default:
              throw new Error('Unknown operation')
          }
        }
        return { ok: true as const, applied }
      } catch (e) {
        const msg = e instanceof KbFsPathError || e instanceof Error ? e.message : 'apply failed'
        return { ok: false as const, error: msg, applied }
      }
    },
  })

  return {
    kb_list_folder: kbListFolder,
    kb_apply_changes: kbApplyChanges,
  }
}
