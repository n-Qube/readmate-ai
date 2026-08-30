import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRoute<TRequest extends Request> = (
  req: TRequest,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/** Forward rejected route promises to Express 4's error middleware. */
export function asyncHandler<TRequest extends Request = Request>(handler: AsyncRoute<TRequest>): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req as TRequest, res, next)).catch(next);
  };
}
