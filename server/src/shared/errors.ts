export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code = 'INTERNAL',
  ) {
    super(message)
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} não encontrado`, 404, 'NOT_FOUND')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Sem permissão') {
    super(message, 403, 'FORBIDDEN')
  }
}
