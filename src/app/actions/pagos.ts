'use server'

import { createClient } from '@/lib/supabase/server'

export async function registrarPago(payload: {
  factura_id: string
  moneda: string
  monto: number
  referencia?: string
  tasa_bcv_dia?: number
}) {
  if (!payload.factura_id) {
    return { success: false, error: 'ID de factura es requerido' }
  }
  if (!payload.moneda) {
    return { success: false, error: 'Moneda de pago es requerida' }
  }
  if (!payload.monto || payload.monto <= 0 || !Number.isFinite(payload.monto)) {
    return { success: false, error: 'El monto del pago debe ser mayor a cero' }
  }

  const supabase = createClient()
  
  try {
    const { data, error } = await supabase
      .from('facturas_pagos')
      .insert({
        factura_id: payload.factura_id,
        moneda: payload.moneda,
        monto: payload.monto,
        referencia: payload.referencia || null
      })
      .select()
      .single()
      
    if (error) {
      console.error('Error insertando pago:', error)
      return { success: false, error: error.message }
    }
    
    return { success: true, pago: data }
  } catch (error: any) {
    console.error('Exception registrando pago:', error)
    return { success: false, error: error.message }
  }
}
