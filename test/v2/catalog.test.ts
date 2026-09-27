import { describe, expect, it, vi } from "vitest"
import { createProviderController, type Inventory } from "../../src/v2/catalog.js"

function inventory(modelID = "spike-model"): Inventory {
  return new Map([["local", new Map([[modelID, {
    id: modelID,
    modelID,
    name: "Spike model",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 32_768, output: 8_192 },
  }]])]])
}

function provider(id = "local") {
  return {
    id,
    package: "@opencode-ai/ai/providers/openai-compatible",
    settings: { baseURL: "http://127.0.0.1:1234/v1" },
  }
}

describe("V2 provider controller", () => {
  it("registers a zero-model provider and replays replacement inventory", async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    const added: Array<{ info: Record<string, unknown>; models: unknown[] }> = []
    const controller = createProviderController(
      { provider: { reload } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue(undefined),
      add: vi.fn((definition) => added.push(definition)),
      update: vi.fn(),
      models: { set: vi.fn() },
    }

    controller.transform(editor as never)
    expect(added[0]?.models).toEqual([])

    await controller.replaceInventory(inventory())
    await controller.replaceInventory(inventory("replacement-model"))

    expect(reload).toHaveBeenCalledTimes(2)
    expect(controller.status()).toEqual({ providers: 1, models: 1 })
  })

  it("preserves existing source models when adding discovered models", async () => {
    const set = vi.fn()
    const existing = { modelID: "explicit-model" }
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({
        provider: { id: "local" },
        models: new Map([["explicit-model", existing]]),
      }),
      add: vi.fn(),
      update: vi.fn(),
      models: { set },
    }

    await controller.replaceInventory(inventory("discovered-model"))
    controller.transform(editor as never)

    expect(set).toHaveBeenCalledWith("local", [existing, expect.objectContaining({ modelID: "discovered-model" })])
  })

  it("replaces default limits on configured models without losing name or variants", async () => {
    const set = vi.fn()
    const explicit = {
      id: "gpt-6-sol", modelID: "gpt-6-sol", name: "GPT 6 Sol",
      limit: { context: 200_000, output: 32_000 },
      variants: [{ id: "max", settings: { reasoningEffort: "max" } }],
    }
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({ models: new Map([["gpt-6-sol", explicit]]) }),
      add: vi.fn(),
      models: { set },
    }
    const discovered = inventory("gpt-6-sol")
    discovered.get("local")!.set("gpt-6-sol", {
      ...discovered.get("local")!.get("gpt-6-sol")!,
      limit: { context: 1_050_000, output: 128_000 },
    })

    await controller.replaceInventory(discovered)
    controller.transform(editor as never)

    expect(set).toHaveBeenCalledWith("local", [{
      ...explicit,
      limit: { context: 1_050_000, output: 128_000 },
    }])
    expect(explicit.limit.context).toBe(200_000)
  })

  it("applies discovered cost to existing models without explicit cost", async () => {
    const set = vi.fn()
    const explicit = { id: "spike-model", modelID: "spike-model", limit: { context: 200_000, output: 32_000 }, cost: [] }
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({ models: new Map([["spike-model", explicit]]) }),
      add: vi.fn(),
      models: { set },
    }
    const discovered = inventory("spike-model")
    discovered.get("local")!.set("spike-model", {
      ...discovered.get("local")!.get("spike-model")!,
      limit: { context: 128_000, output: 8_192 },
      cost: [{ input: 1.4, output: 4.4, cache: { read: 0.26, write: 0 } }],
    })

    await controller.replaceInventory(discovered)
    controller.transform(editor as never)

    expect(set).toHaveBeenCalledWith("local", [{
      ...explicit,
      limit: { context: 128_000, output: 8_192 },
      cost: [{ input: 1.4, output: 4.4, cache: { read: 0.26, write: 0 } }],
    }])
    expect(explicit.cost).toEqual([])
  })

  it("preserves explicitly configured cost", async () => {
    const set = vi.fn()
    const userCost = [{ input: 2, output: 8, cache: { read: 0.2, write: 0 } }]
    const explicit = { id: "spike-model", modelID: "spike-model", limit: { context: 64_000, output: 8_000 }, cost: userCost }
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({ models: new Map([["spike-model", explicit]]) }),
      add: vi.fn(),
      models: { set },
    }
    const discovered = inventory("spike-model")
    discovered.get("local")!.set("spike-model", {
      ...discovered.get("local")!.get("spike-model")!,
      cost: [{ input: 1.4, output: 4.4, cache: { read: 0.26, write: 0 } }],
    })

    await controller.replaceInventory(discovered)
    controller.transform(editor as never)

    expect(set).toHaveBeenCalledWith("local", [explicit])
    expect(explicit.cost).toBe(userCost)
  })

  it("preserves non-default configured limits", async () => {
    const set = vi.fn()
    const explicit = { id: "spike-model", modelID: "spike-model", limit: { context: 64_000, output: 8_000 } }
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({ models: new Map([["spike-model", explicit]]) }),
      add: vi.fn(),
      models: { set },
    }

    await controller.replaceInventory(inventory())
    controller.transform(editor as never)

    expect(set).toHaveBeenCalledWith("local", [explicit])
  })

  it("preserves explicit provider settings and disabled activation", async () => {
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({
        provider: {
          id: "local",
          settings: { baseURL: "http://explicit.example/v1", apiKey: "explicit-secret" },
          integrationID: "explicit.integration",
          activation: "disabled",
        },
        models: new Map(),
      }),
      add: vi.fn(),
      update: vi.fn(),
      models: { set: vi.fn() },
    }

    controller.transform(editor as never)

    expect(editor.update).not.toHaveBeenCalled()
    expect(editor.add).not.toHaveBeenCalled()
    expect(editor.models.set).not.toHaveBeenCalled()
  })

  it("deduplicates discovered models by catalog id rather than modelID", async () => {
    const set = vi.fn()
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({
        models: new Map([["explicit-key", { id: "same-id", modelID: "explicit-alias" }]]),
      }),
      add: vi.fn(),
      update: vi.fn(),
      models: { set },
    }

    await controller.replaceInventory(inventory("same-id"))
    controller.transform(editor as never)

    expect(set).toHaveBeenCalledWith("local", [{ id: "same-id", modelID: "explicit-alias" }])
  })
})
