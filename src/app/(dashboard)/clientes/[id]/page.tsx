import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatUSD, formatVES } from '@/lib/fiscal'
import Link from 'next/link'
import { ArrowLeft, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default async function ClienteDetallePage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase.from('usuarios').select('empresa_id').eq('id', user.id).single()
  if (!usuario) redirect('/login')

  const [{ data: cliente }, { data: facturas }] = await Promise.all([
    supabase.from('clientes').select('*').eq('id', params.id).eq('empresa_id', usuario.empresa_id).single(),
    supabase.from('facturas').select('*').eq('cliente_id', params.id).eq('empresa_id', usuario.empresa_id).order('fecha_emision', { ascending: false })
  ])

  if (!cliente) notFound()

  const totalCompradoUSD = facturas?.filter((f: any) => f.estatus !== 'ANULADA').reduce((sum: number, f: any) => sum + Number(f.total_usd), 0) || 0

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/clientes">
          <Button variant="outline" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{cliente.razon_social}</h1>
          <p className="text-muted-foreground">{cliente.tipo_doc}: {cliente.numero_doc}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Información del Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="font-semibold text-muted-foreground">Dirección:</span>
              <p>{cliente.direccion_fiscal || 'No especificada'}</p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Teléfono:</span>
              <p>{cliente.telefono || 'No especificado'}</p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Email:</span>
              <p>{cliente.email || 'No especificado'}</p>
            </div>
            <div className="pt-4 mt-4 border-t">
              <span className="font-semibold text-muted-foreground">Total Histórico Comprado:</span>
              <p className="text-xl font-bold text-green-600">{formatUSD(totalCompradoUSD)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Historial de Facturas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Documento</th>
                    <th className="p-3">Control</th>
                    <th className="p-3 text-right">Total USD</th>
                    <th className="p-3 text-right">Total VES</th>
                    <th className="p-3 text-center">Estatus</th>
                    <th className="p-3 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {facturas?.map((f: any) => (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="p-3">{f.fecha_emision}</td>
                      <td className="p-3">{f.numero_factura}</td>
                      <td className="p-3">{f.numero_control}</td>
                      <td className="p-3 text-right font-medium">{formatUSD(f.total_usd)}</td>
                      <td className="p-3 text-right text-muted-foreground">{formatVES(f.total_ves)}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${f.estatus === 'ANULADA' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                          {f.estatus}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <Link href={`/facturacion/${f.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <FileText className="h-4 w-4" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {(!facturas || facturas.length === 0) && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        No hay facturas registradas para este cliente.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
