import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks para servicios externos
const mockSincronizar = vi.fn()
const mockObtenerUltima = vi.fn()
const mockEmitirFacturaPOS = vi.fn()
const mockRegistrarPago = vi.fn()
const mockGetSyncQueue = vi.fn()
const mockRemoveFromQueue = vi.fn()
const mockUpdateQueueItem = vi.fn()

vi.mock('@/lib/bcv-service', () => ({
  sincronizarTasaBcv: () => mockSincronizar(),
  obtenerUltimaTasaBcv: () => mockObtenerUltima(),
}))

vi.mock('@/app/actions/facturacion', () => ({
  emitirFacturaPOS: (payload: any) => mockEmitirFacturaPOS(payload),
}))

vi.mock('@/app/actions/pagos', () => ({
  registrarPago: (payload: any) => mockRegistrarPago(payload),
}))

vi.mock('@/lib/offline-db', () => ({
  getSyncQueue: () => mockGetSyncQueue(),
  removeFromQueue: (id: string) => mockRemoveFromQueue(id),
  updateQueueItem: (id: string, updates: any) => mockUpdateQueueItem(id, updates),
}))

import { POST as calcularPOST } from '../app/api/fiscal/calcular/route'
import { GET as bcvCronGET } from '../app/api/cron/bcv/route'
import { getTasaBcv, forceSyncTasaBcv } from '../app/actions/bcv'
import { processSyncQueue } from '../lib/sync-manager'
import { impresoraFiscal } from '../lib/impresora-fiscal'
import { cn } from '../lib/utils'

