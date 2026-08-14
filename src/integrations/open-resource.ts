import { createResourceOpener } from '../features/open/open-resource'
import { applicationContentRegistry } from './registry'

export const openResource = createResourceOpener(applicationContentRegistry.rendererRegistry)
