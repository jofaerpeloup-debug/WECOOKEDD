const { AppError } = require('../shared/errors/app-error');

/**
 * Builds an Express middleware that validates { body, params, query }
 * against a Zod schema. Parsed body/params are written back onto
 * req.body/req.params so controllers keep reading them directly, same as
 * before. req.query is never reassigned — Express 5 exposes it as a
 * getter-only property with no setter, so assigning to it is a no-op at
 * best and a thrown TypeError at worst. Parsed/normalized query values are
 * exposed instead via req.validated.query (also home to the body/params
 * copies) for any future controller that needs them. Schemas only need to
 * declare the parts they care about — omitted parts are left untouched.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.slice(1).join('.') || issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      return next(
        new AppError('Request validation failed.', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          details,
        })
      );
    }

    req.validated = {
      body: result.data.body,
      params: result.data.params,
      query: result.data.query,
    };

    if (result.data.body !== undefined) {
      req.body = result.data.body;
    }
    if (result.data.params !== undefined) {
      req.params = result.data.params;
    }
    // Deliberately no req.query assignment — see the doc comment above.

    next();
  };
}

module.exports = { validate };