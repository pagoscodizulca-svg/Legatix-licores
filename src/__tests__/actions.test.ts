import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks globales para Next.js y Supabase
const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockAuthGetUser = vi.fn()
const mockAdminCreateUser = vi.fn()
const mockAdminDeleteUser = vi.fn()

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
    auth: {
      getUser: mockAuthGetUser,
    },
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      admin: {
        createUser: mockAdminCreateUser,
        deleteUser: mockAdminDeleteUser,
      },
    },
  }),
}))

import { emitirFacturaPOS, anularFactura } from '../app/actions/facturacion'
import { registrarMovimientoKardex } from '../app/actions/kardex'
import { registrarPago } from '../app/actions/pagos'
import { createUsuarioAction, toggleUserStatusAction } from '../app/actions/usuarios'
import { guardarConfigFiscal, guardarDatosEmpresa } from '../app/actions/configuracion'

describe('Server Actions — Flujos Críticos, Seguridad y Manejo de Errores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─────────────────────────────────────────────────────────────
  // 1. FACTURACIÓN POS & ANULACIÓN
  // ─────────────────────────────────────────────────────────────
  describe('facturacion.ts — emitirFacturaPOS & anularFactura', () => {
    const baseConfigFiscal = {
      id: 'cfg-1',
      empresa_id: 'emp-1',
      alicuota_iva_general: 16,
      alicuota_iva_adicional: 15,
      alicuota_iva_reducida: 8,
      alicuota_igtf: 3,
    }

    it('rechaza factura sin ítems o con tasa BCV inválida (Edge Case)', async () => {
      const resEmpty = await emitirFacturaPOS({
        empresa_id: 'emp-1',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'VES',
        tasa_bcv: 40,
        pagos: [],
        items: [],
      })
      expect(resEmpty.success).toBe(false)
      expect(resEmpty.error).toContain('al menos un producto')

      const resBadRate = await emitirFacturaPOS({
        empresa_id: 'emp-1',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'VES',
        tasa_bcv: 0,
        pagos: [],
        items: [{ descripcion: 'Item', cantidad: 1, unidad_medida: 'UND', precio_unitario_usd: 10, descuento_pct: 0, tipo_alicuota: 'GENERAL', aplica_alicuota_adicional: false }],
      })
      expect(resBadRate.success).toBe(false)
      expect(resBadRate.error).toContain('Tasa BCV inválida')
    })

    it('falla si no existe configuración fiscal para la empresa', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      })

      const res = await emitirFacturaPOS({
        empresa_id: 'emp-inexistente',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'VES',
        tasa_bcv: 40,
        pagos: [],
        items: [{ descripcion: 'Item', cantidad: 1, unidad_medida: 'UND', precio_unitario_usd: 10, descuento_pct: 0, tipo_alicuota: 'GENERAL', aplica_alicuota_adicional: false }],
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('Configuración fiscal no encontrada')
    })

    it('sobrescribe el precio manipulado del cliente con el precio oficial de la BD y emite la factura (Seguridad + Happy Path)', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'config_fiscal') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: baseConfigFiscal, error: null }),
              }),
            }),
          }
        }
        if (table === 'productos') {
          return {
            select: () => ({
              in: () => ({
                eq: async () => ({
                  data: [
                    {
                      id: 'prod-1',
                      precio_venta_usd: 50.0, // Precio real en BD: $50
                      gravado_iva: true,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      })

      mockRpc.mockResolvedValue({ data: 'fac-uuid-999', error: null })

      // El cliente malicioso intenta enviar precio_unitario_usd: 0.01
      const res = await emitirFacturaPOS({
        empresa_id: 'emp-1',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'USD',
        tasa_bcv: 40,
        pagos: [{ moneda: 'USD', monto: 58 }],
        items: [
          {
            producto_id: 'prod-1',
            descripcion: 'Botella Old Parr',
            cantidad: 1,
            unidad_medida: 'BOTELLA',
            precio_unitario_usd: 0.01, // Tampering attempt!
            descuento_pct: 0,
            tipo_alicuota: 'EXENTO', // Tampering attempt!
            aplica_alicuota_adicional: false,
          },
        ],
      })

      expect(res.success).toBe(true)
      expect(res.factura_id).toBe('fac-uuid-999')

      // Verificar que al RPC llegó el precio real ($50 + 16% IVA = $58) y no $0.01
      const rpcCall = mockRpc.mock.calls[0][1]
      expect(rpcCall.p_factura.subtotal_usd).toBe(50.0)
      expect(rpcCall.p_factura.total_iva_usd).toBe(8.0)
      expect(rpcCall.p_factura.total_usd).toBe(58.0)
      expect(rpcCall.p_items[0].precio_unitario_usd).toBe(50.0)
      expect(rpcCall.p_items[0].tipo_alicuota).toBe('GENERAL')
    })

    it('rechaza cantidades negativas, precios unitarios negativos o descuentos fuera de rango [0, 100]', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: baseConfigFiscal, error: null }),
          }),
          in: () => ({
            eq: async () => ({ data: [{ id: 'prod-exento', precio_venta_usd: 10, gravado_iva: false }], error: null }),
          }),
        }),
      })

      const resNegQty = await emitirFacturaPOS({
        empresa_id: 'emp-1',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'VES',
        tasa_bcv: 40,
        pagos: [],
        items: [{ descripcion: 'Item', cantidad: -2, unidad_medida: 'UND', precio_unitario_usd: 10, descuento_pct: 0, tipo_alicuota: 'GENERAL', aplica_alicuota_adicional: false }],
      })
      expect(resNegQty.success).toBe(false)
      expect(resNegQty.error).toContain('Cantidad inválida')

      const resBadDesc = await emitirFacturaPOS({
        empresa_id: 'emp-1',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'VES',
        tasa_bcv: 40,
        pagos: [],
        items: [{ descripcion: 'Item', cantidad: 1, unidad_medida: 'UND', precio_unitario_usd: 10, descuento_pct: 150, tipo_alicuota: 'GENERAL', aplica_alicuota_adicional: false }],
      })
      expect(resBadDesc.success).toBe(false)
      expect(resBadDesc.error).toContain('descuento inválido')

      const resNegPrice = await emitirFacturaPOS({
        empresa_id: 'emp-1',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'VES',
        tasa_bcv: 40,
        pagos: [],
        items: [{ descripcion: 'Item Manual', cantidad: 1, unidad_medida: 'UND', precio_unitario_usd: -5, descuento_pct: undefined as any, tipo_alicuota: 'EXENTO', aplica_alicuota_adicional: false }],
      })
      expect(resNegPrice.success).toBe(false)
      expect(resNegPrice.error).toContain('Precio unitario inválido')

      // Producto exento desde BD
      mockRpc.mockResolvedValueOnce({ data: 'fac-exento', error: null })
      const resExento = await emitirFacturaPOS({
        empresa_id: 'emp-1',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'VES',
        tasa_bcv: 40,
        pagos: [],
        items: [{ producto_id: 'prod-exento', descripcion: 'Hielo', cantidad: 1, unidad_medida: 'UND', precio_unitario_usd: 10, descuento_pct: 0, tipo_alicuota: 'GENERAL', aplica_alicuota_adicional: false }],
      })
      expect(resExento.success).toBe(true)
    })

    it('maneja errores 5xx / fallo del RPC emitir_factura_pos', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: baseConfigFiscal, error: null }),
          }),
          in: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        }),
      })
      mockRpc.mockResolvedValue({ data: null, error: { message: 'deadlock detected in postgres' } })

      const res = await emitirFacturaPOS({
        empresa_id: 'emp-1',
        cliente_id: null,
        usuario_id: 'usr-1',
        condicion_pago: 'CONTADO',
        moneda_principal: 'VES',
        tasa_bcv: 40,
        pagos: [],
        items: [{ producto_id: 'p-1', descripcion: 'Item', cantidad: 1, unidad_medida: 'UND', precio_unitario_usd: 10, descuento_pct: 0, tipo_alicuota: 'GENERAL', aplica_alicuota_adicional: false }],
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('deadlock detected in postgres')
    })

    it('anularFactura valida factura inexistente, factura ya anulada, error de update y flujo exitoso con productos simples y combos', async () => {
      // Caso 1: No encontrada
      mockFrom.mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'Not found' } }) }) }),
      })
      expect((await anularFactura('f-1', 'Error')).error).toBe('Factura no encontrada')

      // Caso 2: Ya anulada
      mockFrom.mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'f-1', estatus: 'ANULADA' }, error: null }) }) }),
      })
      expect((await anularFactura('f-1', 'Error')).error).toBe('Ya está anulada')

      // Caso 2.5: Error al actualizar estatus
      mockFrom.mockImplementationOnce(() => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { id: 'f-1', empresa_id: 'emp-1', estatus: 'EMITIDA', observaciones: 'Obs previa' },
              error: null,
            }),
          }),
        }),
      })).mockImplementationOnce(() => ({
        update: () => ({
          eq: () => ({
            eq: async () => ({ error: { message: 'DB update failed' } }),
          }),
        }),
      }))
      expect((await anularFactura('f-1', 'Error')).error).toBe('DB update failed')

      // Caso 3: Éxito con producto simple, combo y un ítem sin producto_id
      const mockInsertKardex = vi.fn().mockResolvedValue({ error: null })
      mockFrom.mockImplementation((table: string) => {
        if (table === 'facturas') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'f-1',
                    empresa_id: 'emp-1',
                    usuario_id: 'usr-1',
                    numero_factura: '00000001',
                    estatus: 'EMITIDA',
                    observaciones: null,
                    items: [
                      { producto_id: 'prod-1', cantidad: 2 },
                      { producto_id: 'combo-1', cantidad: 1 },
                      { producto_id: null, cantidad: 1 },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          }
        }
        if (table === 'productos_recetas') {
          return {
            select: () => ({
              eq: async (_col: string, val: string) => ({
                data: val === 'combo-1' ? [{ producto_base_id: 'ing-1', cantidad: 3 }] : [],
              }),
            }),
          }
        }
        if (table === 'kardex') {
          return { insert: mockInsertKardex }
        }
        return {}
      })

      const resOk = await anularFactura('f-1', 'Devolución cliente')
      expect(resOk.success).toBe(true)
      expect(mockInsertKardex).toHaveBeenCalledTimes(2) // 1 por prod-1 + 1 por ingrediente del combo-1

      // Caso 4: items null en factura
      mockFrom.mockImplementation((table: string) => {
        if (table === 'facturas') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'f-2', empresa_id: 'emp-1', estatus: 'EMITIDA', items: null },
                  error: null,
                }),
              }),
            }),
            update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
          }
        }
        return {}
      })
      expect((await anularFactura('f-2', 'Sin items')).success).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. KARDEX DE INVENTARIO
  // ─────────────────────────────────────────────────────────────
  describe('kardex.ts — registrarMovimientoKardex', () => {
    it('valida parámetros obligatorios y cantidades positivas', async () => {
      expect((await registrarMovimientoKardex({ producto_id: '', tipo: 'entrada', cantidad: 5, motivo: 'Compra' })).success).toBe(false)
      expect((await registrarMovimientoKardex({ producto_id: 'p1', tipo: 'entrada', cantidad: -3, motivo: 'Compra' })).success).toBe(false)
      expect((await registrarMovimientoKardex({ producto_id: 'p1', tipo: 'entrada', cantidad: 5, motivo: '   ' })).success).toBe(false)
    })

    it('rechaza usuario no autenticado, usuario sin perfil, error de BD y registra movimiento exitoso', async () => {
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: null } })
      const resUnauth = await registrarMovimientoKardex({ producto_id: 'p1', tipo: 'entrada', cantidad: 10, motivo: 'Recepción' })
      expect(resUnauth.success).toBe(false)
      expect(resUnauth.error).toBe('No autorizado')

      // Usuario no encontrado en tabla usuarios
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-ghost' } } })
      mockFrom.mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
      })
      const resNoUser = await registrarMovimientoKardex({ producto_id: 'p1', tipo: 'entrada', cantidad: 10, motivo: 'Recepción' })
      expect(resNoUser.success).toBe(false)
      expect(resNoUser.error).toBe('Usuario no encontrado')

      // Error insertando en kardex
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-1' } } })
      mockFrom.mockImplementation((table: string) => {
        if (table === 'usuarios') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1' } }) }) }) }
        }
        if (table === 'kardex') {
          return { insert: async () => ({ error: { message: 'Stock insuficiente trigger' } }) }
        }
        return {}
      })
      const resDbErr = await registrarMovimientoKardex({ producto_id: 'p1', tipo: 'salida', cantidad: 10, motivo: 'Merma' })
      expect(resDbErr.success).toBe(false)
      expect(resDbErr.error).toBe('Stock insuficiente trigger')

      // Caso autenticado y exitoso
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-1' } } })
      mockFrom.mockImplementation((table: string) => {
        if (table === 'usuarios') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1' } }) }) }) }
        }
        if (table === 'kardex') {
          return { insert: async () => ({ error: null }) }
        }
        return {}
      })

      const resOk = await registrarMovimientoKardex({ producto_id: 'p1', tipo: 'entrada', cantidad: 10, motivo: 'Recepción' })
      expect(resOk.success).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. PAGOS (CUENTAS POR COBRAR)
  // ─────────────────────────────────────────────────────────────
  describe('pagos.ts — registrarPago', () => {
    it('valida campos obligatorios y montos positivos', async () => {
      expect((await registrarPago({ factura_id: '', moneda: 'USD', monto: 10 })).success).toBe(false)
      expect((await registrarPago({ factura_id: 'f1', moneda: '', monto: 10 })).success).toBe(false)
      expect((await registrarPago({ factura_id: 'f1', moneda: 'USD', monto: 0 })).success).toBe(false)
    })

    it('inserta pago correctamente y maneja errores de base de datos o excepciones', async () => {
      mockFrom.mockReturnValueOnce({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'pago-1', monto: 25 }, error: null }),
          }),
        }),
      })
      const resOk = await registrarPago({ factura_id: 'f1', moneda: 'USD', monto: 25, referencia: '1234' })
      expect(resOk.success).toBe(true)

      mockFrom.mockReturnValueOnce({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: 'Foreign key violation' } }),
          }),
        }),
      })
      const resErr = await registrarPago({ factura_id: 'f1', moneda: 'USD', monto: 25 })
      expect(resErr.success).toBe(false)
      expect(resErr.error).toBe('Foreign key violation')

      // Excepción inesperada (catch)
      mockFrom.mockImplementationOnce(() => {
        throw new Error('Connection reset')
      })
      const resCrash = await registrarPago({ factura_id: 'f1', moneda: 'USD', monto: 25 })
      expect(resCrash.success).toBe(false)
      expect(resCrash.error).toBe('Connection reset')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. GESTIÓN DE USUARIOS Y RBAC (SEGURIDAD)
  // ─────────────────────────────────────────────────────────────
  describe('usuarios.ts — createUsuarioAction & toggleUserStatusAction', () => {
    it('bloquea creación de usuarios si no hay sesión o si el solicitante no es admin (RBAC)', async () => {
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: null } })
      expect((await createUsuarioAction({ empresa_id: 'emp-1', email: 'a@b.com', nombre_completo: 'A', rol: 'cajero' })).error).toBe('No autorizado')

      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'cajero-1' } } })
      mockFrom.mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'cajero' } }) }) }),
      })

      const res = await createUsuarioAction({
        empresa_id: 'emp-1',
        email: 'hacker@test.com',
        nombre_completo: 'Hacker',
        rol: 'admin',
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('Acceso denegado')
    })

    it('crea usuario exitosamente, maneja authError/user nulo y ejecuta rollback si falla el upsert', async () => {
      mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } })
      mockFrom.mockImplementation((table: string) => {
        if (table === 'usuarios') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'admin' } }) }) }),
            upsert: async () => ({ error: null }),
          }
        }
        return {}
      })
      mockAdminCreateUser.mockResolvedValueOnce({ data: { user: { id: 'new-user-1' } }, error: null })

      const resOk = await createUsuarioAction({
        empresa_id: 'emp-1',
        email: 'cajero@legatix.com',
        nombre_completo: 'Cajero Nuevo',
        rol: 'cajero',
        password: 'customPassword123',
      })
      expect(resOk.success).toBe(true)

      // Fallo en authError
      mockAdminCreateUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Email already registered' } })
      const resAuthErr = await createUsuarioAction({
        empresa_id: 'emp-1',
        email: 'dup@legatix.com',
        nombre_completo: 'Dup',
        rol: 'cajero',
      })
      expect(resAuthErr.error).toBe('Email already registered')

      // Fallo cuando userAuth.user es null sin authError
      mockAdminCreateUser.mockResolvedValueOnce({ data: { user: null }, error: null })
      const resNullUser = await createUsuarioAction({
        empresa_id: 'emp-1',
        email: 'null@legatix.com',
        nombre_completo: 'Null',
        rol: 'cajero',
      })
      expect(resNullUser.error).toBe('No se pudo crear el usuario')

      // Simular fallo en DB para probar Rollback de Auth
      mockFrom.mockImplementation((table: string) => {
        if (table === 'usuarios') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'admin' } }) }) }),
            upsert: async () => ({ error: { message: 'Constraint error' } }),
          }
        }
        return {}
      })
      mockAdminCreateUser.mockResolvedValueOnce({ data: { user: { id: 'rollback-user-id' } }, error: null })

      const resRollback = await createUsuarioAction({
        empresa_id: 'emp-1',
        email: 'fail@legatix.com',
        nombre_completo: 'Fail User',
        rol: 'cajero',
      })
      expect(resRollback.success).toBe(false)
      expect(mockAdminDeleteUser).toHaveBeenCalledWith('rollback-user-id')
    })

    it('toggleUserStatusAction valida sesión, rol admin, aislamiento multi-empresa y errores de BD', async () => {
      // No autenticado
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: null } })
      expect((await toggleUserStatusAction('usr-2', true)).error).toBe('No autorizado')

      // No es admin
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'cajero-1' } } })
      mockFrom.mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'cajero' } }) }) }),
      })
      expect((await toggleUserStatusAction('usr-2', true)).error).toContain('Acceso denegado')

      // Éxito siendo admin (con doble .eq: id y empresa_id)
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'admin-1' } } })
      const mockEqEmpresa = vi.fn().mockResolvedValue({ error: null })
      mockFrom.mockImplementation(() => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'admin' } }) }) }),
        update: () => ({ eq: () => ({ eq: mockEqEmpresa }) }),
      }))

      const res = await toggleUserStatusAction('usr-2', true)
      expect(res.success).toBe(true)
      expect(mockEqEmpresa).toHaveBeenCalledWith('empresa_id', 'emp-1')

      // Error en update
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'admin-1' } } })
      mockFrom.mockImplementation(() => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'admin' } }) }) }),
        update: () => ({ eq: () => ({ eq: async () => ({ error: { message: 'DB error toggling' } }) }) }),
      }))
      const resErr = await toggleUserStatusAction('usr-2', true)
      expect(resErr.success).toBe(false)
      expect(resErr.error).toBe('DB error toggling')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. CONFIGURACIÓN FISCAL Y DATOS DE EMPRESA
  // ─────────────────────────────────────────────────────────────
  describe('configuracion.ts — guardarConfigFiscal & guardarDatosEmpresa', () => {
    it('valida autenticación, rol admin, actualización, inserción inicial y errores en guardarConfigFiscal', async () => {
      // No autorizado
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: null } })
      expect((await guardarConfigFiscal({})).error).toBe('No autorizado')

      // No admin
      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
      mockFrom.mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'cajero' } }) }) }),
      })
      expect((await guardarConfigFiscal({})).error).toContain('Solo el administrador')

      // Update existente exitoso y con error
      mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } })
      let updateErr: any = null
      mockFrom.mockImplementation((table: string) => {
        if (table === 'usuarios') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'admin' } }) }) }) }
        }
        if (table === 'config_fiscal') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'cfg-1' } }) }) }),
            update: () => ({ eq: async () => ({ error: updateErr }) }),
          }
        }
        return {}
      })

      expect((await guardarConfigFiscal({ alicuota_iva_general: 16 })).success).toBe(true)
      updateErr = { message: 'Update failed' }
      expect((await guardarConfigFiscal({ alicuota_iva_general: 16 })).error).toBe('Update failed')

      // Insert cuando no existe config_fiscal previa (existente === null)
      let insertErr: any = null
      mockFrom.mockImplementation((table: string) => {
        if (table === 'usuarios') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'admin' } }) }) }) }
        }
        if (table === 'config_fiscal') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
            insert: async () => ({ error: insertErr }),
          }
        }
        return {}
      })

      expect((await guardarConfigFiscal({ alicuota_iva_general: 16 })).success).toBe(true)
      insertErr = { message: 'Insert failed' }
      expect((await guardarConfigFiscal({ alicuota_iva_general: 16 })).error).toBe('Insert failed')
    })

    it('valida autenticación, rol admin y errores en guardarDatosEmpresa', async () => {
      const payload = {
        razon_social: 'INVERSIONES SAN JOSE 2026, C.A',
        rif: 'J-50829833-0',
        direccion_fiscal: 'MARACAIBO',
      }

      mockAuthGetUser.mockResolvedValueOnce({ data: { user: null } })
      expect((await guardarDatosEmpresa(payload)).error).toBe('No autorizado')

      mockAuthGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
      mockFrom.mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'cajero' } }) }) }),
      })
      expect((await guardarDatosEmpresa(payload)).error).toContain('Solo el administrador')

      mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } })
      let empErr: any = null
      mockFrom.mockImplementation((table: string) => {
        if (table === 'usuarios') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: 'emp-1', rol: 'admin' } }) }) }) }
        }
        if (table === 'empresas') {
          return { update: () => ({ eq: async () => ({ error: empErr }) }) }
        }
        return {}
      })

      expect((await guardarDatosEmpresa(payload)).success).toBe(true)
      empErr = { message: 'Error actualizando empresa' }
      expect((await guardarDatosEmpresa(payload)).error).toBe('Error actualizando empresa')
    })
  })
})
