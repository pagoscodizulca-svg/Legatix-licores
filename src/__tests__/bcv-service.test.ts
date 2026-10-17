import { describe, it, expect, vi, beforeEach } from 'vitest'
import https from 'https'
import { EventEmitter } from 'events'

const mockUpsert = vi.fn()
const mockSelectSingle = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: mockUpsert,
      select: () => ({
        order: () => ({
          limit: () => ({
            single: mockSelectSingle,
          }),
        }),
      }),
    }),
  }),
}))

import { sincronizarTasaBcv, obtenerUltimaTasaBcv } from '../lib/bcv-service'

describe('BCV Service — Scraper HTTPS, Timeouts y Fallos de Red/BD', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('sincronizarTasaBcv extrae correctamente la tasa y Fecha Valor del HTML del BCV (Happy Path)', async () => {
    const fakeHtml = `
      <html>
        <body>
          <div id="dolar">
            <div class="field-content">
              <strong> 876,79760000 </strong>
            </div>
          </div>
          <div>Fecha Valor: <span content="2026-10-17T00:00:00-04:00"></span></div>
        </body>
      </html>
    `

    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, callback: any) => {
      const res = new EventEmitter() as any
      res.statusCode = 200
      res.setEncoding = vi.fn()
      process.nextTick(() => {
        callback(res)
        res.emit('data', fakeHtml)
        res.emit('end')
      })
      const req = new EventEmitter() as any
      req.setTimeout = vi.fn()
      req.destroy = vi.fn()
      return req
    })

    mockUpsert.mockResolvedValueOnce({ error: null })

    const res = await sincronizarTasaBcv()
    expect(res.success).toBe(true)
    expect(res.tasa).toBe(876.8)
    expect(res.fecha_valor).toBe('2026-10-17')
    expect(res.guardado).toBe(true)
  })

  it('sincronizarTasaBcv maneja estados HTTP 503 del servidor del BCV y errores de red', async () => {
    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, callback: any) => {
      const res = new EventEmitter() as any
      res.statusCode = 503
      process.nextTick(() => callback(res))
      const req = new EventEmitter() as any
      req.setTimeout = vi.fn()
      req.destroy = vi.fn()
      return req
    })

    const res503 = await sincronizarTasaBcv()
    expect(res503.success).toBe(false)
    expect(res503.error).toContain('503')

    // Error de red / DNS
    vi.spyOn(https, 'get').mockImplementation(() => {
      const req = new EventEmitter() as any
      req.setTimeout = vi.fn()
      req.destroy = vi.fn()
      process.nextTick(() => req.emit('error', new Error('ENOTFOUND www.bcv.org.ve')))
      return req
    })

    const resNet = await sincronizarTasaBcv()
    expect(resNet.success).toBe(false)
    expect(resNet.error).toContain('ENOTFOUND')
  })

  it('sincronizarTasaBcv maneja Timeout de 15s y HTML sin bloque id="dolar"', async () => {
    vi.spyOn(https, 'get').mockImplementation(() => {
      const req = new EventEmitter() as any
      req.destroy = vi.fn()
      req.setTimeout = (_ms: number, cb: () => void) => {
        process.nextTick(cb)
      }
      return req
    })

    const resTimeout = await sincronizarTasaBcv()
    expect(resTimeout.success).toBe(false)
    expect(resTimeout.error).toContain('Timeout de 15s')

    // HTML cambiado sin bloque dolar
    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, callback: any) => {
      const res = new EventEmitter() as any
      res.statusCode = 200
      res.setEncoding = vi.fn()
      process.nextTick(() => {
        callback(res)
        res.emit('data', '<html><body>Mantenimiento</body></html>')
        res.emit('end')
      })
      const req = new EventEmitter() as any
      req.setTimeout = vi.fn()
      return req
    })

    const resNoBlock = await sincronizarTasaBcv()
    expect(resNoBlock.success).toBe(false)
    expect(resNoBlock.error).toContain('No se encontró el bloque del Dólar')

    // HTML con id="dolar" pero sin etiqueta <strong>
    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, callback: any) => {
      const res = new EventEmitter() as any
      res.statusCode = 200
      res.setEncoding = vi.fn()
      process.nextTick(() => {
        callback(res)
        res.emit('data', '<html><body><div id="dolar">Sin strong</div></body></html>')
        res.emit('end')
      })
      const req = new EventEmitter() as any
      req.setTimeout = vi.fn()
      return req
    })
    const resNoStrong = await sincronizarTasaBcv()
    expect(resNoStrong.success).toBe(false)
    expect(resNoStrong.error).toContain('No se encontró la etiqueta strong')

    // HTML con tasa 0 (inválida)
    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, callback: any) => {
      const res = new EventEmitter() as any
      res.statusCode = 200
      res.setEncoding = vi.fn()
      process.nextTick(() => {
        callback(res)
        res.emit('data', '<html><body><div id="dolar"><strong> 0,00 </strong></div></body></html>')
        res.emit('end')
      })
      const req = new EventEmitter() as any
      req.setTimeout = vi.fn()
      return req
    })
    const resZeroRate = await sincronizarTasaBcv()
    expect(resZeroRate.success).toBe(false)
    expect(resZeroRate.error).toContain('Tasa extraída es inválida')

    // HTML válido sin Fecha Valor + fallo de upsert en BD (continúa con guardado: false)
    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, callback: any) => {
      const res = new EventEmitter() as any
      res.statusCode = 200
      res.setEncoding = vi.fn()
      process.nextTick(() => {
        callback(res)
        res.emit('data', '<html><body><div id="dolar"><strong> 880,1234 </strong></div></body></html>')
        res.emit('end')
      })
      const req = new EventEmitter() as any
      req.setTimeout = vi.fn()
      return req
    })
    mockUpsert.mockResolvedValueOnce({ error: { message: 'RLS policy error' } })
    const resUpsertWarn = await sincronizarTasaBcv()
    expect(resUpsertWarn.success).toBe(true)
    expect(resUpsertWarn.tasa).toBe(880.12)
    expect(resUpsertWarn.guardado).toBe(false)
  })

  it('obtenerUltimaTasaBcv devuelve la última tasa, maneja tabla vacía (PGRST116) y errores genéricos de BD', async () => {
    mockSelectSingle.mockResolvedValueOnce({
      data: { usd: '876.80', fecha_valor: '2026-10-17', obtenida_en: '2026-10-17T10:00:00Z' },
      error: null,
    })

    const resOk = await obtenerUltimaTasaBcv()
    expect(resOk.success).toBe(true)
    expect(resOk.tasa).toBe(876.8)

    mockSelectSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    })

    const resEmpty = await obtenerUltimaTasaBcv()
    expect(resEmpty.success).toBe(false)
    expect(resEmpty.error).toContain('No hay tasas registradas')

    mockSelectSingle.mockResolvedValueOnce({
      data: null,
      error: new Error('Database connection error'),
    })

    const resGenericErr = await obtenerUltimaTasaBcv()
    expect(resGenericErr.success).toBe(false)
    expect(resGenericErr.error).toBe('Database connection error')

    // Guardia de seguridad si alguien intenta invocar bcv-service en un entorno con window (navegador)
    ;(globalThis as any).window = {}
    const resBrowserBlocked = await obtenerUltimaTasaBcv()
    expect(resBrowserBlocked.success).toBe(false)
    expect(resBrowserBlocked.error).toContain('exclusivo del servidor')
    delete (globalThis as any).window
  })
})
