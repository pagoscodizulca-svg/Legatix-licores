'use server'

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createUsuarioAction(data: {
  empresa_id: string
  email: string
  nombre_completo: string
  rol: 'admin' | 'cajero' | 'bodeguero'
  password?: string
}) {
  try {
    const supabase = createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'No autorizado' }
    const { data: usuario } = await supabase.from('usuarios').select('empresa_id, rol').eq('id', user.id).single()
    if (!usuario || usuario.rol !== 'admin' || usuario.empresa_id !== data.empresa_id) {
      return { success: false, error: 'Acceso denegado. Se requiere rol de administrador para esta empresa.' }
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1. Create auth user
    const { data: userAuth, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password || '12345678', // Contraseña por defecto si no se provee
      email_confirm: true,
            user_metadata: { 
        nombre_completo: data.nombre_completo,
        empresa_id: data.empresa_id,
        rol: data.rol
      }
    })

    if (authError) throw new Error(authError.message)

    if (!userAuth.user) throw new Error('No se pudo crear el usuario')

    // 2. Insert into usuarios table
    const { error: dbError } = await supabaseAdmin
      .from('usuarios')
      .upsert({
        id: userAuth.user.id,
        empresa_id: data.empresa_id,
        email: data.email,
        nombre_completo: data.nombre_completo,
        rol: data.rol,
        activo: true
      })

    if (dbError) {
      // Rollback
      await supabaseAdmin.auth.admin.deleteUser(userAuth.user.id)
      throw new Error(dbError.message)
    }

    revalidatePath('/usuarios')
    return { success: true }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

export async function toggleUserStatusAction(userId: string, currentStatus: boolean) {
  try {
    const supabase = createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'No autorizado' }
    const { data: usuario } = await supabase.from('usuarios').select('empresa_id, rol').eq('id', user.id).single()
    if (!usuario || usuario.rol !== 'admin') {
      return { success: false, error: 'Acceso denegado. Se requiere rol de administrador.' }
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { error } = await supabaseAdmin
      .from('usuarios')
      .update({ activo: !currentStatus })
      .eq('id', userId)
      .eq('empresa_id', usuario.empresa_id)

    if (error) throw new Error(error.message)

    revalidatePath('/usuarios')
    return { success: true }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}
