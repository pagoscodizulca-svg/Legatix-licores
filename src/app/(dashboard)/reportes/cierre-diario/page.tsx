import { getCurrentUser } from '@/lib/supabase/user-context'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CierreDiarioClient } from '@/components/reportes/CierreDiarioClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Cierre Diario — Legatix POS',
}

export default async function CierreDiarioPage({
  searchParams
}: {
  searchParams: { date?: string }
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  
  // Si no hay fecha, usar la de hoy local (UTC-4 aprox)
  const today = new Date()
  today.setHours(today.getHours() - 4) // Ajuste rápido
  const defaultDateStr = today.toISOString().split('T')[0]
  const targetDate = searchParams.date || defaultDateStr

  // Rango de fechas (todo el día objetivo)
  const startOfDay = `${targetDate}T00:00:00.000Z`
  const endOfDay = `${targetDate}T23:59:59.999Z`

  // Consultas en paralelo
  const [
    empresaRes,
    facturasRes,
    pagosRes,
    alertasStockRes,
    kardexRes
  ] = await Promise.all([
    supabase.from('empresas').select('*').eq('id', user.empresa_id).single(),
    supabase.from('facturas')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .neq('estatus', 'ANULADA')
      .gte('fecha_emision', targetDate) // la fecha_emision es YYYY-MM-DD
      .lte('fecha_emision', targetDate),
    supabase.from('facturas_pagos')
      .select('monto, moneda, facturas!inner(empresa_id, fecha_emision, estatus)')
      .eq('facturas.empresa_id', user.empresa_id)
      .eq('facturas.fecha_emision', targetDate)
      .neq('facturas.estatus', 'ANULADA'),
    supabase.from('productos')
      .select('id, codigo_sku, nombre, stock_actual, stock_minimo')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .lte('stock_actual', 5), // Asumimos alerta <= 5 o según config
    supabase.from('kardex')
      .select('producto_id, stock_anterior, stock_nuevo, created_at, productos(nombre, codigo_sku)')
      .eq('empresa_id', user.empresa_id)
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .order('created_at', { ascending: true })
  ])

  // Procesar Kardex para agrupar por producto (Tomar primer stock_anterior y último stock_nuevo)
  const inventarioMap = new Map<string, { nombre: string, sku: string, inicial: number, final: number }>()
  
  if (kardexRes.data) {
    kardexRes.data.forEach((mov: any) => {
      const pid = mov.producto_id
      const p = mov.productos as any
      if (!inventarioMap.has(pid)) {
        inventarioMap.set(pid, {
          nombre: p?.nombre || 'Desconocido',
          sku: p?.codigo_sku || '',
          inicial: mov.stock_anterior,
          final: mov.stock_nuevo
        })
      } else {
        // Actualizar el final con el último movimiento
        const curr = inventarioMap.get(pid)!
        curr.final = mov.stock_nuevo
        inventarioMap.set(pid, curr)
      }
    })
  }

  const inventarioMovimientos = Array.from(inventarioMap.values())

  return (
    <CierreDiarioClient
      targetDate={targetDate}
      empresa={empresaRes.data}
      facturas={facturasRes.data || []}
      pagos={pagosRes.data || []}
      alertasStock={alertasStockRes.data || []}
      inventario={inventarioMovimientos}
    />
  )
}
