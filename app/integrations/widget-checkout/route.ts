import { widgetCheckoutHandler } from '@/lib/integrations/widget-html';
import { widgetDependencies } from '@/lib/integrations/widget.server';
export const runtime = 'nodejs';
export const POST = widgetCheckoutHandler(widgetDependencies);
