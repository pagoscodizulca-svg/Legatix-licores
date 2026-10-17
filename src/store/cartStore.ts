import { create } from 'zustand'
import { Producto } from '@/types/inventario.types'

export interface CartItem {
  producto: Producto
  cantidad: number
  subtotal: number
}

interface CartState {
  items: CartItem[]
  tasaCambio: number // VES por USD
  setTasaCambio: (tasa: number) => void
  addItem: (producto: Producto) => void
  removeItem: (productoId: string) => void
  updateQuantity: (productoId: string, cantidad: number) => void
  clearCart: () => void
  getTotalUSD: () => number
  getTotalVES: () => number
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  tasaCambio: 36.5, // Tasa default (se puede actualizar con API del BCV o configuración)
  
  setTasaCambio: (tasa) => {
    if (tasa > 0) set({ tasaCambio: tasa })
  },
  
  addItem: (producto) => {
    if (producto.stock_actual !== undefined && producto.stock_actual <= 0) return
    set((state) => {
      const existingItem = state.items.find((i) => i.producto.id === producto.id)
      if (existingItem) {
        return {
          items: state.items.map((i) => 
            i.producto.id === producto.id 
              ? { ...i, cantidad: i.cantidad + 1, subtotal: (i.cantidad + 1) * i.producto.precio_venta_usd }
              : i
          )
        }
      }
      return {
        items: [...state.items, { producto, cantidad: 1, subtotal: producto.precio_venta_usd }]
      }
    })
  },
  
  removeItem: (productoId) => {
    set((state) => ({
      items: state.items.filter((i) => i.producto.id !== productoId)
    }))
  },
  
  updateQuantity: (productoId, cantidad) => {
    if (cantidad <= 0) {
      set((state) => ({
        items: state.items.filter((i) => i.producto.id !== productoId)
      }))
      return
    }
    set((state) => ({
      items: state.items.map((i) => 
        i.producto.id === productoId 
          ? { ...i, cantidad, subtotal: cantidad * i.producto.precio_venta_usd }
          : i
      )
    }))
  },
  
  clearCart: () => set({ items: [] }),
  
  getTotalUSD: () => {
    return get().items.reduce((total, item) => total + item.subtotal, 0)
  },
  
  getTotalVES: () => {
    // Para simplificar, se asume precio_venta_usd * tasa, 
    // pero si el producto tiene precio_venta fijado en Bs., se podría usar ese.
    const state = get()
    return state.items.reduce((total, item) => total + (item.cantidad * item.producto.precio_venta), 0)
  }
}))
