import type { FastifyInstance } from 'fastify'
import type { ServerResponse } from 'http'
import { APICallError } from '@ai-sdk/provider'
import { stepCountIs, streamText, type ModelMessage } from 'ai'
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
import {
  buildKbFsTools,
  describeKbApplyOperations,
  type KbApplyChangesInput,
} from '@/server/kb-chat-fs-tools'

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

This chat is scoped to **one** knowledge base. In references, filesystem tools, and \`media:\` markdown links, every path is **only inside that knowledge base**: use forward slashes from its root (e.g. \`Logs/note.md\`, \`Projects/\` for a folder). Do **not** prefix with the name of the folder that contains this knowledge base on the host disk — you do not know that name and must not guess it.

Use \`media:\` links so the user can open them: [label](media:Logs/note.md) for files or [label](media:Projects/) for folders (trailing slash for directories).

**Filesystem tools** (same path rule: KB root only, no ".."):
- \`kb_list_folder\`: optional \`relativePath\` (default = KB root). Read-only.
- \`kb_apply_changes\`: batch create/move/rename; user approves once. Prefer one call with many \`operations\`.`

function serverNowPromptLine(): string {
  const d = new Date()
  const local = d.toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  })
  const utc = d.toISOString()
  return `Current date and time on the server: ${local} (${utc}). Use this for "today", relative dates, and time-sensitive answers.`
}

async function buildSystemPromptForMessages(
  kbRoot: string,
  ai: AiConfig,
  modelMessages: ModelMessage[],
): Promise<string> {
  const lastUser = [...modelMessages].reverse().find((m) => m.role === 'user')
  let userText = ''
  if (lastUser && typeof lastUser.content === 'string') {
    userText = lastUser.content
  } else if (lastUser && Array.isArray(lastUser.content)) {
    for (const p of lastUser.content) {
      if (p.type === 'text' && 'text' in p && typeof p.text === 'string') {
        userText = p.text
        break
      }
    }
  }
  const kbContext = await gatherKbContext(kbRoot, userText)
  const kbKey = kbRoot.replace(/\\/g, '/')
  const settings = await readSettings()
  const perKbExtra = settings.kbChatSystemPrompts?.[kbKey]?.trim() ?? ''

  return [
    serverNowPromptLine(),
    '\n',
    ai.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    ...(perKbExtra ? [`\n\n${perKbExtra}`] : []),
    kbContext
      ? `\n\nHere is the knowledge base content for reference:\n\n${kbContext}`
      : '\n\nThe knowledge base is empty.',
  ].join('')
}

async function prepareToolset(kbRoot: string): Promise<{
  tools: NonNullable<Parameters<typeof streamText>[0]['tools']>
  cleanup: () => Promise<void>
}> {
  const kbTools = buildKbFsTools(kbRoot)
  const mcpCfg = getMcpConfig()
  let mcpCleanup: (() => Promise<void>) | undefined
  let mcpTools: NonNullable<Parameters<typeof streamText>[0]['tools']> | undefined
  if (mcpCfg?.servers && Object.keys(mcpCfg.servers).length > 0) {
    const built = await buildMcpToolsetForKbChat(mcpCfg)
    mcpCleanup = built.cleanup
    if (Object.keys(built.tools).length > 0) {
      mcpTools = built.tools
    }
  }
  const tools = { ...(mcpTools ?? {}), ...kbTools } as NonNullable<
    Parameters<typeof streamText>[0]['tools']
  >
  const cleanup = async () => {
    await mcpCleanup?.()
  }
  return { tools, cleanup }
}

function linesForToolInput(toolName: string, input: unknown, kbRoot: string): string[] | undefined {
  if (
    toolName === 'kb_apply_changes' &&
    input &&
    typeof input === 'object' &&
    'operations' in input
  ) {
    return describeKbApplyOperations(input as KbApplyChangesInput, kbRoot)
  }
  return undefined
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : JSON.stringify(err)
}

type StreamSseParams = {
  raw: ServerResponse
  model: ReturnType<typeof buildModel>
  systemPrompt: string
  messages: ModelMessage[]
  tools: NonNullable<Parameters<typeof streamText>[0]['tools']>
  kbMessagesForSave: KbChatMessage[]
  kbRoot: string
  chatId: string | undefined
  /** Appended before streamed assistant text when persisting (e.g. prior stream before tool approval). */
  assistantPersistPrefix?: string
}

