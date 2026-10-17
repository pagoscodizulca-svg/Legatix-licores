import { describe, it, expect, beforeEach } from 'vitest'
import { usePOSStore } from '../store/posStore'
import { useCartStore } from '../store/cartStore'
import type { Producto } from '../types/inventario.types'

describe('State Management Stores (Zustand) — POS & Cart', () => {
  const prodGravado: Producto = {
    id: 'prod-1',
    empresa_id: 'emp-1',
    categoria_id: null,
    proveedor_id: null,
    codigo_sku: 'LIC-001',
    nombre: 'Whisky Buchanans 12',
    descripcion: null,
    unidad_medida: 'BOTELLA',
    precio_costo: 20,
    precio_venta: 1400,
    precio_venta_usd: 35,
    stock_actual: 3,
    stock_minimo: 1,
    volumen_litros: 0.75,
    es_licor: true,
    es_promo: false,
    grado_alcoholico: 40,
    gravado_iva: true,
    alicuota_iva: 16,
    activo: true,
    created_at: '',
    updated_at: '',
  }

  const prodExento: Producto = {
    ...prodGravado,
    id: 'prod-2',
    codigo_sku: 'HIE-001',
    nombre: 'Bolsa de Hielo',
    precio_venta: 80,
    precio_venta_usd: 2,
    stock_actual: 5,
    es_licor: false,
    gravado_iva: false,
  }

  const prodSinStock: Producto = {
    ...prodGravado,
    id: 'prod-3',
    codigo_sku: 'AGOT-001',
    nombre: 'Producto Agotado',
    stock_actual: 0,
  }

  describe('usePOSStore', () => {
    beforeEach(() => {
      usePOSStore.getState().clearCart()
    })

    it('agrega productos gravados y exentos e incrementa cantidad hasta el límite de stock (Happy Path & Edge Case)', () => {
      const store = usePOSStore.getState()
      store.addItem(prodGravado)
      store.addItem(prodExento)

      let state = usePOSStore.getState()
      expect(state.items).toHaveLength(2)
      expect(state.items[0].tipo_alicuota).toBe('GENERAL')
      expect(state.items[1].tipo_alicuota).toBe('EXENTO')

      // Incrementar prodGravado (stock = 3) mientras prodExento permanece igual en el map
      store.addItem(prodGravado) // 2
      store.addItem(prodGravado) // 3
      store.addItem(prodGravado) // No debe pasar de 3 (stock límite)

      state = usePOSStore.getState()
      expect(state.items[0].cantidad).toBe(3)
      expect(state.items[1].cantidad).toBe(1)
    })

    it('impide agregar un producto con stock_actual <= 0 (Edge Case)', () => {
      usePOSStore.getState().addItem(prodSinStock)
      expect(usePOSStore.getState().items).toHaveLength(0)
    })

    it('actualiza cantidades con updateQuantity respetando límites [1, stock_disponible] y elimina ítems', () => {
      usePOSStore.getState().addItem(prodGravado)
      usePOSStore.getState().addItem(prodExento)
      const itemId = usePOSStore.getState().items[0].id

      // No permite bajar de 1
      usePOSStore.getState().updateQuantity(itemId, -1)
      expect(usePOSStore.getState().items[0].cantidad).toBe(1)

      // Sube a 3 (mientras el segundo ítem no cambia en el map)
      usePOSStore.getState().updateQuantity(itemId, 2)
      expect(usePOSStore.getState().items[0].cantidad).toBe(3)
      expect(usePOSStore.getState().items[1].cantidad).toBe(1)

      // No permite subir más allá de stock_disponible (3)
      usePOSStore.getState().updateQuantity(itemId, 1)
      expect(usePOSStore.getState().items[0].cantidad).toBe(3)

      // Eliminar ítem
      usePOSStore.getState().removeItem(itemId)
      expect(usePOSStore.getState().items).toHaveLength(1)
    })

    it('gestiona cliente, método de pago, condición de pago y múltiples pagos', () => {
      const store = usePOSStore.getState()
      store.setClienteId('cli-123')
      store.setMetodoPago('PAGO_MOVIL')
      store.setCondicionPago('CREDITO')
      store.setPagandoEnDivisas(true)

      expect(usePOSStore.getState().clienteId).toBe('cli-123')
      expect(usePOSStore.getState().metodoPago).toBe('PAGO_MOVIL')
      expect(usePOSStore.getState().condicionPago).toBe('CREDITO')
      expect(usePOSStore.getState().pagandoEnDivisas).toBe(true)

      store.addPago({ metodo: 'EFECTIVO_USD', montoUSD: 20, montoVES: 800 })
      expect(usePOSStore.getState().pagos).toHaveLength(1)
      expect(usePOSStore.getState().pagandoEnDivisas).toBe(false)

      const pagoId = usePOSStore.getState().pagos[0].id
      store.removePago(pagoId)
      expect(usePOSStore.getState().pagos).toHaveLength(0)

      store.clearCart()
      expect(usePOSStore.getState().clienteId).toBeNull()
    })
  })

  describe('useCartStore', () => {
    beforeEach(() => {
      useCartStore.getState().clearCart()
      useCartStore.getState().setTasaCambio(40)
    })

    it('agrega productos, calcula subtotales y totales en USD y VES', () => {
      const store = useCartStore.getState()
      store.addItem(prodGravado) // 35 USD / 1400 VES
      store.addItem(prodExento)  // +2 USD / 80 VES
      store.addItem(prodGravado) // x2 = 70 USD / 2800 VES (cubre ambas ramas del map en addItem)

      expect(store.getTotalUSD()).toBe(72)
      expect(store.getTotalVES()).toBe(2880)
    })

    it('ignora productos sin stock, ignora tasas inválidas y remueve ítem si updateQuantity <= 0', () => {
      const store = useCartStore.getState()
      store.addItem(prodSinStock)
      expect(useCartStore.getState().items).toHaveLength(0)

      store.setTasaCambio(-10)
      expect(useCartStore.getState().tasaCambio).toBe(40)

      store.addItem(prodGravado)
      store.addItem(prodExento)
      store.updateQuantity('prod-1', 3) // cubre ambas ramas del map en updateQuantity
      expect(useCartStore.getState().items[0].subtotal).toBe(105)

      // Actualizar a 0 elimina el producto del carrito
      store.updateQuantity('prod-1', 0)
      expect(useCartStore.getState().items).toHaveLength(1)

      store.removeItem('prod-2')
      expect(useCartStore.getState().items).toHaveLength(0)
    })
  })
})
