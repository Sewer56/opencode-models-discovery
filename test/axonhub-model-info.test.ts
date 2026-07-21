import { describe, expect, it } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'

describe('AxonHub model info enricher', () => {
  it('maps extended fields from the models response', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.AxonHub, {
      data: [{
        id: 'glm-5.2',
        object: 'model',
        created: 1781359129,
        owned_by: 'zai',
        name: 'GLM-5.2',
        type: 'chat',
        context_length: 10_000_000,
        max_output_tokens: 131_072,
        modalities: {
          input: ['text'],
          output: ['text'],
        },
        capabilities: {
          vision: false,
          tool_call: true,
          reasoning: true,
        },
        pricing: {
          input: 1.4,
          output: 4.4,
          cache_read: 0.26,
          cache_write: 0,
          unit: 'per_1m_tokens',
          currency: 'USD',
        },
      }],
    }, { filterNonChat: true })

    expect(enricher).toBeDefined()
    expect(enricher!.getModelName?.('glm-5.2')).toBe('GLM-5.2')
    expect(enricher!.shouldSkipModel('glm-5.2')).toBe(false)

    const modelConfig: any = { id: 'glm-5.2' }
    enricher!.applyModelInfo(modelConfig, 'glm-5.2')

    expect(modelConfig).toEqual({
      id: 'glm-5.2',
      limit: {
        context: 10_000_000,
        output: 131_072,
      },
      reasoning: true,
      tool_call: true,
      attachment: false,
      modalities: {
        input: ['text'],
        output: ['text'],
      },
      cost: {
        input: 1.4,
        output: 4.4,
        cache_read: 0.26,
        cache_write: 0,
      },
    })
  })

  it('uses the raw model passed by discovery without a second response lookup', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.AxonHub, null)
    const modelConfig: any = { id: 'glm-5v-turbo' }

    enricher!.applyModelInfo(modelConfig, 'glm-5v-turbo', {
      id: 'glm-5v-turbo',
      type: 'chat',
      context_length: 200_000,
      max_output_tokens: 65_536,
      capabilities: { vision: true },
      modalities: {
        input: ['text', 'image', 'unsupported'],
        output: ['text'],
      },
    })

    expect(modelConfig.limit).toEqual({
      context: 200_000,
      output: 65_536,
    })
    expect(modelConfig.attachment).toBe(true)
    expect(modelConfig.modalities).toEqual({
      input: ['text', 'image'],
      output: ['text'],
    })
  })

  it('filters explicit non-chat models but keeps models with unknown type', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.AxonHub, [
      { id: 'embedding-model', type: 'embedding' },
      { id: 'router-model' },
    ], { filterNonChat: true })

    expect(enricher!.shouldSkipModel('embedding-model')).toBe(true)
    expect(enricher!.shouldSkipModel('router-model')).toBe(false)
  })

  it('keeps explicit non-chat models when filtering is disabled', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.AxonHub, [
      { id: 'image-model', type: 'image' },
    ], { filterNonChat: false })

    expect(enricher!.shouldSkipModel('image-model')).toBe(false)
  })

  it.each([
    { context_length: undefined, max_output_tokens: 4096 },
    { context_length: 8192, max_output_tokens: undefined },
    { context_length: 0, max_output_tokens: 4096 },
    { context_length: 8192.5, max_output_tokens: 4096 },
    { context_length: 8192, max_output_tokens: 0 },
    { context_length: 8192, max_output_tokens: 16384 },
  ])('does not guess limits from invalid or incomplete values: %j', (rawModel) => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.AxonHub, null)
    const modelConfig: any = { id: 'invalid-limits' }

    enricher!.applyModelInfo(modelConfig, 'invalid-limits', {
      id: 'invalid-limits',
      ...rawModel,
    })

    expect(modelConfig.limit).toBeUndefined()
  })

  it('does not map pricing unless both USD per-million prices are present', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.AxonHub, null)

    for (const pricing of [
      { input: 1, output: 2 },
      { input: 1, unit: 'per_1m_tokens', currency: 'USD' },
      { input: 1, output: 2, unit: 'per_token', currency: 'USD' },
      { input: 1, output: 2, unit: 'per_1m_tokens', currency: 'EUR' },
    ]) {
      const modelConfig: any = { id: 'invalid-pricing' }
      enricher!.applyModelInfo(modelConfig, 'invalid-pricing', {
        id: 'invalid-pricing',
        pricing,
      })
      expect(modelConfig.cost).toBeUndefined()
    }
  })

  it('leaves limits unset when AxonHub does not report context length', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.AxonHub, null)
    const modelConfig: any = { id: 'zai-coding-plan/glm-5.2' }

    enricher!.applyModelInfo(modelConfig, 'zai-coding-plan/glm-5.2', {
      id: 'zai-coding-plan/glm-5.2',
      object: 'model',
      created: 1_777_209_162,
      owned_by: 'zhipu',
    })

    expect(modelConfig.limit).toBeUndefined()
    expect(modelConfig.release_date).toBeUndefined()
  })
})