describe('API Routes, BCV Actions, Offline Sync Manager & Impresora Fiscal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CRON_SECRET
    delete process.env.NEXT_PUBLIC_FISCAL_SPOOLER_URL
  })

  // ─────────────────────────────────────────────────────────────
  // 1. API ROUTE: POST /api/fiscal/calcular
  // ─────────────────────────────────────────────────────────────
  describe('POST /api/fiscal/calcular', () => {
    const validBody = {
      items: [
        {
          descripcion: 'Cerveza Polar',
          cantidad: 2,
          unidad_medida: 'BOTELLA',
          precio_unitario_usd: 1.5,
          descuento_pct: 0,
          tipo_alicuota: 'GENERAL',
          aplica_alicuota_adicional: false,
        },
      ],
      config: {
        id: '1',
        empresa_id: '1',
        alicuota_iva_general: 16,
        alicuota_iva_adicional: 15,
        alicuota_iva_reducida: 8,
        alicuota_igtf: 3,
      },
      tasaBcv: 40,
      monedaPrincipal: 'VES',
      aplicarIgtf: false,
    }

    it('responde 200 OK con el cálculo fiscal válido (Happy Path)', async () => {
      const req = new Request('http://localhost:3000/api/fiscal/calcular', {
        method: 'POST',
        body: JSON.stringify(validBody),
      })
      const res = await calcularPOST(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.subtotal).toBe(3.0)
      expect(data.total_iva).toBe(0.48)
      expect(data.total).toBe(3.48)
    })

    it('responde 400 Bad Request si faltan parámetros o tasaBcv <= 0 (4xx Error Handling)', async () => {
      const reqMissing = new Request('http://localhost:3000/api/fiscal/calcular', {
        method: 'POST',
        body: JSON.stringify({ items: [] }),
      })
      const res400 = await calcularPOST(reqMissing)
      expect(res400.status).toBe(400)

      const reqZeroRate = new Request('http://localhost:3000/api/fiscal/calcular', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, tasaBcv: -5 }),
      })
      const resZero = await calcularPOST(reqZeroRate)
      expect(resZero.status).toBe(400)
    })

    it('responde 500 Internal Server Error ante JSON malformado (5xx Exception Handling)', async () => {
      const reqInvalidJson = new Request('http://localhost:3000/api/fiscal/calcular', {
        method: 'POST',
        body: '{ invalid json',
      })
      const res500 = await calcularPOST(reqInvalidJson)
      expect(res500.status).toBe(500)

      // Excepción sin error.message (usa mensaje por defecto)
      const resEmptyMsg = await calcularPOST({
        json: async () => {
          throw {}
        },
      } as any)
      expect(resEmptyMsg.status).toBe(500)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. API ROUTE: GET /api/cron/bcv & BCV Actions
  // ─────────────────────────────────────────────────────────────
  describe('GET /api/cron/bcv & getTasaBcv Action', () => {
    it('retorna 401 Unauthorized si CRON_SECRET está configurado y el header no coincide', async () => {
      process.env.CRON_SECRET = 'super-secret'
      const req = new Request('http://localhost:3000/api/cron/bcv', {
        headers: { authorization: 'Bearer wrong-token' },
      })
      const res = await bcvCronGET(req)
      expect(res.status).toBe(401)
    })

    it('retorna 200 OK cuando sincronizarTasaBcv tiene éxito y 500 cuando falla o lanza excepción', async () => {
      process.env.CRON_SECRET = 'super-secret'
      mockSincronizar.mockResolvedValueOnce({ success: true, tasa: 876.8, fecha_valor: '2026-10-17' })

      const reqOk = new Request('http://localhost:3000/api/cron/bcv', {
        headers: { authorization: 'Bearer super-secret' },
      })
      const res200 = await bcvCronGET(reqOk)
      expect(res200.status).toBe(200)

      // Fallo controlado
      mockSincronizar.mockResolvedValueOnce({ success: false, error: 'Timeout de 15s excedido conectando al BCV' })
      const res500 = await bcvCronGET(reqOk)
      expect(res500.status).toBe(500)

      // Excepción inesperada
      mockSincronizar.mockRejectedValueOnce(new Error('Crash de red'))
      const resCrash = await bcvCronGET(reqOk)
      expect(resCrash.status).toBe(500)
    })

    it('getTasaBcv devuelve tasa de hoy en caché, sincroniza si es vieja o usa fallback si BCV cae', async () => {
      const hoyIso = new Date().toISOString()
      mockObtenerUltima.mockResolvedValueOnce({
        success: true,
        tasa: 876.7976,
        fecha_valor: '2026-10-17',
        obtenida_en: hoyIso,
      })

      const resCache = await getTasaBcv()
      expect(resCache.success).toBe(true)
      expect(resCache.tasa).toBe(876.8)

      // Tasa de fecha anterior (ayer) -> fuerza sincronización en vivo exitosa
      mockObtenerUltima.mockResolvedValueOnce({
        success: true,
        tasa: 850.0,
        fecha_valor: '2026-01-01',
        obtenida_en: '2026-01-01T10:00:00Z',
      })
      mockSincronizar.mockResolvedValueOnce({
        success: true,
        tasa: 876.8,
        fecha_valor: '2026-10-17',
      })
      const resStaleSync = await getTasaBcv()
      expect(resStaleSync.success).toBe(true)
      expect(resStaleSync.tasa).toBe(876.8)

      // Tasa de fecha anterior (o sin obtenida_en) + fallo en sincronización en vivo -> usa la última conocida de BD
      mockObtenerUltima.mockResolvedValueOnce({
        success: true,
        tasa: 850.556,
        fecha_valor: '2026-01-01',
        obtenida_en: undefined,
      })
      mockSincronizar.mockResolvedValueOnce({
        success: false,
        error: 'BCV caído',
      })
      const resStaleFallback = await getTasaBcv()
      expect(resStaleFallback.success).toBe(true)
      expect(resStaleFallback.tasa).toBe(850.56)

      // Tasa vacía en BD + éxito en vivo
      mockObtenerUltima.mockResolvedValueOnce({ success: false, error: 'Empty table' })
      mockSincronizar.mockResolvedValueOnce({ success: true, tasa: 876.797, fecha_valor: '2026-10-17' })
      const resLiveFallback = await getTasaBcv()
      expect(resLiveFallback.success).toBe(true)
      expect(resLiveFallback.tasa).toBe(876.8)

      // Tasa vacía en BD + fallo en vivo sin mensaje -> retorna fallback absoluto
      mockObtenerUltima.mockResolvedValueOnce({ success: false, error: 'Empty table' })
      mockSincronizar.mockResolvedValueOnce({ success: false })

      const resFallback = await getTasaBcv()
      expect(resFallback.success).toBe(false)
      expect(resFallback.tasa).toBe(876.8)

      // forceSyncTasaBcv
      mockSincronizar.mockResolvedValueOnce({ success: true, tasa: 880.0 })
      const resForce = await forceSyncTasaBcv()
      expect(resForce.success).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. OFFLINE SYNC MANAGER
  // ─────────────────────────────────────────────────────────────
  describe('processSyncQueue (Offline Sync Manager)', () => {
    it('procesa pos_checkout, nueva_factura, pago, cola vacía y maneja errores de red o globales', async () => {
      // Cuando el navegador está explícitamente offline, no procesa la cola
      Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
      await processSyncQueue()
      expect(mockGetSyncQueue).not.toHaveBeenCalled()
      Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })

      // Cola vacía
      mockGetSyncQueue.mockResolvedValueOnce([])
      await processSyncQueue()
      expect(mockEmitirFacturaPOS).not.toHaveBeenCalled()

      // Múltiples tipos en cola + error de red en un ítem
      mockGetSyncQueue.mockResolvedValueOnce([
        { id: 'sync-1', type: 'pos_checkout', payload: { id: 1 } },
        { id: 'sync-2', type: 'nueva_factura', payload: { id: 2 } },
        { id: 'sync-3', type: 'pago', payload: { factura_id: 'f1', moneda: 'USD', monto: 10 } },
        { id: 'sync-4', type: 'pos_checkout', payload: { id: 4 } },
      ])

      mockEmitirFacturaPOS
        .mockResolvedValueOnce({ success: true, factura_id: 'fac-1' })
        .mockResolvedValueOnce({ success: false, error: 'Configuración fiscal no encontrada' })
        .mockRejectedValueOnce(new Error('Network offline'))
      mockRegistrarPago.mockResolvedValueOnce({ success: true })

      await processSyncQueue()

      expect(mockRemoveFromQueue).toHaveBeenCalledWith('sync-1')
      expect(mockRemoveFromQueue).toHaveBeenCalledWith('sync-3')
      expect(mockUpdateQueueItem).toHaveBeenCalledWith('sync-2', {
        status: 'failed',
        error: 'Configuración fiscal no encontrada',
      })

      // Error global leyendo cola
      mockGetSyncQueue.mockRejectedValueOnce(new Error('IndexedDB Crash'))
      await processSyncQueue()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. IMPRESORA FISCAL & UTILS
  // ─────────────────────────────────────────────────────────────
  describe('impresoraFiscal & cn utility', () => {
    it('imprime factura con consumidor final nulo o datos completos en modo simulación y genera Reporte Z', async () => {
      vi.useFakeTimers()

      const printPromise = impresoraFiscal.imprimirFactura(
        {
          numero_factura: '00000010',
          fecha_emision: '2026-10-17',
          tasa_bcv: 876.8,
          moneda_principal: 'VES',
          aplica_igtf: false,
          monto_igtf: 0,
          pagos: [{ moneda: 'VES', monto: 1000 }],
        } as any,
        [
          {
            descripcion: '',
            cantidad: 1,
            precio_unitario_ves: 1000,
            tipo_alicuota: 'GENERAL',
            aplica_alicuota_adicional: false,
          } as any,
        ],
        {
          razon_social: 'CLIENTE VIP',
          tipo_doc: 'J',
          numero_doc: '123456789',
          direccion_fiscal: 'AV 5 DE JULIO',
          telefono: '04141234567',
        } as any,
        { pie_pagina_1: 'Gracias por su compra', pie_pagina_2: 'Vuelva pronto' } as any
      )

      await vi.advanceTimersByTimeAsync(1000)
      const resPrint = await printPromise
      expect(resPrint.exito).toBe(true)

      // Con cliente nulo, items nulo y config nula
      const printNullPromise = impresoraFiscal.imprimirFactura(
        { numero_factura: '00000011' } as any,
        null as any,
        null as any,
        null as any
      )
      await vi.advanceTimersByTimeAsync(1000)
      expect((await printNullPromise).exito).toBe(true)

      const repZPromise = impresoraFiscal.imprimirReporteZ()
      await vi.advanceTimersByTimeAsync(1000)
      const resZ = await repZPromise
      expect(resZ.exito).toBe(true)

      vi.useRealTimers()
    })

    it('conecta con Spooler Fiscal HTTP cuando NEXT_PUBLIC_FISCAL_SPOOLER_URL está configurado y maneja fallos de conexión', async () => {
      process.env.NEXT_PUBLIC_FISCAL_SPOOLER_URL = 'http://127.0.0.1:8888'
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      // Spooler exitoso
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ numeroFacturaFiscal: '000999', serialImpresora: 'Z1B000', mensaje: 'OK Spooler' }),
      } as any)

      const resOk = await impresoraFiscal.imprimirFactura({ numero_factura: '01' } as any, [], null as any, null as any)
      expect(resOk.exito).toBe(true)
      expect(resOk.numeroFacturaFiscal).toBe('000999')

      // Spooler con campos por defecto en respuesta JSON
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as any)
      const resDefaults = await impresoraFiscal.imprimirFactura({ numero_factura: '02' } as any, [], null as any, null as any)
      expect(resDefaults.exito).toBe(true)
      expect(resDefaults.numeroFacturaFiscal).toBe('02')

      // Spooler devuelve HTTP 500 en imprimirFactura (cubre catch)
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as any)
      const resErr = await impresoraFiscal.imprimirFactura({ numero_factura: '03' } as any, [], null as any, null as any)
      expect(resErr.exito).toBe(false)

      // Spooler exitoso en Reporte Z
      fetchSpy.mockResolvedValueOnce({ ok: true } as any)
      expect((await impresoraFiscal.imprimirReporteZ()).exito).toBe(true)

      // Spooler devuelve HTTP 500 en Reporte Z (cubre catch)
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as any)
      expect((await impresoraFiscal.imprimirReporteZ()).exito).toBe(false)

      fetchSpy.mockRestore()
    })

    it('cn combina clases de Tailwind correctamente', () => {
      expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
    })
  })
})
