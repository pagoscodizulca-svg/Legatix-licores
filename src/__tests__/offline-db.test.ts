import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock en memoria de IndexedDB para pruebas unitarias en Node
const memoryStore = new Map<string, any>()

const mockObjectStore = {
  add: vi.fn((item: any) => {
    const req: any = {}
    process.nextTick(() => {
      memoryStore.set(item.id, item)
      if (req.onsuccess) req.onsuccess()
    })
    return req
  }),
  getAll: vi.fn(() => {
    const req: any = {}
    process.nextTick(() => {
      req.result = Array.from(memoryStore.values())
      if (req.onsuccess) req.onsuccess()
    })
    return req
  }),
  delete: vi.fn((id: string) => {
    const req: any = {}
    process.nextTick(() => {
      memoryStore.delete(id)
      if (req.onsuccess) req.onsuccess()
    })
    return req
  }),
  get: vi.fn((id: string) => {
    const req: any = {}
    process.nextTick(() => {
      req.result = memoryStore.get(id)
      if (req.onsuccess) req.onsuccess()
    })
    return req
  }),
  put: vi.fn((item: any) => {
    const req: any = {}
    process.nextTick(() => {
      memoryStore.set(item.id, item)
      if (req.onsuccess) req.onsuccess()
    })
    return req
  }),
}

const mockDB = {
  objectStoreNames: {
    contains: () => false,
  },
  createObjectStore: vi.fn(),
  transaction: () => ({
    objectStore: () => mockObjectStore,
  }),
}

;(globalThis as any).indexedDB = {
  open: vi.fn(() => {
    const req: any = {}
    process.nextTick(() => {
      if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: mockDB } })
      if (req.onsuccess) req.onsuccess({ target: { result: mockDB } })
    })
    return req
  }),
}

import {
  initDB,
  enqueueAction,
  getSyncQueue,
  removeFromQueue,
  updateQueueItem,
} from '../lib/offline-db'

describe('Offline DB (IndexedDB Queue Engine)', () => {
  beforeEach(() => {
    memoryStore.clear()
    vi.clearAllMocks()
  })

  it('inicializa IndexedDB, encola acciones, obtiene la cola, actualiza estado y elimina elementos', async () => {
    // Error abriendo IndexedDB antes de inicializar dbInstance
    ;((globalThis as any).indexedDB.open as any).mockImplementationOnce(() => {
      const req: any = {}
      process.nextTick(() => {
        if (req.onerror) req.onerror(new Event('error'))
      })
      return req
    })
    await expect(initDB()).rejects.toBe('Error abriendo IndexedDB')

    const db = await initDB()
    expect(db).toBeDefined()

    // getAll con result undefined retorna []
    mockObjectStore.getAll.mockImplementationOnce(() => {
      const req: any = {}
      process.nextTick(() => {
        req.result = undefined
        if (req.onsuccess) req.onsuccess()
      })
      return req
    })
    expect(await getSyncQueue()).toEqual([])

    await enqueueAction('pos_checkout', { total: 45.0 })
    const queue = await getSyncQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].type).toBe('pos_checkout')
    expect(queue[0].status).toBe('pending')

    const id = queue[0].id
    await updateQueueItem(id, { status: 'failed', error: 'Error de prueba' })

    const updatedQueue = await getSyncQueue()
    expect(updatedQueue[0].status).toBe('failed')
    expect(updatedQueue[0].error).toBe('Error de prueba')

    // Actualizar un ID inexistente no debe romper la promesa (Edge Case)
    await updateQueueItem('id-inexistente', { status: 'failed' })

    await removeFromQueue(id)
    const finalQueue = await getSyncQueue()
    expect(finalQueue).toHaveLength(0)

    // Simular fallos de IndexedDB (onerror callbacks) para cubrir manejo de excepciones
    mockObjectStore.getAll.mockImplementationOnce(() => {
      const req: any = {}
      process.nextTick(() => {
        if (req.onerror) req.onerror()
      })
      return req
    })
    const errQueue = await getSyncQueue()
    expect(errQueue).toEqual([])

    mockObjectStore.add.mockImplementationOnce(() => {
      const req: any = {}
      process.nextTick(() => {
        if (req.onerror) req.onerror()
      })
      return req
    })
    await expect(enqueueAction('pago', {})).rejects.toBe('Error guardando en cola offline')

    mockObjectStore.delete.mockImplementationOnce(() => {
      const req: any = {}
      process.nextTick(() => {
        if (req.onerror) req.onerror()
      })
      return req
    })
    await expect(removeFromQueue('id-1')).rejects.toBe('Error borrando de cola offline')

    mockObjectStore.get.mockImplementationOnce(() => {
      const req: any = {}
      process.nextTick(() => {
        if (req.onerror) req.onerror()
      })
      return req
    })
    await expect(updateQueueItem('id-1', { status: 'failed' })).rejects.toBe('Error obteniendo item para actualizar')

    // Error en putReq dentro de updateQueueItem
    memoryStore.set('id-put-err', { id: 'id-put-err', status: 'pending' })
    mockObjectStore.put.mockImplementationOnce(() => {
      const req: any = {}
      process.nextTick(() => {
        if (req.onerror) req.onerror()
      })
      return req
    })
    await expect(updateQueueItem('id-put-err', { status: 'failed' })).rejects.toBe('Error actualizando item')
  })
})
