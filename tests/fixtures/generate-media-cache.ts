import fs from 'fs'
import path from 'path'
import { generateTestMedia } from './generate-media'

const ROOT = path.resolve(path.join(__dirname, '..', '..'))
const MEDIA_CACHE_DIR = path.join(ROOT, '.test-media-cache')

function main() {
  if (fs.existsSync(MEDIA_CACHE_DIR)) {
    fs.rmSync(MEDIA_CACHE_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true })
  console.log('Generating test media into .test-media-cache ...')
  generateTestMedia(MEDIA_CACHE_DIR)
  console.log('Done. Run test:batch to use the cache for faster setup.')
}

main()
