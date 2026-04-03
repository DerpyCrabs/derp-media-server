import type { FastifyInstance } from 'fastify'
import { APICallError } from '@ai-sdk/provider'
import { stepCountIs, streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiConfig, getMcpConfig, type AiConfig } from '@/lib/config'
import { getKnowledgeBases } from '@/lib/knowledge-base'
import {
  createChat,
  updateChatMessages,
  getChat,
  getChatHistory,
  deleteChat,
  setChatPinned,
  type KbChatMessage,
} from '@/lib/kb-chats'
import { gatherKbContext } from '@/server/kb-context'
import { readSettings } from '@/server/routes/api/settings'
import { buildMcpToolsetForKbChat } from '@/server/mcp-kb-chat-tools'

function providerErrorMessage(err: unknown, provider: AiConfig['provider']): string {
  let message = err instanceof Error ? err.message : 'Stream error'
  if (APICallError.isInstance(err)) {
    message = err.message
    const raw = err.responseBody?.trim()
    if (raw) {
      try {
        const j = JSON.parse(raw) as { error?: { message?: string }; message?: string }
        const m = j.error?.message ?? j.message
        if (typeof m === 'string' && m.trim()) message = m.trim()
      } catch {
        /* keep message */
      }
    }
  }
  if (provider === 'lmstudio' && /no models loaded/i.test(message)) {
    return `${message} In LM Studio: open the Developer / Local Server pane, start the server, and load a model (the Chat tab alone does not load models for the API).`
  }
  return message
}

class ChatProviderNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatProviderNotReadyError'
  }
}

async function assertLmStudioModelsAvailable(
  baseUrl: string,
  configuredModel: string,
): Promise<void> {
  const root = (baseUrl || 'http://localhost:1234/v1').replace(/\/?$/, '')
  const url = `${root}/models`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  } catch {
    return
  }
  if (!res.ok) return
  let body: { data?: { id: string }[] }
  try {
    body = (await res.json()) as { data?: { id: string }[] }
  } catch {
    return
  }
  const models = body.data ?? []
  if (models.length === 0) {
    throw new ChatProviderNotReadyError(
      'LM Studio is not exposing any models at /v1/models. Start the local API server and load a model into memory in LM Studio (Developer tab), then retry.',
    )
  }
  const modelId = configuredModel.trim()
  if (!modelId) return
  const ids = models.map((m) => m.id)
  const matches = ids.some((id) => id === modelId || id.includes(modelId) || modelId.includes(id))
  if (!matches) {
    const sample = ids.slice(0, 8).join(', ')
    throw new ChatProviderNotReadyError(
      `LM Studio has no model matching "${modelId}". Available ids include: ${sample}${ids.length > 8 ? ', …' : ''}. Set "model" in config.jsonc to one of these (or a substring that uniquely matches).`,
    )
  }
}

