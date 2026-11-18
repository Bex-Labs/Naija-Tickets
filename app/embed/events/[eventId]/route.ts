import { widgetPageHandler } from '@/lib/integrations/widget-html';
import { widgetDependencies } from '@/lib/integrations/widget.server';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  return widgetPageHandler(
    widgetDependencies,
    (await context.params).eventId,
  )(request);
}
