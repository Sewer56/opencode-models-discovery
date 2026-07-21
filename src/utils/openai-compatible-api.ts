import http from 'node:http'
import https from 'node:https'
import type { DiscoveredModel } from '../types'

const OPENAI_COMPATIBLE_MODELS_ENDPOINT = "/v1/models"
const REQUEST_TIMEOUT_MS = 3000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

export interface ModelsDiscoveryResult {
  ok: boolean
  models: DiscoveredModel[]
}

export interface ModelInfoDiscoveryResult {
  ok: boolean
  data: unknown
}

export function normalizeBaseURL(baseURL: string): string {
  let normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  return normalized
}

export function buildAPIURL(baseURL: string, endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT): string {
  const normalized = normalizeBaseURL(baseURL)
  return `${normalized}${endpoint}`
}

function requestJson<T>(urlStr: string, headers: Record<string, string>): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (data: T | undefined) => {
      if (!settled) {
        settled = true
        resolve(data)
      }
    }

    const urlObj = new URL(urlStr)
    const mod = urlObj.protocol === 'https:' ? https : http

    const req = mod.get(urlObj, { headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = ''
      let bytes = 0
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_RESPONSE_BYTES) {
          res.destroy()
          finish(undefined)
          return
        }
        data += chunk
      })
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          finish(undefined)
          return
        }

        try {
          finish(JSON.parse(data) as T)
        } catch {
          finish(undefined)
        }
      })
      res.on('error', () => finish(undefined))
    })

    req.on('error', () => finish(undefined))
    req.on('timeout', () => {
      req.destroy()
      finish(undefined)
    })
  })
}

export async function discoverModelsFromProvider(
  baseURL: string,
  apiKey?: string,
  endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT
): Promise<ModelsDiscoveryResult> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`
  }

  const data = await requestJson<unknown>(url, headers)
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, models: [] }
  const models = (data as { data?: unknown }).data
  if (!Array.isArray(models)) return { ok: false, models: [] }
  return { ok: true, models: models.filter(isValidModel) }
}

export async function discoverModelInfoFromProvider(
  baseURL: string,
  apiKey?: string,
  endpoint: string = "/v1/model/info"
): Promise<ModelInfoDiscoveryResult> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`
  }

  const data = await requestJson<unknown>(url, headers)
  return data !== undefined ? { ok: true, data } : { ok: false, data: undefined }
}

export async function fetchModelsDirect(baseURL: string, endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT): Promise<string[]> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers = { "Content-Type": "application/json" }

  const data = await requestJson<unknown>(url, headers)
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const models = (data as { data?: unknown }).data
  if (!Array.isArray(models)) return []
  return models.filter(isValidModel).map(model => model.id)
}

export function isOpenAICompatibleProvider(provider: any): boolean {
  return provider &&
         typeof provider === 'object' &&
         provider.npm === "@ai-sdk/openai-compatible"
}

export function hasOpenAICompatibleURL(provider: any): boolean {
  if (!provider || typeof provider !== 'object') return false
  const baseURL = provider.options?.baseURL || ""
  return /\/v1(\/|$)/.test(baseURL)
}

export function hasModelsDiscoveryEndpoint(provider: any): boolean {
  if (!provider || typeof provider !== 'object') return false
  const endpoint = provider.options?.modelsDiscovery?.endpoint
  return typeof endpoint === 'string' && endpoint.length > 0
}

export function canDiscoverModels(provider: any): boolean {
  return isOpenAICompatibleProvider(provider) || hasOpenAICompatibleURL(provider) || hasModelsDiscoveryEndpoint(provider)
}

export function isValidModel(model: unknown): model is DiscoveredModel {
  return model !== null &&
         typeof model === 'object' &&
         !Array.isArray(model) &&
         typeof (model as Record<string, unknown>).id === 'string' &&
         ((model as Record<string, unknown>).id as string).trim().length > 0
}
