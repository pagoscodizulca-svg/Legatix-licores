import { NextResponse } from 'next/server'
import { calcularFacturaFiscal } from '@/lib/fiscal'
import { CrearItemPayload, ConfigFiscal, MonedaPago } from '@/types/facturacion.types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { 
      items, 
      config, 
      tasaBcv, 
      monedaPrincipal, 
      aplicarIgtf 
    }: {
      items: CrearItemPayload[]
      config: ConfigFiscal
      tasaBcv: number
      monedaPrincipal: MonedaPago
      aplicarIgtf: boolean
    } = body

    if (!items || !Array.isArray(items) || !config || !tasaBcv || tasaBcv <= 0 || !monedaPrincipal) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos o son inválidos' }, { status: 400 })
    }

    const calculo = calcularFacturaFiscal(
      items,
      config,
      tasaBcv,
      monedaPrincipal,
      aplicarIgtf
    )

    return NextResponse.json(calculo)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Error calculando totales fiscales' }, { status: 500 })
  }
}
