/**
 * Namespaces MCP tool names per server for the AI SDK tool map (must be unique, alphanumeric + underscore).
 */
export function mcpAiToolKey(serverName: string, toolName: string): string {
  const s = serverName.replace(/[^a-zA-Z0-9_]/g, '_')
  const t = toolName.replace(/[^a-zA-Z0-9_]/g, '_')
  return `${s}__${t}`
}
