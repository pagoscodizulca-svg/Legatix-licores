import { describe, it, expect } from 'vitest'
import {
  calcularFacturaFiscal,
  calcularItemFiscal,
  redondear,
  formatUSD,
  formatVES,
  formatPct,
  formatNumeroControl,
  formatNumeroFactura,
  monedaActivaIgtf,
  MONEDA_LABELS,
  MONEDA_SIMBOLO,
} from '../lib/fiscal'
import type { ConfigFiscal, CrearItemPayload } from '../types/facturacion.types'

describe('Motor de Cálculo Fiscal SENIAT (Actualizado)', () => {
  const configBase: ConfigFiscal = {
    id: '1',
    empresa_id: '1',
    alicuota_iva_general: 16,
    alicuota_iva_adicional: 15,
    alicuota_iva_reducida: 8,
    alicuota_igtf: 3,
    proximo_numero_control: 1,
    prefijo_control: '00-',
    pie_pagina_1: '',
    pie_pagina_2: '',
    mensaje_retenciones: '',
    updated_at: '',
  }

  const tasaBcv = 40.0 // 1 USD = 40 Bs

  describe('calcularItemFiscal — Happy Path & Edge Cases', () => {
    it('Calcula un ítem general correctamente sin descuento', () => {
      const item: CrearItemPayload = {
        descripcion: 'Agua Minalba',
        cantidad: 2,
        unidad_medida: 'UNIDAD',
        precio_unitario_usd: 1.5, // Subtotal 3.00 USD
        descuento_pct: 0,
        tipo_alicuota: 'GENERAL',
        aplica_alicuota_adicional: false,
      }

      const calc = calcularItemFiscal(item, configBase, tasaBcv)

      expect(calc.subtotal_usd).toBe(3.0)
      expect(calc.monto_descuento_usd).toBe(0)
      expect(calc.alicuota_iva_pct).toBe(16)
      expect(calc.monto_iva_usd).toBe(0.48) // 16% de 3.00 = 0.48
      expect(calc.monto_iva_adicional_usd).toBe(0)
      expect(calc.total_usd).toBe(3.48)
      expect(calc.precio_unitario_ves).toBe(60.0) // 1.50 * 40
    })

    it('Calcula un licor aplicando únicamente IVA General (16%), sin alícuota adicional', () => {
      const item: CrearItemPayload = {
        descripcion: 'Ron Cacique',
        cantidad: 1,
        unidad_medida: 'BOTELLA',
        precio_unitario_usd: 10.0,
        descuento_pct: 0,
        tipo_alicuota: 'GENERAL',
        aplica_alicuota_adicional: true,
      }

      const calc = calcularItemFiscal(item, configBase, tasaBcv)

      expect(calc.subtotal_usd).toBe(10.0)
      expect(calc.monto_iva_usd).toBe(1.6) // 16% general
      expect(calc.alicuota_adicional_pct).toBe(0)
      expect(calc.monto_iva_adicional_usd).toBe(0) // Eliminada por regla de negocio
      expect(calc.total_usd).toBe(11.6)
    })

    it('Calcula correctamente descuentos porcentuales (ej. 10% y 100%)', () => {
      const item10: CrearItemPayload = {
        descripcion: 'Whisky 12 Años',
        cantidad: 2,
        unidad_medida: 'BOTELLA',
        precio_unitario_usd: 25.0, // Bruto 50.00
        descuento_pct: 10, // Descuento 5.00 -> Subtotal 45.00
        tipo_alicuota: 'GENERAL',
        aplica_alicuota_adicional: false,
      }

      const calc10 = calcularItemFiscal(item10, configBase, tasaBcv)
      expect(calc10.monto_descuento_usd).toBe(5.0)
      expect(calc10.subtotal_usd).toBe(45.0)
      expect(calc10.monto_iva_usd).toBe(7.2) // 16% de 45 = 7.20
      expect(calc10.total_usd).toBe(52.2)

      // Edge case: 100% descuento (promoción/cortesía)
      const item100: CrearItemPayload = {
        ...item10,
        descuento_pct: 100,
      }
      const calc100 = calcularItemFiscal(item100, configBase, tasaBcv)
      expect(calc100.subtotal_usd).toBe(0)
      expect(calc100.monto_iva_usd).toBe(0)
      expect(calc100.total_usd).toBe(0)
    })

    it('Calcula un ítem EXENTO de IVA (0%) y sin descuento_pct explícito', () => {
      const itemExento = {
        descripcion: 'Bolsa de Hielo 5Kg',
        cantidad: 3,
        unidad_medida: 'BOLSA',
        precio_unitario_usd: 2.0,
        tipo_alicuota: 'EXENTO',
      } as CrearItemPayload

      const calc = calcularItemFiscal(itemExento, configBase, tasaBcv)
      expect(calc.subtotal_usd).toBe(6.0)
      expect(calc.alicuota_iva_pct).toBe(0)
      expect(calc.monto_iva_usd).toBe(0)
      expect(calc.total_usd).toBe(6.0)
    })
  })

  describe('calcularFacturaFiscal — Totales y Monedas', () => {
    it('Calcula una factura mixta (Gravados + Exentos) en USD sin aplicar IGTF', () => {
      const items: CrearItemPayload[] = [
        {
          descripcion: 'Ron',
          cantidad: 1,
          unidad_medida: 'BOTELLA',
          precio_unitario_usd: 10.0,
          descuento_pct: 0,
          tipo_alicuota: 'GENERAL',
          aplica_alicuota_adicional: true,
        },
        {
          descripcion: 'Hielo (Exento)',
          cantidad: 1,
          unidad_medida: 'BOLSA',
          precio_unitario_usd: 2.0,
          descuento_pct: 0,
          tipo_alicuota: 'EXENTO',
          aplica_alicuota_adicional: false,
        },
      ]

      const calculo = calcularFacturaFiscal(items, configBase, tasaBcv, 'USD', true)

      expect(calculo.subtotal).toBe(12.0) // 10 + 2
      expect(calculo.base_general).toBe(10.0)
      expect(calculo.base_adicional).toBe(0)
      expect(calculo.exento).toBe(2.0)
      expect(calculo.iva_general).toBe(1.6)
      expect(calculo.iva_adicional).toBe(0)
      expect(calculo.total_iva).toBe(1.6)
      expect(calculo.igtf).toBe(0) // Eliminado del sistema
      expect(calculo.total).toBe(13.6)
      expect(calculo.total_ves).toBe(13.6 * 40)
    })

    it('Calcula una factura completa pagada en Bs (VES)', () => {
      const items: CrearItemPayload[] = [
        {
          descripcion: 'Ron',
          cantidad: 1,
          unidad_medida: 'BOTELLA',
          precio_unitario_usd: 10.0,
          descuento_pct: 0,
          tipo_alicuota: 'GENERAL',
          aplica_alicuota_adicional: false,
        },
      ]

      const calculo = calcularFacturaFiscal(items, configBase, tasaBcv, 'VES', false)

      expect(calculo.subtotal).toBe(10.0)
      expect(calculo.total_iva).toBe(1.6)
      expect(calculo.igtf).toBe(0)
      expect(calculo.total).toBe(11.6)
      expect(calculo.total_ves).toBe(464.0)
    })

    it('Maneja arreglo vacío de ítems (Edge Case)', () => {
      const calculo = calcularFacturaFiscal([], configBase, tasaBcv, 'VES', false)
      expect(calculo.subtotal).toBe(0)
      expect(calculo.total_iva).toBe(0)
      expect(calculo.total).toBe(0)
      expect(calculo.total_ves).toBe(0)
    })
  })

  describe('Funciones Utilitarias de Formato y Redondeo', () => {
    it('redondear() ajusta correctamente a 2 y 4 decimales', () => {
      expect(redondear(10.556)).toBe(10.56)
      expect(redondear(10.554)).toBe(10.55)
      expect(redondear(36.456789, 4)).toBe(36.4568)
    })

    it('formatUSD, formatVES y formatPct formatean valores correctamente', () => {
      expect(formatUSD(1234.5)).toBe('$1,234.50')
      expect(formatVES(876.8)).toContain('Bs.')
      expect(formatPct(16)).toBe('16.00%')
    })

    it('formatNumeroControl y formatNumeroFactura rellenan con ceros a la izquierda', () => {
      expect(formatNumeroControl('00-', 45)).toBe('00-0000045')
      expect(formatNumeroFactura(123)).toBe('00000123')
    })

    it('monedaActivaIgtf y diccionarios de moneda funcionan adecuadamente', () => {
      expect(monedaActivaIgtf('USD')).toBe(true)
      expect(monedaActivaIgtf('EUR')).toBe(true)
      expect(monedaActivaIgtf('VES')).toBe(false)
      expect(MONEDA_LABELS.USD).toContain('USD')
      expect(MONEDA_SIMBOLO.VES).toBe('Bs.')
    })
  })
})
