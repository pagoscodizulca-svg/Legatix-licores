'use client'

import { getSyncQueue, removeFromQueue, updateQueueItem } from '@/lib/offline-db'
import { emitirFacturaPOS } from '@/app/actions/facturacion'
import { registrarPago } from '@/app/actions/pagos'

let isSyncing = false

export async function processSyncQueue() {
  if (isSyncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  
  try {
    isSyncing = true
    const queue = await getSyncQueue()
    
    if (queue.length === 0) {
      return
    }
    
    console.log(`[Offline Sync] Iniciando sincronización de ${queue.length} elementos pendientes...`)
    
    for (const item of queue) {
      try {
        let res: { success: boolean; error?: string } = { success: false, error: 'Tipo de operación desconocido' }

        if (item.type === 'pos_checkout' || item.type === 'nueva_factura') {
          res = await emitirFacturaPOS(item.payload)
        } else if (item.type === 'pago') {
          res = await registrarPago(item.payload)
        }

        if (res.success) {
          console.log(`[Offline Sync] Sincronizado correctamente: ${item.id}`)
          await removeFromQueue(item.id)
        } else {
          console.error(`[Offline Sync] Falló validación en servidor para ${item.id}:`, res.error)
          await updateQueueItem(item.id, { status: 'failed', error: res.error })
        }
      } catch (err: any) {
        console.error(`[Offline Sync] Error de red sincronizando ${item.id}:`, err)
        // No lo borramos, lo intentamos en el próximo ciclo
      }
    }
  } catch (err) {
    console.error('[Offline Sync] Error global en el sync manager:', err)
  } finally {
    isSyncing = false
  }
}
