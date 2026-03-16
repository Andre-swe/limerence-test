import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { withUserStore } from "@/lib/store-context";
import type { Persona } from "@/lib/types";

type PersonaRouteParams = {
  personaId: string;
};

type PersonaRouteContext<TParams extends PersonaRouteParams> = {
  request: Request;
  params: TParams;
  persona: Persona;
  userId: string;
};

type PersonaRouteOptions = {
  errorMessage: string;
};

export function withPersonaRoute<TParams extends PersonaRouteParams>(
  handler: (
    context: PersonaRouteContext<TParams>,
  ) => Promise<Response | Record<string, unknown>>,
  options: PersonaRouteOptions,
) {
  return async (
    request: Request,
    routeContext: { params: Promise<TParams> },
  ) => {
    try {
      const params = await routeContext.params;
      const ownership = await verifyPersonaOwnership(request, params.personaId);

      if (!ownership.authorized) {
        return NextResponse.json({ error: ownership.error }, { status: ownership.status });
      }

      const result = await withUserStore(ownership.userId, () =>
        handler({
          request,
          params,
          persona: ownership.persona,
          userId: ownership.userId,
        }),
      );

      return result instanceof Response ? result : NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : options.errorMessage,
        },
        { status: 400 },
      );
    }
  };
}
