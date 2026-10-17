import { getCurrentUser } from '@/lib/supabase/user-context'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DollarSign, ShoppingBag, TrendingUp, Package, CreditCard, Banknote, Coins, AlertTriangle, Wallet, FileText } from 'lucide-react'
import { formatUSD, formatVES } from '@/lib/fiscal'
import { redirect } from 'next/navigation'
import { VentasChart } from '@/components/dashboard/VentasChart'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getCurrentUser()

  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-2xl font-bold text-red-600">Error de Configuración</h2>
        <p className="text-muted-foreground">
          Tu usuario no tiene una empresa asignada o el perfil no se creó correctamente en la base de datos.<br />
          Por favor, contacta al administrador o verifica que los scripts SQL iniciales se ejecutaron.
        </p>
        <form action="/auth/signout" method="post">
          <button className="mt-4 rounded-md bg-black px-4 py-2 text-white">Cerrar Sesión</button>
        </form>
      </div>
    )
  }

  const supabase = createClient()
  const hoyStr = new Date().toISOString().split('T')[0]
  
  const hace30Dias = new Date()
  hace30Dias.setDate(hace30Dias.getDate() - 30)
  const hace30DiasStr = hace30Dias.toISOString().split('T')[0]

  // Todas las queries del dashboard en paralelo
  const [predictivasRes, facturasHoyRes, pagosDataRes, productosStockBajoRes, cxcFacturasRes, cxpFacturasRes, facturas30DiasRes] = await Promise.all([
    supabase.rpc('obtener_alertas_predictivas', { p_empresa_id: user.empresa_id }),
    supabase
      .from('facturas')
      .select('total_usd, total_ves, estatus')
      .eq('empresa_id', user.empresa_id)
      .eq('fecha_emision', hoyStr)
      .neq('estatus', 'ANULADA'),
    supabase
      .from('facturas_pagos')
      .select('monto, moneda, referencia, facturas!inner(empresa_id, fecha_emision, estatus)')
      .eq('facturas.empresa_id', user.empresa_id)
      .eq('facturas.fecha_emision', hoyStr)
      .neq('facturas.estatus', 'ANULADA'),
    supabase
      .from('productos')
      .select('id, nombre, stock_actual, precio_usd')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .lte('stock_actual', 5)
      .order('stock_actual', { ascending: true })
      .limit(6),
    supabase
      .from('facturas')
      .select('total_usd, pagos:facturas_pagos(monto)')
      .eq('empresa_id', user.empresa_id)
      .eq('tipo_documento', 'FACTURA')
      .eq('condicion_pago', 'CREDITO')
      .neq('estatus', 'ANULADA'),
    supabase
      .from('facturas_compras')
      .select('total_factura, moneda, tasa_bcv, pagos:compras_pagos(monto)')
      .eq('empresa_id', user.empresa_id)
      .eq('condicion_pago', 'CREDITO'),
    supabase
      .from('facturas')
      .select('fecha_emision, total_usd')
      .eq('empresa_id', user.empresa_id)
      .neq('estatus', 'ANULADA')
      .gte('fecha_emision', hace30DiasStr)
      .order('fecha_emision', { ascending: true })
  ])

  const facturasHoy = facturasHoyRes.data
  const pagosData = pagosDataRes.data
  const productosStockBajo = productosStockBajoRes.data
  const cxcFacturas = cxcFacturasRes.data
  const cxpFacturas = cxpFacturasRes.data

  const totalUSD = facturasHoy?.reduce((acc: number, f: any) => acc + Number(f.total_usd), 0) || 0
  const totalVES = facturasHoy?.reduce((acc: number, f: any) => acc + Number(f.total_ves), 0) || 0
  const cantidadFacturas = facturasHoy?.length || 0

  const pagosPorMoneda: Record<string, number> = (pagosData || []).reduce((acc: Record<string, number>, p: any) => {
    const metodo = p.referencia || p.moneda
    acc[metodo] = (acc[metodo] || 0) + Number(p.monto)
    return acc
  }, {})

  const totalCxC = (cxcFacturas || []).reduce((acc: number, f: any) => {
    const abonado = (f.pagos || []).reduce((pAcc: number, p: any) => pAcc + Number(p.monto), 0)
    return acc + Math.max(0, Number(f.total_usd) - abonado)
  }, 0)

  const totalCxP = (cxpFacturas || []).reduce((acc: number, f: any) => {
    const totalUsd = f.moneda === 'VES' ? Number(f.total_factura) / Number(f.tasa_bcv) : Number(f.total_factura)
    const abonado = (f.pagos || []).reduce((pAcc: number, p: any) => pAcc + Number(p.monto), 0)
    const abonadoUsd = f.moneda === 'VES' ? abonado / Number(f.tasa_bcv) : abonado
    return acc + Math.max(0, totalUsd - abonadoUsd)
  }, 0)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Resumen de Hoy</h2>
        <p className="text-muted-foreground text-sm mt-1">Métricas clave y facturación en tiempo real del día ({hoyStr}).</p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
        <MetricCard
          title="Facturación (USD)"
          value={formatUSD(totalUSD)}
          icon={<DollarSign className="h-4 w-4 text-primary" />}
          trend="Total facturado hoy en divisas"
          href="/facturacion"
        />
        <MetricCard
          title="Facturación (VES)"
          value={formatVES(totalVES)}
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          trend="Total facturado hoy en bolívares"
          href="/facturacion"
        />
        <MetricCard
          title="Documentos"
          value={cantidadFacturas.toString()}
          icon={<ShoppingBag className="h-4 w-4 text-primary" />}
          trend="Facturas emitidas exitosamente"
          href="/facturacion"
        />
        <MetricCard
          title="Alertas de Stock"
          value={`${productosStockBajo?.length || 0} ítems`}
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          trend="Productos en límite mínimo"
          href="/inventario"
        />
        <MetricCard
          title="Por Cobrar (CxC)"
          value={formatUSD(totalCxC)}
          icon={<Wallet className="h-4 w-4 text-orange-400" />}
          trend="Deudas de clientes pendientes"
          href="/finanzas?tab=cxc"
        />
        <MetricCard
          title="Por Pagar (CxP)"
          value={formatUSD(totalCxP)}
          icon={<FileText className="h-4 w-4 text-red-400" />}
          trend="Deudas a proveedores pendientes"
          href="/finanzas?tab=cxp"
        />
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-1">
        <VentasChart facturas30Dias={facturas30DiasRes.data || []} />
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-7">
        
        {/* Desglose de Dinero Recibido */}
        <Card className="lg:col-span-4 glass-card border-border/50 bg-card/60 backdrop-blur-xl shadow-xl">
          <CardHeader className="border-b border-border/50 bg-secondary/30 pb-4">
            <CardTitle className="text-primary text-sm font-semibold flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              Dinero Recibido (Por Método)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {Object.keys(pagosPorMoneda).length === 0 ? (
              <div className="h-[220px] flex flex-col items-center justify-center text-muted-foreground">
                <Coins className="h-8 w-8 opacity-20 mb-2" />
                <p className="text-sm">Aún no se han registrado pagos hoy</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {Object.entries(pagosPorMoneda).map(([metodo, monto]) => {
                  const montoNum = Number(monto)
                  let icono = <Coins className="h-5 w-5" />
                  let formato = formatVES(montoNum)
                  let nombreFormateado = metodo.replace('_', ' ')

                  if (metodo === 'EFECTIVO_USD' || metodo === 'USD') {
                    icono = <DollarSign className="h-5 w-5" />
                    formato = formatUSD(montoNum)
                  } else if (metodo === 'EFECTIVO_BS' || metodo === 'VES') {
                    icono = <Banknote className="h-5 w-5" />
                  } else if (metodo.includes('TARJETA') || metodo === 'PUNTO') {
                    icono = <CreditCard className="h-5 w-5" />
                  }
                  
                  return (
                    <div key={metodo} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg">
                          {icono}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground capitalize">{nombreFormateado.toLowerCase()}</p>
                          <p className="text-xs text-muted-foreground">Método de Pago</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-foreground">{formato}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Productos Stock Mínimo */}
        <Card className="lg:col-span-3 glass-card border-border/50 bg-card/60 backdrop-blur-xl shadow-xl">
          <CardHeader className="border-b border-border/50 bg-secondary/30 pb-4">
            <CardTitle className="text-destructive text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4" />
              Alerta: Stock Mínimo
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {productosStockBajo && productosStockBajo.length > 0 ? (
              <div className="divide-y divide-border/50">
                {productosStockBajo.map((prod: any) => (
                  <div key={prod.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                    <div>
                      <p className="font-medium text-sm text-foreground truncate max-w-[180px]">{prod.nombre}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatUSD(prod.precio_usd)}</p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold bg-destructive/10 text-destructive border border-destructive/20">
                        {prod.stock_actual} ud.
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
               <div className="h-[220px] flex flex-col items-center justify-center text-muted-foreground">
                 <Package className="h-8 w-8 opacity-20 mb-2 text-green-500" />
                 <p className="text-sm">Todo el inventario está óptimo</p>
               </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alertas Predictivas Inteligentes */}
      {predictivasRes.data && predictivasRes.data.length > 0 && (
        <div className="mt-8 mb-4">
          <h2 className="text-lg font-bold tracking-tight mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Motor Analítico Predictivo (Recomendaciones)
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {predictivasRes.data.map((alerta: any, i: number) => (
              <div key={i} className={`p-4 rounded-xl border ${alerta.tipo === 'ESTANCADO' ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-sm text-foreground">{alerta.nombre_producto}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{alerta.mensaje}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ml-2 ${alerta.tipo === 'ESTANCADO' ? 'bg-slate-200 text-slate-700' : 'bg-amber-200 text-amber-700'}`}>
                    {alerta.tipo === 'ESTANCADO' ? `${Number(alerta.dato_numerico)} días estancado` : `¡Alta rotación!`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

import Link from 'next/link'

function MetricCard({ title, value, icon, trend, href }: { title: string, value: string, icon: React.ReactNode, trend: string, href?: string }) {
  const CardContentCustom = (
    <Card className="glass-card border-border/50 relative overflow-hidden group shadow-lg h-full transition-colors hover:border-primary/50">
      <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-bl-full -z-10 transition-transform group-hover:scale-110"></div>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 px-5 pt-5">
        <CardTitle className="text-[11px] leading-tight font-bold uppercase tracking-wider text-muted-foreground mr-2">{title}</CardTitle>
        <div className="p-2 bg-black/50 rounded-lg border border-white/5 shadow-[0_0_10px_rgba(245,176,39,0.1)] group-hover:shadow-[0_0_15px_rgba(245,176,39,0.3)] group-hover:border-primary/40 transition-all flex-shrink-0">
          {icon}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="text-2xl font-extrabold tracking-tight text-foreground drop-shadow-sm truncate">{value}</div>
        <p className="text-[11px] leading-tight font-medium text-muted-foreground/80 mt-1">
          {trend}
        </p>
      </CardContent>
    </Card>
  )

  if (href) {
    return <Link href={href} className="block h-full">{CardContentCustom}</Link>
  }

  return CardContentCustom
}