function buildModel(ai: AiConfig) {
  const modelId = ai.model || 'gpt-3.5-turbo'
  switch (ai.provider) {
    case 'openrouter': {
      const provider = createOpenRouter({ apiKey: ai.apiKey ?? '' })
      return provider.chat(modelId)
    }
    case 'lmstudio': {
      const provider = createOpenAI({
        apiKey: 'lm-studio',
        baseURL: ai.baseUrl || 'http://localhost:1234/v1',
      })
      return provider.chat(modelId)
    }
    case 'openai-compatible': {
      const provider = createOpenAI({
        apiKey: ai.apiKey ?? '',
        baseURL: ai.baseUrl,
      })
      return provider.chat(modelId)
    }
  }
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant for a knowledge base. Answer questions based on the provided knowledge base content. If you don't find relevant information in the context, say so honestly. Use markdown formatting in your responses. You can answer any question and have opinion, try not to tell user that you are just an AI and can't answer something

When citing files or folders under the library, use markdown links with the media scheme so the user can open them: [label](media:path/relative/to/media/root.md) for files, or [label](media:path/to/folder/) for folders (trailing slash for directories). Paths use forward slashes relative to the media library root.`

function serverNowPromptLine(): string {
  const d = new Date()
  const local = d.toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  })
  const utc = d.toISOString()
  return `Current date and time on the server: ${local} (${utc}). Use this for "today", relative dates, and time-sensitive answers.`
}

export function registerKbChatApiRoutes(app: FastifyInstance) {
  app.get('/api/kb/chat/status', async (_request, reply) => {
    const ai = getAiConfig()
    return reply.send({ enabled: ai !== null })
  })

  app.post('/api/kb/chat', async (request, reply) => {
    try {
      const ai = getAiConfig()
      if (!ai) {
        return reply.code(503).send({ error: 'AI not configured' })
      }

      const body = request.body as {
        chatId?: string
        kbRoot: string
        messages: KbChatMessage[]
      }

      if (!body.kbRoot || !Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.code(400).send({ error: 'kbRoot and messages are required' })
      }

      const knowledgeBases = await getKnowledgeBases()
      if (!knowledgeBases.includes(body.kbRoot.replace(/\\/g, '/'))) {
        return reply.code(400).send({ error: 'Not a knowledge base' })
      }

      const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')
      const kbContext = await gatherKbContext(body.kbRoot, lastUserMsg?.content ?? '')

      const kbKey = body.kbRoot.replace(/\\/g, '/')
      const settings = await readSettings()
      const perKbExtra = settings.kbChatSystemPrompts?.[kbKey]?.trim() ?? ''

      const systemPrompt = [
        serverNowPromptLine(),
        '\n',
        ai.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        ...(perKbExtra ? [`\n\n${perKbExtra}`] : []),
        kbContext
          ? `\n\nHere is the knowledge base content for reference:\n\n${kbContext}`
          : '\n\nThe knowledge base is empty.',
      ].join('')

      if (ai.provider === 'lmstudio') {
        await assertLmStudioModelsAvailable(
          ai.baseUrl || 'http://localhost:1234/v1',
          ai.model || '',
        )
      }

      const model = buildModel(ai)

      const mcpCfg = getMcpConfig()
      let mcpCleanup: (() => Promise<void>) | undefined
      let mcpTools: NonNullable<Parameters<typeof streamText>[0]['tools']> | undefined
      if (mcpCfg?.servers && Object.keys(mcpCfg.servers).length > 0) {
        try {
          const built = await buildMcpToolsetForKbChat(mcpCfg)
          mcpCleanup = built.cleanup
          if (Object.keys(built.tools).length > 0) {
            mcpTools = built.tools
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'MCP connection failed'
          return reply.code(503).send({ error: `MCP: ${msg}` })
        }
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      let fullResponse = ''

      try {
        const result = streamText({
          model,
          system: systemPrompt,
          messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(mcpTools ? { tools: mcpTools, stopWhen: stepCountIs(12) } : {}),
        })

        for await (const chunk of result.textStream) {
          fullResponse += chunk
          reply.raw.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`)
        }

        const allMessages: KbChatMessage[] = [
          ...body.messages,
          { role: 'assistant' as const, content: fullResponse },
        ]

        let chatId = body.chatId
        if (chatId) {
          await updateChatMessages(chatId, allMessages)
        } else {
          const chat = await createChat(body.kbRoot, allMessages)
          chatId = chat.id
        }

        reply.raw.write(`data: ${JSON.stringify({ type: 'done', chatId })}\n\n`)
      } catch (err) {
        const message = providerErrorMessage(err, ai.provider)
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
      } finally {
        await mcpCleanup?.()
      }

      reply.raw.end()
      return reply
    } catch (err) {
      const aiCfg = getAiConfig()
      const message = providerErrorMessage(err, aiCfg?.provider ?? 'openai-compatible')
      if (!reply.raw.headersSent) {
        const code = err instanceof ChatProviderNotReadyError ? 503 : 500
        return reply.code(code).send({ error: message })
      }
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
        reply.raw.end()
      } catch {
        /* connection already closed */
      }
      return reply
    }
  })

  app.get('/api/kb/chat/history', async (request, reply) => {
    const { kbRoot = '' } = request.query as { kbRoot?: string }
    if (!kbRoot) return reply.send({ chats: [] })
    const chats = await getChatHistory(kbRoot)
    return reply.send({ chats })
  })

  app.get('/api/kb/chat/:chatId', async (request, reply) => {
    const { chatId } = request.params as { chatId: string }
    const chat = await getChat(chatId)
    if (!chat) return reply.code(404).send({ error: 'Chat not found' })
    return reply.send(chat)
  })

  app.delete('/api/kb/chat/:chatId', async (request, reply) => {
    const { chatId } = request.params as { chatId: string }
    const deleted = await deleteChat(chatId)
    if (!deleted) return reply.code(404).send({ error: 'Chat not found' })
    return reply.send({ success: true })
  })

  app.patch('/api/kb/chat/:chatId', async (request, reply) => {
    const { chatId } = request.params as { chatId: string }
    const body = request.body as { pinned?: boolean }
    if (typeof body.pinned !== 'boolean') {
      return reply.code(400).send({ error: 'pinned boolean required' })
    }
    const chat = await setChatPinned(chatId, body.pinned)
    if (!chat) return reply.code(404).send({ error: 'Chat not found' })
    const { messages: _m, ...summary } = chat
    return reply.send(summary)
  })
}
