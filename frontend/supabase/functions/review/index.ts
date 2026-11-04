// Public endpoint for the client review portal. Deploy with --no-verify-jwt: the signed token is the auth.
import { loadDeps } from '../_shared/deps.ts';
import { handleReview } from '../_shared/handlers.ts';

Deno.serve(async (request) => handleReview(request, await loadDeps()));
