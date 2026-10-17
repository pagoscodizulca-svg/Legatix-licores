import { describe, it, expect } from 'vitest'
import { productoSchema } from '../lib/validations/producto.schema'
import { esErrorMap } from '../lib/validations/zod-es'
import { z } from 'zod'

describe('Producto Schema Validation & Español Error Map', () => {
  const baseValidProduct = {
    codigo_sku: 'PRD-001',
    nombre: 'Vino Tinto Reserva',
    unidad_medida: 'BOTELLA',
    precio_costo: 10,
    precio_venta: 15,
    precio_venta_usd: 15,
    stock_actual: 100,
    stock_minimo: 10,
    es_licor: false,
    gravado_iva: true,
    alicuota_iva: 16,
    activo: true,
  }

  it('debería validar un producto estándar correctamente (Happy Path)', () => {
    const result = productoSchema.safeParse(baseValidProduct)
    expect(result.success).toBe(true)
  })

  it('debería convertir strings numéricos mediante z.coerce (Edge Case)', () => {
    const result = productoSchema.safeParse({
      ...baseValidProduct,
      precio_costo: '12.50',
      precio_venta_usd: '18.75',
      stock_actual: '50',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.precio_costo).toBe(12.5)
      expect(result.data.precio_venta_usd).toBe(18.75)
      expect(result.data.stock_actual).toBe(50)
    }
  })

  it('debería rechazar un producto estándar si el precio o stock es negativo', () => {
    const result = productoSchema.safeParse({
      ...baseValidProduct,
      precio_costo: -5,
      stock_actual: -1,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path[0])
      expect(paths).toContain('precio_costo')
      expect(paths).toContain('stock_actual')
    }
  })

  it('debería rechazar SKU vacío o nombre de 1 solo carácter', () => {
    const result = productoSchema.safeParse({
      ...baseValidProduct,
      codigo_sku: '',
      nombre: 'A',
    })
    expect(result.success).toBe(false)
  })

  it('debería rechazar grado alcohólico mayor a 100%', () => {
    const result = productoSchema.safeParse({
      ...baseValidProduct,
      es_licor: true,
      volumen_litros: 0.75,
      grado_alcoholico: 120,
    })
    expect(result.success).toBe(false)
  })

  it('debería fallar si es_licor es true pero faltan volumen o grado alcohólico', () => {
    const result = productoSchema.safeParse({
      ...baseValidProduct,
      es_licor: true,
      volumen_litros: 0,
      grado_alcoholico: null,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path[0])
      expect(paths).toContain('volumen_litros')
      expect(paths).toContain('grado_alcoholico')
    }
  })

  it('debería validar correctamente un licor con volumen y grado alcohólico correctos', () => {
    const result = productoSchema.safeParse({
      ...baseValidProduct,
      es_licor: true,
      volumen_litros: 0.75,
      grado_alcoholico: 12.5,
    })

    expect(result.success).toBe(true)
  })

  it('debería probar todas las ramas de zod-es errorMap', () => {
    expect(esErrorMap({ code: z.ZodIssueCode.invalid_type } as any, { defaultError: 'err' }).message)
      .toBe('Tipo inválido o campo obligatorio')
    expect(esErrorMap({ code: z.ZodIssueCode.too_small } as any, { defaultError: 'err' }).message)
      .toBe('Valor demasiado pequeño o texto muy corto')
    expect(esErrorMap({ code: z.ZodIssueCode.too_big } as any, { defaultError: 'err' }).message)
      .toBe('Valor demasiado grande o texto muy largo')
    expect(esErrorMap({ code: z.ZodIssueCode.custom } as any, { defaultError: 'err' }).message)
      .toBe('Error de validación')
    expect(esErrorMap({ code: 'other_code' } as any, { defaultError: 'default msg' }).message)
      .toBe('default msg')
  })
})
