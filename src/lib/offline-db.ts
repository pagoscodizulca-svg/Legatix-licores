export interface SyncAction {
  id: string
  type: 'pos_checkout' | 'nueva_factura' | 'pago'
  payload: any
  timestamp: number
  status: 'pending' | 'failed'
  error?: string
}

const DB_NAME = 'legatix_offline'
const DB_VERSION = 1
const STORE_NAME = 'sync_queue'

let dbInstance: IDBDatabase | null = null

export async function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = (e) => reject('Error abriendo IndexedDB')

    request.onsuccess = (e) => {
      dbInstance = (e.target as IDBOpenDBRequest).result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

export async function enqueueAction(type: SyncAction['type'], payload: any): Promise<void> {
  const db = await initDB()
  const action: SyncAction = {
    id: crypto.randomUUID(),
    type,
    payload,
    timestamp: Date.now(),
    status: 'pending'
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.add(action)

    request.onsuccess = () => resolve()
    request.onerror = () => reject('Error guardando en cola offline')
  })
}

export async function getSyncQueue(): Promise<SyncAction[]> {
  try {
    const db = await initDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject('Error leyendo cola offline')
    })
  } catch (e) {
    console.error('IndexedDB no disponible, retornando array vacío', e)
    return []
  }
}

export async function removeFromQueue(id: string): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onsuccess = () => resolve()
    request.onerror = () => reject('Error borrando de cola offline')
  })
}

export async function updateQueueItem(id: string, updates: Partial<SyncAction>): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(id)

    getReq.onsuccess = () => {
      const item = getReq.result
      if (!item) return resolve()
      
      const updatedItem = { ...item, ...updates }
      const putReq = store.put(updatedItem)
      
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject('Error actualizando item')
    }
    
    getReq.onerror = () => reject('Error obteniendo item para actualizar')
  })
}
