import createMiddleware from "next-intl/middleware";
import { routing } from "./app/[locale]/routing";

export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next.js internals, and files with an extension (assets).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
