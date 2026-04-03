import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { dynamicTool, jsonSchema, type ToolSet } from 'ai'
import type { JSONSchema7 } from 'json-schema'
import type { McpConfig } from '@/lib/config'
import { mcpAiToolKey } from '@/lib/mcp-ai-tool-key'

function formatMcpToolResult(result: Awaited<ReturnType<Client['callTool']>>): string {
  if (result.isError) {
    const parts = extractTextParts(result.content)
    const msg = parts.length ? parts.join('\n') : 'Tool error'
    return `Error: ${msg}`
  }
  const parts = extractTextParts(result.content)
  if (parts.length) return parts.join('\n')
  return JSON.stringify(result)
}

function extractTextParts(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const c of content) {
    if (c && typeof c === 'object' && 'type' in c) {
      const t = (c as { type?: string; text?: string }).type
      if (t === 'text' && typeof (c as { text?: string }).text === 'string') {
        out.push((c as { text: string }).text)
      } else {
        out.push(JSON.stringify(c))
      }
    }
  }
  return out
}

function defaultInputSchema(): JSONSchema7 {
  return { type: 'object', properties: {} }
}

export async function buildMcpToolsetForKbChat(mcp: McpConfig): Promise<{
  tools: ToolSet
  cleanup: () => Promise<void>
}> {
  const sessions: { client: Client; transport: StreamableHTTPClientTransport }[] = []
  const tools: ToolSet = {}
  const usedKeys = new Set<string>()

  const closeAll = async () => {
    for (const { client } of sessions) {
      try {
        await client.close()
      } catch {
        /* ignore */
      }
    }
  }

  const registerKey = (base: string): string => {
    let k = base
    let n = 0
    while (usedKeys.has(k)) {
      n++
      k = `${base}_${n}`
    }
    usedKeys.add(k)
    return k
  }

  try {
    for (const [serverName, { url }] of Object.entries(mcp.servers)) {
      const transport = new StreamableHTTPClientTransport(new URL(url))
      const client = new Client({ name: 'derp-media-kb-chat', version: '0.1.0' })
      await client.connect(transport)
      sessions.push({ client, transport })
      const listed = await client.listTools()
      const mcpTools = listed.tools ?? []
      for (const t of mcpTools) {
        const baseKey = mcpAiToolKey(serverName, t.name)
        const aiName = registerKey(baseKey)
        const schema = (t.inputSchema ?? defaultInputSchema()) as JSONSchema7
        const toolName = t.name
        tools[aiName] = dynamicTool({
          description:
            [t.title && `(${t.title})`, t.description].filter(Boolean).join(' ') || undefined,
          inputSchema: jsonSchema(schema),
          execute: async (input: unknown) => {
            const r = await client.callTool({
              name: toolName,
              arguments: input as Record<string, unknown> | undefined,
            })
            return formatMcpToolResult(r)
          },
        })
      }
    }
  } catch (err) {
    await closeAll()
    throw err
  }

  return {
    tools,
    cleanup: closeAll,
  }
}
