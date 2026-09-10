import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { StatusCode } from "hono/utils/http-status";
import { ApplicationError } from "../errors/index.ts";
import { env } from "../env.ts";

export const globalErrorMiddleware: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException && err.message) {
    return c.json(
      {
        message: err.message,
      },
      err.status
    );
  }

  if (ApplicationError.isApplicationError(err)) {
    return c.json(err.getResponseMessage(), err.code as StatusCode);
  }

  console.error("APP ERROR:", err);
  if (env.NODE_ENV == "PRODUCTION")
    err.message = "Something went wrong, please try again later!";
  return c.json({ message: err.message }, 500);
};
