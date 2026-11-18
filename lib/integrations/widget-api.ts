import { IntegrationError } from './errors.ts';
import {
  parseWidgetSelection,
  readWidget,
  widgetBudget,
  widgetFailure,
  widgetRoute,
  type WidgetDependencies,
} from './widget.ts';
export function widgetReadHandler(
  deps: WidgetDependencies,
  widgetId: string,
  eventId: string,
) {
  return widgetRoute(deps, 'widget.read', async (request: Request) => {
    const headers: Record<string, string> = {
      'Cache-Control': 'private, no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
    };
    try {
      await widgetBudget(deps, request);
      if (!['GET', 'OPTIONS'].includes(request.method))
        throw new IntegrationError(
          405,
          'METHOD_NOT_ALLOWED',
          'Use GET for public widget configuration.',
        );
      if (
        !request.headers.get('origin') ||
        request.headers.has('authorization')
      )
        throw new IntegrationError(
          403,
          'INVALID_ORIGIN',
          'Use the registered widget website without secret credentials.',
        );
      if (
        request.method === 'OPTIONS' &&
        (request.headers.get('access-control-request-method') !== 'GET' ||
          request.headers.get('access-control-request-headers'))
      )
        throw new IntegrationError(
          405,
          'METHOD_NOT_ALLOWED',
          'Widget reads support only GET without custom request headers.',
        );
      const query = new URL(request.url);
      if (
        [...query.searchParams.keys()].some((key) => key !== 'environment') ||
        query.searchParams.getAll('environment').length !== 1
      )
        throw new IntegrationError(
          400,
          'INVALID_WIDGET',
          'Specify only the widget environment.',
        );
      const url = new URL('/embed/events/' + eventId, request.url);
      url.searchParams.set('widget', widgetId);
      url.searchParams.set(
        'environment',
        query.searchParams.get('environment') || '',
      );
      url.searchParams.set(
        'parent_origin',
        request.headers.get('origin') || '',
      );
      url.searchParams.set('channel', '0'.repeat(32));
      const selection = parseWidgetSelection(url, eventId),
        { data } = await readWidget(deps, request, selection);
      headers['Access-Control-Allow-Origin'] = selection.parentOrigin;
      headers['Access-Control-Expose-Headers'] = 'X-Request-ID';
      if (request.method === 'OPTIONS') {
        headers['Access-Control-Allow-Methods'] = 'GET';
        headers['Access-Control-Max-Age'] = '60';
        return new Response(null, { status: 204, headers });
      }
      return Response.json({ data }, { headers });
    } catch (cause) {
      const error = widgetFailure(cause);
      if (error.status === 405) headers.Allow = 'GET, OPTIONS';
      if (error.retryAfter) headers['Retry-After'] = String(error.retryAfter);
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers },
      );
    }
  });
}
