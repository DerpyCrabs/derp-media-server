import { createServer } from 'vite'

const server = await createServer({ server: { host: '0.0.0.0', port: 0, strictPort: true } })
await server.listen()
const address = server.httpServer?.address()
if (!address || typeof address === 'string') throw new Error('Vite has no TCP listener')
console.log(`DERP_VITE_READY=${address.port}`)