async function streamKbChatToSseInner(params: StreamSseParams): Promise<{
  approvalRequired: boolean
  threadSnapshot: ModelMessage[]
  assistantText: string
  chatId: string | undefined
}> {
  const {
    raw,
    model,
    systemPrompt,
    messages,
    tools,
    kbMessagesForSave,
    kbRoot,
    chatId: inputChatId,
    assistantPersistPrefix = '',
  } = params

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(20),
  })

  let assistantText = ''
  const approvalMetas: Array<{
    approvalId: string
    toolCallId: string
    toolName: string
    input: unknown
    lines?: string[]
  }> = []

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta' && part.text) {
      assistantText += part.text
      raw.write(`data: ${JSON.stringify({ type: 'text', text: part.text })}\n\n`)
    } else if (part.type === 'tool-call') {
      const lines = linesForToolInput(part.toolName, part.input, kbRoot)
      raw.write(
        `data: ${JSON.stringify({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          lines,
        })}\n\n`,
      )
    } else if (part.type === 'tool-approval-request') {
      const tc = part.toolCall
      const lines = linesForToolInput(tc.toolName, tc.input, kbRoot)
      const meta = {
        approvalId: part.approvalId,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
        lines,
      }
      approvalMetas.push(meta)
      raw.write(`data: ${JSON.stringify({ type: 'tool-approval-request', ...meta })}\n\n`)
    } else if (part.type === 'tool-result' && part.preliminary !== true) {
      raw.write(
        `data: ${JSON.stringify({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
        })}\n\n`,
      )
    } else if (part.type === 'tool-error') {
      raw.write(
        `data: ${JSON.stringify({
          type: 'tool-error',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          error: errorText(part.error),
        })}\n\n`,
      )
    }
  }

  const response = await result.response
  const threadSnapshot = [...messages, ...response.messages] as ModelMessage[]

  if (approvalMetas.length > 0) {
    raw.write(
      `data: ${JSON.stringify({
        type: 'approval-required',
        approvals: approvalMetas,
        threadSnapshot,
      })}\n\n`,
    )
    return { approvalRequired: true, threadSnapshot, assistantText, chatId: inputChatId }
  }

  let chatId = inputChatId
  const persistedAssistant = `${assistantPersistPrefix}${assistantText}`
  const allKb: KbChatMessage[] = [
    ...kbMessagesForSave,
    { role: 'assistant', content: persistedAssistant },
  ]

  if (chatId) {
    await updateChatMessages(chatId, allKb)
  } else {
    const chat = await createChat(kbRoot, allKb)
    chatId = chat.id
  }

  raw.write(
    `data: ${JSON.stringify({ type: 'done', chatId, assistantText: persistedAssistant })}\n\n`,
  )
  return { approvalRequired: false, threadSnapshot, assistantText, chatId }
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

      const systemPrompt = await buildSystemPromptForMessages(
        body.kbRoot,
        ai,
        body.messages.map((m) => ({ role: m.role, content: m.content })),
      )

      if (ai.provider === 'lmstudio') {
        await assertLmStudioModelsAvailable(
          ai.baseUrl || 'http://localhost:1234/v1',
          ai.model || '',
        )
      }

      const model = buildModel(ai)
      let toolPrep: Awaited<ReturnType<typeof prepareToolset>>
      try {
        toolPrep = await prepareToolset(body.kbRoot)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'MCP connection failed'
        return reply.code(503).send({ error: `MCP: ${msg}` })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      try {
        await streamKbChatToSseInner({
          raw: reply.raw,
          model,
          systemPrompt,
          messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
          tools: toolPrep.tools,
          kbMessagesForSave: body.messages,
          kbRoot: body.kbRoot.replace(/\\/g, '/'),
          chatId: body.chatId,
        })
      } catch (err) {
        const message = providerErrorMessage(err, ai.provider)
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
      } finally {
        await toolPrep.cleanup()
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

  app.post('/api/kb/chat/continue', async (request, reply) => {
    try {
      const ai = getAiConfig()
      if (!ai) {
        return reply.code(503).send({ error: 'AI not configured' })
      }

      const body = request.body as {
        chatId?: string
        kbRoot: string
        modelMessages: ModelMessage[]
        approvals: { approvalId: string; approved: boolean; reason?: string }[]
        kbMessagesForSave: KbChatMessage[]
        assistantPrefix?: string
      }

      if (
        !body.kbRoot ||
        !Array.isArray(body.modelMessages) ||
        body.modelMessages.length === 0 ||
        !Array.isArray(body.approvals) ||
        body.approvals.length === 0 ||
        !Array.isArray(body.kbMessagesForSave)
      ) {
        return reply
          .code(400)
          .send({ error: 'kbRoot, modelMessages, approvals, and kbMessagesForSave are required' })
      }

      const knowledgeBases = await getKnowledgeBases()
      if (!knowledgeBases.includes(body.kbRoot.replace(/\\/g, '/'))) {
        return reply.code(400).send({ error: 'Not a knowledge base' })
      }

      const toolMessage: ModelMessage = {
        role: 'tool',
        content: body.approvals.map((a) => ({
          type: 'tool-approval-response' as const,
          approvalId: a.approvalId,
          approved: a.approved,
          ...(a.reason !== undefined ? { reason: a.reason } : {}),
        })),
      }

      const messages = [...body.modelMessages, toolMessage]

      const systemPrompt = await buildSystemPromptForMessages(body.kbRoot, ai, messages)

      if (ai.provider === 'lmstudio') {
        await assertLmStudioModelsAvailable(
          ai.baseUrl || 'http://localhost:1234/v1',
          ai.model || '',
        )
      }

      const model = buildModel(ai)
      let toolPrep: Awaited<ReturnType<typeof prepareToolset>>
      try {
        toolPrep = await prepareToolset(body.kbRoot)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'MCP connection failed'
        return reply.code(503).send({ error: `MCP: ${msg}` })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      try {
        await streamKbChatToSseInner({
          raw: reply.raw,
          model,
          systemPrompt,
          messages,
          tools: toolPrep.tools,
          kbMessagesForSave: body.kbMessagesForSave,
          kbRoot: body.kbRoot.replace(/\\/g, '/'),
          chatId: body.chatId,
          assistantPersistPrefix: body.assistantPrefix,
        })
      } catch (err) {
        const message = providerErrorMessage(err, ai.provider)
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
      } finally {
        await toolPrep.cleanup()
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
