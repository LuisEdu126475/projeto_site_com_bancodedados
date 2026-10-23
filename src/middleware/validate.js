import { HttpError } from '../utils/httpError.js';

/**
 * Valida req.body / req.query / req.params com um esquema Zod.
 * O resultado validado e normalizado fica em req.valid.{body,query,params}.
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid ??= {};
  for (const [part, schema] of Object.entries(schemas)) {
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        fields[key] ??= issue.message;
      }
      return next(
        new HttpError(422, Object.values(fields)[0] ?? 'Dados inválidos.', {
          code: 'VALIDATION_ERROR',
          details: { fields },
        }),
      );
    }
    req.valid[part] = result.data;
  }
  next();
};

