export interface ReasoningOption {
  type: 'effort' | 'toggle' | 'budget_tokens'
  values?: (string | null)[]
  min?: number
  max?: number
}

export interface ModelsDevModel {
  id: string
  name?: string
  attachment?: boolean
  reasoning?: boolean
  tool_call?: boolean
  structured_output?: boolean
  temperature?: boolean
  modalities?: {
    input?: string[]
    output?: string[]
  }
  limit?: {
    context?: number
    input?: number
    output?: number
  }
  reasoning_options?: ReasoningOption[]
}

const MODELS_DEV_URL = 'https://models.dev/api.json'
const PREFIX_MATCH_MIN_SCORE = 70
const PREFIX_MATCH_MIN_SHARED_PARTS = 2

let modelsDevCache: Map<string, ModelsDevModel> | null = null

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toModelId(providerId: string | undefined, modelId: string): string {
  return providerId ? `${providerId}/${modelId}` : modelId
}

function modelSegment(rawId: string): string {
  const parts = rawId.split('/')
  return parts[parts.length - 1].toLowerCase()
}

function addModel(cache: Map<string, ModelsDevModel>, seenModelSegments: Set<string>, providerId: string | undefined, rawModel: Record<string, any>, fallbackModelId?: string): void {
  const rawId = typeof rawModel.id === 'string' && rawModel.id.length > 0 ? rawModel.id : fallbackModelId
  if (!rawId) {
    return
  }

  // /api.json lists the same model under every provider that proxies it (e.g.
  // openai/gpt-5.6, azure/gpt-5.6, openrouter/gpt-5.6 …).  Keeping all of them
  // makes the model-segment lookup ambiguous (it sees >1 exact match and
  // returns undefined), which silently drops enrichment for every model.
  // Deduplicate by lowercase model segment so each canonical model appears once.
  const segment = modelSegment(rawId)
  if (seenModelSegments.has(segment)) {
    return
  }
  seenModelSegments.add(segment)

  const id = rawId.includes('/') ? rawId : toModelId(providerId, rawId)
  cache.set(id, {
    id,
    name: typeof rawModel.name === 'string' ? rawModel.name : undefined,
    attachment: typeof rawModel.attachment === 'boolean' ? rawModel.attachment : undefined,
    reasoning: typeof rawModel.reasoning === 'boolean' ? rawModel.reasoning : undefined,
    tool_call: typeof rawModel.tool_call === 'boolean' ? rawModel.tool_call : undefined,
    structured_output: typeof rawModel.structured_output === 'boolean' ? rawModel.structured_output : undefined,
    temperature: typeof rawModel.temperature === 'boolean' ? rawModel.temperature : undefined,
    modalities: isObject(rawModel.modalities) ? {
      input: Array.isArray(rawModel.modalities.input) ? rawModel.modalities.input.filter((item: unknown): item is string => typeof item === 'string') : undefined,
      output: Array.isArray(rawModel.modalities.output) ? rawModel.modalities.output.filter((item: unknown): item is string => typeof item === 'string') : undefined,
    } : undefined,
    limit: isObject(rawModel.limit) ? {
      context: typeof rawModel.limit.context === 'number' ? rawModel.limit.context : undefined,
      input: typeof rawModel.limit.input === 'number' ? rawModel.limit.input : undefined,
      output: typeof rawModel.limit.output === 'number' ? rawModel.limit.output : undefined,
    } : undefined,
    reasoning_options: parseReasoningOptions(rawModel.reasoning_options),
  })
}

function parseReasoningOptions(value: unknown): ReasoningOption[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: ReasoningOption[] = []
  for (const item of value) {
    if (!isObject(item)) continue
    const type = item.type
    if (type !== 'effort' && type !== 'toggle' && type !== 'budget_tokens') continue
    const option: ReasoningOption = { type }
    if (type === 'effort' && Array.isArray(item.values)) {
      option.values = item.values
        .filter((v: unknown): v is string | null => v === null || typeof v === 'string')
    }
    if (type === 'budget_tokens') {
      if (typeof item.min === 'number' && Number.isFinite(item.min)) option.min = item.min
      if (typeof item.max === 'number' && Number.isFinite(item.max)) option.max = item.max
    }
    result.push(option)
  }
  return result.length > 0 ? result : undefined
}

