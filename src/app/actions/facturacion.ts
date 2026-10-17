'use server'

import { createClient } from '@/lib/supabase/server'
import { calcularFacturaFiscal, calcularItemFiscal } from '@/lib/fiscal'
import { ConfigFiscal, CrearItemPayload, MonedaPago } from '@/types/facturacion.types'

export async function emitirFacturaPOS(data: {
  empresa_id: string
  cliente_id: string | null
  usuario_id: string
  turno_id?: string
  condicion_pago: string
  moneda_principal: MonedaPago
  tasa_bcv: number
  pagos: { moneda: string; monto: number; referencia?: string }[]
  items: CrearItemPayload[]
}) {
  const supabase = createClient()

  if (!data.items || data.items.length === 0) {
    return { success: false, error: 'La factura debe contener al menos un producto' }
  }

  if (!data.tasa_bcv || data.tasa_bcv <= 0) {
    return { success: false, error: 'Tasa BCV inválida' }
  }

  // 1. Obtener Configuración Fiscal
  const { data: configFiscal } = await supabase
    .from('config_fiscal')
    .select('*')
    .eq('empresa_id', data.empresa_id)
    .single()

  if (!configFiscal) {
    return { success: false, error: 'Configuración fiscal no encontrada' }
  }

  // 1.5 Validar precios y alícuotas reales contra la base de datos (Seguridad contra manipulación del cliente)
  const productIds = data.items.map(i => i.producto_id).filter(Boolean) as string[]
  const dbProductsMap = new Map<string, any>()

  if (productIds.length > 0) {
    const { data: dbProducts } = await supabase
      .from('productos')
      .select('id, precio_venta_usd, gravado_iva, nombre, codigo_sku, unidad_medida')
      .in('id', productIds)
      .eq('empresa_id', data.empresa_id)

    if (dbProducts) {
      for (const p of dbProducts) {
        dbProductsMap.set(p.id, p)
      }
    }
  }

  const sanitizedItems: CrearItemPayload[] = []
  for (const item of data.items) {
    if (item.cantidad <= 0) {
      return { success: false, error: `Cantidad inválida para el producto ${item.descripcion}` }
    }
    const descPct = item.descuento_pct ?? 0
    if (descPct < 0 || descPct > 100) {
      return { success: false, error: `Porcentaje de descuento inválido (${descPct}%)` }
    }

    const dbProd = item.producto_id ? dbProductsMap.get(item.producto_id) : null
    const verifiedPrice = dbProd ? Number(dbProd.precio_venta_usd) : item.precio_unitario_usd

    if (verifiedPrice < 0) {
      return { success: false, error: `Precio unitario inválido para ${item.descripcion}` }
    }

    sanitizedItems.push({
      ...item,
      precio_unitario_usd: verifiedPrice,
      tipo_alicuota: dbProd ? (dbProd.gravado_iva ? 'GENERAL' : 'EXENTO') : item.tipo_alicuota,
    })
  }

  // 2. Recalcular todo en el servidor (Seguridad)
  const aplicaIgtf = false // IGTF deshabilitado por regla de negocio actual
  const totales = calcularFacturaFiscal(sanitizedItems, configFiscal as ConfigFiscal, data.tasa_bcv, data.moneda_principal, aplicaIgtf)

  // 3. Preparar payload de Factura
  const facturaPayload = {
    empresa_id: data.empresa_id,
    cliente_id: data.cliente_id,
    usuario_id: data.usuario_id,
    turno_id: data.turno_id,
    tipo_documento: 'FACTURA',
    condicion_pago: data.condicion_pago,
    moneda_principal: data.moneda_principal,
    tasa_bcv: data.tasa_bcv,
    fecha_emision: new Date().toISOString().split('T')[0],
    aplica_igtf: aplicaIgtf,
    base_igtf: 0,
    monto_igtf: totales.igtf,
    alicuota_igtf_aplicada: configFiscal.alicuota_igtf,
    base_imponible_general: totales.base_general,
    monto_iva_general: totales.iva_general,
    base_imponible_adicional: totales.base_adicional,
    monto_iva_adicional: totales.iva_adicional,
    base_imponible_reducida: totales.base_reducida,
    monto_iva_reducida: totales.iva_reducida,
    monto_exento: totales.exento,
    subtotal_usd: totales.subtotal,
    total_iva_usd: totales.total_iva,
    total_usd: totales.total,
    total_ves: totales.total_ves,
    alicuota_iva_general_aplicada: configFiscal.alicuota_iva_general,
    alicuota_iva_adicional_aplicada: configFiscal.alicuota_iva_adicional,
    observaciones: 'Generada desde POS'
  }

  // 4. Preparar payload de Items
  const itemsPayload = sanitizedItems.map((item, idx) => {
    const calc = calcularItemFiscal(item, configFiscal as ConfigFiscal, data.tasa_bcv)
    return {
      producto_id: item.producto_id,
      descripcion: item.descripcion,
      codigo_sku: item.codigo_sku,
      cantidad: item.cantidad,
      unidad_medida: item.unidad_medida,
      precio_unitario_usd: item.precio_unitario_usd,
      precio_unitario_ves: calc.precio_unitario_ves,
      descuento_pct: item.descuento_pct,
      monto_descuento_usd: calc.monto_descuento_usd,
      subtotal_usd: calc.subtotal_usd,
      tipo_alicuota: item.tipo_alicuota,
      alicuota_iva_pct: calc.alicuota_iva_pct,
      monto_iva_usd: calc.monto_iva_usd,
      total_usd: calc.total_usd,
      aplica_alicuota_adicional: item.aplica_alicuota_adicional,
      alicuota_adicional_pct: calc.alicuota_adicional_pct,
      monto_iva_adicional_usd: calc.monto_iva_adicional_usd,
      orden: idx + 1
    }
  })

  // 5. Llamar al RPC Transaccional
  const { data: facturaId, error } = await supabase.rpc('emitir_factura_pos', {
    p_factura: facturaPayload,
    p_items: itemsPayload,
    p_pagos: data.pagos
  })

  if (error) {
    console.error('RPC Error:', error)
    return { success: false, error: error.message }
  }

  return { success: true, factura_id: facturaId }
}

