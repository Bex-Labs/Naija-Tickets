export type WidgetConfiguration = {
  environment: 'test' | 'live';
  enabled: boolean;
  checkoutEnabled: boolean;
  revision: number;
};
export const WIDGET_ID_PATTERN = /^nt_widget_[a-f0-9]{32}$/;
export type WidgetSelection = {
  widgetId: string;
  eventId: string;
  environment: 'test' | 'live';
  parentOrigin: string;
  returnUrl: string;
  channel: string;
  appearance?: 'light' | 'dark';
  accent?: 'green' | 'blue' | 'violet';
  button?: 'rounded' | 'square';
};
