import { test, expect } from 'bun:test'
import { mcpAiToolKey } from '@/lib/mcp-ai-tool-key'

test('mcpAiToolKey namespaces and sanitizes', () => {
  expect(mcpAiToolKey('vkusvill', 'search')).toBe('vkusvill__search')
  expect(mcpAiToolKey('my-server', 'tool.name')).toBe('my_server__tool_name')
})

test('mcpAiToolKey avoids collisions via distinct inputs', () => {
  expect(mcpAiToolKey('a', 'b')).not.toBe(mcpAiToolKey('a_', 'b'))
})
