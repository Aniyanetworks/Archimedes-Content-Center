// Called by n8n workflow 04. Deploy with --no-verify-jwt: the handler checks the service credential itself.
import { loadDeps } from '../_shared/deps.ts';
import { handleIssue } from '../_shared/handlers.ts';

Deno.serve(async (request) => handleIssue(request, await loadDeps()));
