import type { ModelInfoEnricher } from './types'
import { lookupModelsDevData, type ModelsDevModel, type ReasoningOption } from '../models-dev-fetcher'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Build reasoning variant overrides from models.dev `reasoning_options`.
 *
 * Only `effort`-type options are emitted, and always as `{ reasoningEffort: <tier> }`
 * since this plugin discovers OpenAI-compatible providers whose native wire shape is
 * `reasoning_effort`. Toggle/budget_tokens options are ignored (they map to non-OAI
 * shapes elsewhere in opencode and would need provider-specific translation).
 *
 * Mirrors opencode core's `reasoningVariants` + `reasoningEffort` for the
 * `@ai-sdk/openai-compatible` branch.
 */
function createReasoningVariantsFromOptions(options: ReasoningOption[] | undefined): Record<string, any> | undefined {
  if (!options || options.length === 0) return undefined
  const effort = options.find((option) => option.type === 'effort')
  if (!effort?.values?.length) return undefined

  const variants: Record<string, any> = {}
  for (const value of effort.values) {
    const id = value === null ? 'none' : value
    if (typeof id !== 'string' || id.length === 0) continue
    variants[id] = { reasoningEffort: id }
  }
  return Object.keys(variants).length > 0 ? variants : undefined
}

function applyModelsDevModelInfo(modelConfig: any, info: ModelsDevModel | undefined): void {
  if (!info) return

  const contextLimit = hasUsableNumber(info.limit?.context) ? info.limit.context : info.limit?.input
  const outputLimit = info.limit?.output
  if (hasUsableNumber(contextLimit) || hasUsableNumber(outputLimit)) {
    modelConfig.limit = {
      ...(hasUsableNumber(contextLimit) ? { context: contextLimit } : {}),
      ...(hasUsableNumber(info.limit?.input) ? { input: info.limit.input } : {}),
      ...(hasUsableNumber(outputLimit) ? { output: outputLimit } : {}),
    }
  }

  if (typeof info.attachment === 'boolean') modelConfig.attachment = info.attachment
  if (typeof info.reasoning === 'boolean') modelConfig.reasoning = info.reasoning
  if (typeof info.tool_call === 'boolean') modelConfig.tool_call = info.tool_call
  if (typeof info.structured_output === 'boolean') modelConfig.structured_output = info.structured_output
  if (typeof info.temperature === 'boolean') modelConfig.temperature = info.temperature
  if (info.modalities?.input?.length || info.modalities?.output?.length) {
    modelConfig.modalities = {
      ...(info.modalities.input?.length ? { input: info.modalities.input } : {}),
      ...(info.modalities.output?.length ? { output: info.modalities.output } : {}),
    }
  }

  const variants = createReasoningVariantsFromOptions(info.reasoning_options)
  if (variants) {
    modelConfig.variants = variants
  }
}

export function createModelsDevModelInfoEnricher(data: unknown): ModelInfoEnricher {
  const cache = data instanceof Map ? data as Map<string, ModelsDevModel> : new Map<string, ModelsDevModel>()

  return {
    shouldSkipModel(): boolean {
      return false
    },
    getModelName(modelId: string): string | undefined {
      return lookupModelsDevData(modelId, cache)?.name
    },
    applyModelInfo(modelConfig: any, modelId: string): void {
      applyModelsDevModelInfo(modelConfig, lookupModelsDevData(modelId, cache))
    },
  }
}