export async function anularFactura(facturaId: string, motivo: string) {
  const supabase = createClient()
  
  // 1. Obtener la factura original con sus ítems
  const { data: original, error: errGet } = await supabase
    .from('facturas')
    .select('*, items:facturas_items(*)')
    .eq('id', facturaId)
    .single()
    
  if (errGet || !original) return { success: false, error: 'Factura no encontrada' }
  if (original.estatus === 'ANULADA') return { success: false, error: 'Ya está anulada' }
  
  // 2. Marcar documento como ANULADA y registrar motivo en observaciones
  const nuevaObservacion = original.observaciones
    ? `${original.observaciones} | Anulada: ${motivo}`
    : `Anulada: ${motivo}`

  const { error: errUpdate } = await supabase
    .from('facturas')
    .update({ estatus: 'ANULADA', observaciones: nuevaObservacion })
    .eq('id', original.id)
    .eq('empresa_id', original.empresa_id)

  if (errUpdate) return { success: false, error: errUpdate.message }
  
  // 3. Revertir el inventario en el Kardex (soportando productos simples y recetas de Combos)
  for (const item of original.items || []) {
    if (item.producto_id) {
      const { data: receta } = await supabase
        .from('combo_items')
        .select('producto_ingrediente_id, cantidad')
        .eq('combo_id', item.producto_id)

      if (receta && receta.length > 0) {
        for (const ing of receta) {
          await supabase.from('kardex').insert({
            empresa_id: original.empresa_id,
            producto_id: ing.producto_ingrediente_id,
            usuario_id: original.usuario_id,
            tipo: 'entrada',
            cantidad: Number(item.cantidad) * Number(ing.cantidad),
            motivo: `Anulación Nota ${original.numero_factura} (Combo)`,
            stock_anterior: 0,
            stock_nuevo: 0
          })
        }
      } else {
        await supabase.from('kardex').insert({
          empresa_id: original.empresa_id,
          producto_id: item.producto_id,
          usuario_id: original.usuario_id,
          tipo: 'entrada',
          cantidad: item.cantidad,
          motivo: `Anulación Nota ${original.numero_factura}`,
          stock_anterior: 0,
          stock_nuevo: 0
        })
      }
    }
  }
  
  return { success: true }
}

