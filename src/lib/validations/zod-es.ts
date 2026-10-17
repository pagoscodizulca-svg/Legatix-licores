import { z } from 'zod'

export const esErrorMap = (issue: { code: string; message?: string }, ctx: { defaultError: string }): { message: string } => {
  let message = ctx.defaultError

  switch (issue.code) {
    case 'invalid_type':
      message = 'Tipo inválido o campo obligatorio'
      break
    case 'too_small':
      message = 'Valor demasiado pequeño o texto muy corto'
      break
    case 'too_big':
      message = 'Valor demasiado grande o texto muy largo'
      break
    case 'custom':
      message = issue.message ?? 'Error de validación'
      break
  }

  return { message }
}

if (typeof (z as any).setErrorMap === 'function') {
  ;(z as any).setErrorMap(esErrorMap)
}

