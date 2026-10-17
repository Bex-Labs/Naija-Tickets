import { widgetDependencies } from '@/lib/integrations/widget.server';
import { widgetReadHandler } from '@/lib/integrations/widget-api';
export const runtime = 'nodejs';
type Context = { params: Promise<{ widgetId: string; eventId: string }> };
async function handle(request: Request, context: Context) {
  const { widgetId, eventId } = await context.params;
  return widgetReadHandler(widgetDependencies, widgetId, eventId)(request);
}
export const GET = handle;
export const OPTIONS = handle;
