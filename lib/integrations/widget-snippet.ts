import type { WidgetSelection } from './widget-types.ts';
export function escapeWidgetHtml(value: string | number) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
}
export function widgetSnippet(
  origin: string,
  config: Pick<
    WidgetSelection,
    'widgetId' | 'eventId' | 'environment' | 'appearance' | 'accent' | 'button'
  >,
) {
  const safe = escapeWidgetHtml;
  const theme = Object.entries({
    appearance: config.appearance,
    accent: config.accent,
    button: config.button,
  })
    .filter(([, value]) => value)
    .map(([name, value]) => ` data-${name}="${safe(value!)}"`)
    .join('');
  return `<div data-naija-widget="${safe(config.widgetId)}" data-event="${safe(config.eventId)}" data-environment="${config.environment}"${theme}></div>\n<script src="${safe(origin)}/integrations/widget-v1.js" defer></script>`;
}
