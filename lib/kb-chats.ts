import { promises as fs } from 'fs'
import { randomBytes } from 'crypto'
import { config, getDataFilePath } from '@/lib/config'
import { Mutex } from '@/lib/mutex'

export interface KbChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Seconds from first streamed token until the reply finished (measured in the client). */
  answerDurationSec?: number
}

export interface KbChat {
  id: string
  kbRoot: string
  title: string
  messages: KbChatMessage[]
  createdAt: number
  updatedAt: number
  pinned?: boolean
}

interface ChatsData {
  chats: KbChat[]
}

interface ChatsFile {
  [mediaDir: string]: ChatsData
}

const CHATS_FILE = getDataFilePath('kb-chats.json')
const chatsMutex = new Mutex()

async function readChatsFile(): Promise<ChatsFile> {
  try {
    const raw = await fs.readFile(CHATS_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeChatsFile(all: ChatsFile): Promise<void> {
  await fs.writeFile(CHATS_FILE, JSON.stringify(all, null, 2), 'utf-8')
}

async function readChatsData(): Promise<ChatsData> {
  const all = await readChatsFile()
  return all[config.mediaDir] || { chats: [] }
}

async function writeChatsData(data: ChatsData): Promise<void> {
  const all = await readChatsFile()
  all[config.mediaDir] = data
  await writeChatsFile(all)
}

function generateChatId(): string {
  return randomBytes(12).toString('base64url')
}

function titleFromFirstMessage(msg: string): string {
  const trimmed = msg.trim().slice(0, 80)
  return trimmed.length < msg.trim().length ? trimmed + '...' : trimmed
}

export async function createChat(kbRoot: string, messages: KbChatMessage[]): Promise<KbChat> {
  const release = await chatsMutex.acquire()
  try {
    const data = await readChatsData()
    const chat: KbChat = {
      id: generateChatId(),
      kbRoot,
      title: titleFromFirstMessage(messages[0]?.content ?? 'New chat'),
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    data.chats.push(chat)
    await writeChatsData(data)
    return chat
  } finally {
    release()
  }
}

export async function updateChatMessages(
  chatId: string,
  messages: KbChatMessage[],
): Promise<KbChat | null> {
  const release = await chatsMutex.acquire()
  try {
    const data = await readChatsData()
    const index = data.chats.findIndex((c) => c.id === chatId)
    if (index === -1) return null
    data.chats[index] = { ...data.chats[index], messages, updatedAt: Date.now() }
    await writeChatsData(data)
    return data.chats[index]
  } finally {
    release()
  }
}

export async function getChat(chatId: string): Promise<KbChat | null> {
  const data = await readChatsData()
  return data.chats.find((c) => c.id === chatId) ?? null
}

export async function getChatHistory(kbRoot: string): Promise<Omit<KbChat, 'messages'>[]> {
  const data = await readChatsData()
  return data.chats
    .filter((c) => c.kbRoot === kbRoot)
    .sort((a, b) => {
      const pa = a.pinned ? 1 : 0
      const pb = b.pinned ? 1 : 0
      if (pa !== pb) return pb - pa
      return b.updatedAt - a.updatedAt
    })
    .map(({ messages: _m, ...rest }) => rest)
}

export async function setChatPinned(chatId: string, pinned: boolean): Promise<KbChat | null> {
  const release = await chatsMutex.acquire()
  try {
    const data = await readChatsData()
    const index = data.chats.findIndex((c) => c.id === chatId)
    if (index === -1) return null
    data.chats[index] = { ...data.chats[index], pinned, updatedAt: Date.now() }
    await writeChatsData(data)
    return data.chats[index]
  } finally {
    release()
  }
}

export async function deleteChat(chatId: string): Promise<boolean> {
  const release = await chatsMutex.acquire()
  try {
    const data = await readChatsData()
    const index = data.chats.findIndex((c) => c.id === chatId)
    if (index === -1) return false
    data.chats.splice(index, 1)
    await writeChatsData(data)
    return true
  } finally {
    release()
  }
}
