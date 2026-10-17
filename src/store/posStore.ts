import { create } from 'zustand'
import { Producto } from '@/types/inventario.types'
import { CrearItemPayload, CondicionPago } from '@/types/facturacion.types'

export interface POSCartItem extends CrearItemPayload {
  id: string // internal cart item ID
  nombre: string
  stock_disponible: number
}

export interface POSPago {
  id: string
  metodo: string // 'EFECTIVO_BS', 'EFECTIVO_USD', etc.
  montoUSD: number
  montoVES: number // Derived or entered
}

interface POSStore {
  items: POSCartItem[]
  clienteId: string | null
  metodoPago: string // Deprecated, but kept for compatibility before refactor
  pagos: POSPago[]
  condicionPago: CondicionPago
  pagandoEnDivisas: boolean
  addItem: (producto: Producto) => void
  removeItem: (id: string) => void
  updateQuantity: (id: string, delta: number) => void
  setClienteId: (id: string | null) => void
  setMetodoPago: (metodo: string) => void
  setCondicionPago: (condicion: CondicionPago) => void
  addPago: (pago: Omit<POSPago, 'id'>) => void
  removePago: (id: string) => void
  setPagandoEnDivisas: (pagando: boolean) => void
  clearCart: () => void
}

export const usePOSStore = create<POSStore>((set, get) => ({
  items: [],
  clienteId: null,
  metodoPago: 'PUNTO',
  pagos: [],
  condicionPago: 'CONTADO',
  pagandoEnDivisas: false, // (Eliminado IGTF)

  addItem: (producto: Producto) => {
    const { items } = get()
    const existingItem = items.find(i => i.producto_id === producto.id)

    if (existingItem) {
      if (existingItem.cantidad < existingItem.stock_disponible) {
        set({
          items: items.map(i => 
            i.producto_id === producto.id 
              ? { ...i, cantidad: i.cantidad + 1 }
              : i
          )
        })
      }
    } else if (producto.stock_actual > 0) {
      set({
        items: [...items, {
          id: Math.random().toString(36).substring(7),
          producto_id: producto.id,
          nombre: producto.nombre,
          codigo_sku: producto.codigo_sku,
          descripcion: producto.nombre,
          cantidad: 1,
          unidad_medida: producto.unidad_medida,
          precio_unitario_usd: producto.precio_venta_usd,
          descuento_pct: 0,
          tipo_alicuota: producto.gravado_iva ? 'GENERAL' : 'EXENTO',
          aplica_alicuota_adicional: false,
          stock_disponible: producto.stock_actual
        }]
      })
    }
  },

  removeItem: (id: string) => {
    set(state => ({ items: state.items.filter(i => i.id !== id) }))
  },

  updateQuantity: (id: string, delta: number) => {
    set(state => ({
      items: state.items.map(i => {
        if (i.id === id) {
          const newQty = i.cantidad + delta
          if (newQty > 0 && newQty <= i.stock_disponible) {
            return { ...i, cantidad: newQty }
          }
        }
        return i
      })
    }))
  },

  setClienteId: (id) => set({ clienteId: id }),
  setMetodoPago: (metodo) => set({ metodoPago: metodo }),
  setCondicionPago: (condicion) => set({ condicionPago: condicion }),
  addPago: (pago) => set(state => {
    const newPagos = [...state.pagos, { ...pago, id: Math.random().toString(36).substring(7) }]
    return { pagos: newPagos, pagandoEnDivisas: false }
  }),
  removePago: (id) => set(state => {
    const newPagos = state.pagos.filter(p => p.id !== id)
    return { pagos: newPagos, pagandoEnDivisas: false }
  }),
  setPagandoEnDivisas: (pagando) => set({ pagandoEnDivisas: pagando }),
  clearCart: () => set({ items: [], clienteId: null, metodoPago: 'PUNTO', pagos: [], condicionPago: 'CONTADO', pagandoEnDivisas: false }),
}))
