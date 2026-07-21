import type { ModelInfoEnricher, ModelInfoEnricherOptions } from './types'

const MODALITIES = new Set(['text', 'audio', 'image', 'video', 'pdf'])

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function hasCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const modalities = value.filter((item): item is string => typeof item === 'string' && MODALITIES.has(item))
  return modalities.length > 0 ? modalities : undefined
}

function modelEntries(data: unknown): Record<string, any>[] {
  if (Array.isArray(data)) return data.filter(isObject)
  if (isObject(data) && Array.isArray(data.data)) return data.data.filter(isObject)
  return []
}

function buildModelMap(data: unknown): Map<string, Record<string, any>> {
  const result = new Map<string, Record<string, any>>()
  for (const model of modelEntries(data)) {
    if (typeof model.id !== 'string' || model.id.length === 0) continue
    result.set(model.id, model)
    if (!result.has(model.id.toLowerCase())) result.set(model.id.toLowerCase(), model)
  }
  return result
}

function applyLimits(modelConfig: any, model: Record<string, any>): void {
  if (!hasUsableNumber(model.context_length) || !hasUsableNumber(model.max_output_tokens)) return
  if (model.max_output_tokens > model.context_length) return
  modelConfig.limit = {
    context: model.context_length,
    output: model.max_output_tokens,
  }
}

function applyCapabilities(modelConfig: any, model: Record<string, any>): void {
  const capabilities = isObject(model.capabilities) ? model.capabilities : undefined
  if (typeof capabilities?.reasoning === 'boolean') modelConfig.reasoning = capabilities.reasoning
  if (typeof capabilities?.tool_call === 'boolean') modelConfig.tool_call = capabilities.tool_call
  if (typeof capabilities?.vision === 'boolean') modelConfig.attachment = capabilities.vision

  const modalities = isObject(model.modalities) ? model.modalities : undefined
  const input = parseModalities(modalities?.input)
  const output = parseModalities(modalities?.output)
  if (input || output) {
    modelConfig.modalities = {
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    }
    return
  }

  if (capabilities?.vision === true) {
    modelConfig.modalities = {
      input: ['text', 'image'],
      output: ['text'],
    }
  }
}

function applyPricing(modelConfig: any, model: Record<string, any>): void {
  if (!isObject(model.pricing)) return
  if (model.pricing.unit !== 'per_1m_tokens' || model.pricing.currency !== 'USD') return
  if (!hasCost(model.pricing.input) || !hasCost(model.pricing.output)) return

  modelConfig.cost = {
    input: model.pricing.input,
    output: model.pricing.output,
    ...(hasCost(model.pricing.cache_read) ? { cache_read: model.pricing.cache_read } : {}),
    ...(hasCost(model.pricing.cache_write) ? { cache_write: model.pricing.cache_write } : {}),
  }
}

export function createAxonHubModelInfoEnricher(
  data: unknown,
  options?: ModelInfoEnricherOptions
): ModelInfoEnricher {
  const models = buildModelMap(data)
  const getModel = (modelId: string, rawModel?: Record<string, unknown>) =>
    rawModel ?? models.get(modelId) ?? models.get(modelId.toLowerCase())

  return {
    shouldSkipModel(modelId: string): boolean {
      if (options?.filterNonChat === false) return false
      const type = getModel(modelId)?.type
      return typeof type === 'string' && type.length > 0 && type !== 'chat'
    },
    getModelName(modelId: string): string | undefined {
      const name = getModel(modelId)?.name
      return typeof name === 'string' && name.length > 0 ? name : undefined
    },
    applyModelInfo(modelConfig: any, modelId: string, rawModel?: Record<string, unknown>): void {
      const model = getModel(modelId, rawModel)
      if (!model) return
      applyLimits(modelConfig, model)
      applyCapabilities(modelConfig, model)
      applyPricing(modelConfig, model)
    },
  }
}
