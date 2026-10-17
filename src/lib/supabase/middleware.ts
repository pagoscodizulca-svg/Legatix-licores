import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  // Clonamos los headers del request para poder inyectar datos en ellos
  const requestHeaders = new Headers(request.headers)

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) => requestHeaders.set(`cookie`, `${name}=${value}`))
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Rutas públicas y endpoints de API/Cron/Monitoreo sin redirección a login
  if (
    !user &&
    (pathname === '/login' ||
      pathname.startsWith('/auth') ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/monitoring') ||
      pathname === '/manifest.json')
  ) {
    return supabaseResponse
  }

  // Redirigir a login si no está autenticado
  if (!user && pathname !== '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Si está autenticado
  if (user) {
    // Obtener rol del usuario
    let rol = 'cajero'
    let userEmpresaId = null

    try {
      const { data: profile } = await supabase
        .from('usuarios')
        .select('rol, empresa_id')
        .eq('id', user.id)
        .single()
      
      if (profile) {
        rol = profile.rol || 'cajero'
        userEmpresaId = profile.empresa_id
      }
    } catch (err) {
      // Si estamos offline, el fetch falla. Asumimos rol básico para no bloquear el acceso al POS.
      console.log('Error middleware offline, asumiendo rol cajero')
    }

    // RBAC: Proteger rutas de admin
    const isCajero = rol === 'cajero'
    const restrictedPaths = ['/dashboard', '/finanzas', '/reportes', '/configuracion', '/facturacion']
    
    // Si el usuario no tiene empresa_id, dejarlo pasar (lo manejará getCurrentUser)
    if (isCajero && userEmpresaId) {
      // Verificar si intenta entrar a una ruta restringida
      if (restrictedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
        const url = request.nextUrl.clone()
        url.pathname = '/pos' // Enviar al cajero directo al POS
        return NextResponse.redirect(url)
      }
    }

    // Si es cajero y va a '/' redirigir a '/pos' en vez de '/dashboard'
    if (pathname === '/' || pathname === '/login') {
      const url = request.nextUrl.clone()
      url.pathname = isCajero ? '/pos' : '/dashboard'
      return NextResponse.redirect(url)
    }

    // ─── OPTIMIZACIÓN: inyectar user_id y rol en headers ───────────────────────────
    // Los Server Components leen estos headers vía `getCurrentUser()` en
    // user-context.ts, eliminando la necesidad de llamar auth.getUser()
    // en cada página/layout. Reducción de ~1 round-trip por navegación.
    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-user-email', user.email ?? '')
    requestHeaders.set('x-user-rol', rol)

    supabaseResponse = NextResponse.next({
      request: { headers: requestHeaders },
    })
    // Replicar cookies en la nueva respuesta
    request.cookies.getAll().forEach(cookie => {
      supabaseResponse.cookies.set(cookie.name, cookie.value)
    })
    // ────────────────────────────────────────────────────────────────────────
  }

  return supabaseResponse
}