function parseModelsDevData(data: unknown): Map<string, ModelsDevModel> {
  const cache = new Map<string, ModelsDevModel>()
  const seenModelSegments = new Set<string>()

  if (!isObject(data)) {
    return cache
  }

  for (const [key, value] of Object.entries(data)) {
    if (!isObject(value)) {
      continue
    }

    if (isObject(value.models)) {
      for (const [modelId, model] of Object.entries(value.models)) {
        if (isObject(model)) {
          addModel(cache, seenModelSegments, key, model, modelId)
        }
      }
      continue
    }

    addModel(cache, seenModelSegments, undefined, value, key)
  }

  return cache
}

export async function fetchModelsDevData(): Promise<Map<string, ModelsDevModel>> {
  if (modelsDevCache) return modelsDevCache

  try {
    const response = await fetch(MODELS_DEV_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      return new Map()
    }

    modelsDevCache = parseModelsDevData(await response.json())
    return modelsDevCache
  } catch {
    return new Map()
  }
}

function splitModelId(modelId: string): { provider?: string; model: string } {
  const parts = modelId.split('/')
  if (parts.length <= 1) {
    return { model: modelId }
  }

  return {
    provider: parts[0].toLowerCase(),
    model: parts.slice(1).join('/'),
  }
}

function calculatePrefixScore(modelA: string, modelB: string): number {
  const partsA = modelA.split('-')
  const partsB = modelB.split('-')
  const shorter = partsA.length <= partsB.length ? partsA : partsB
  const longer = partsA.length <= partsB.length ? partsB : partsA

  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) {
      return 0
    }
  }

  if (shorter.length < PREFIX_MATCH_MIN_SHARED_PARTS) {
    return 0
  }

  return Math.max(0, 100 - ((longer.length - shorter.length) * 10))
}

export function lookupModelsDevData(
  modelId: string,
  cache: Map<string, ModelsDevModel>
): ModelsDevModel | undefined {
  let cleanId = modelId.replace(/:[a-zA-Z0-9_-]+$/g, '')
  const parts = cleanId.split('/')
  if (parts.length > 2) {
    cleanId = parts.slice(-2).join('/')
  }

  const exactMatch = cache.get(cleanId) ?? cache.get(cleanId.toLowerCase())
  if (exactMatch) return exactMatch

  const requestedModelLower = splitModelId(cleanId).model.toLowerCase()
  const allCandidates: Array<[string, ModelsDevModel]> = []

  for (const [key, value] of cache.entries()) {
    const candidate = splitModelId(key)
    const candidateModelLower = candidate.model.toLowerCase()
    allCandidates.push([candidateModelLower, value])
  }

  const exactModelMatches = allCandidates.filter(([candidateModel]) => candidateModel === requestedModelLower)
  if (exactModelMatches.length === 1) return exactModelMatches[0]?.[1]
  if (exactModelMatches.length > 1) return undefined

  let bestMatch: ModelsDevModel | undefined
  let bestScore = 0
  let bestScoreMatches = 0

  for (const [candidateModel, value] of allCandidates) {
    const score = calculatePrefixScore(requestedModelLower, candidateModel)
    if (score >= PREFIX_MATCH_MIN_SCORE && score > bestScore) {
      bestScore = score
      bestMatch = value
      bestScoreMatches = 1
    } else if (score >= PREFIX_MATCH_MIN_SCORE && score === bestScore) {
      bestScoreMatches++
    }
  }

  return bestScoreMatches === 1 ? bestMatch : undefined
}

export const modelsDevTestUtils = {
  parseModelsDevData,
  resetCache(): void {
    modelsDevCache = null
  },
}
