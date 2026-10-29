(function () {
  'use strict';
  const script = document.currentScript;
  if (!script || window.__naijaWidgetV1) return;
  let origin;
  try {
    origin = new URL(script.src).origin;
    if (location.origin === 'null') return;
  } catch {
    return;
  }
  const frames = [];
  function mount() {
    document
      .querySelectorAll('[data-naija-widget]')
      .forEach(function (container) {
        if (container.getAttribute('data-naija-mounted')) return;
        const widget = container.getAttribute('data-naija-widget') || '';
        const event = container.getAttribute('data-event') || '';
        const mode = container.getAttribute('data-environment') || '';
        if (
          !/^nt_widget_[a-f0-9]{32}$/.test(widget) ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(event) ||
          !/^(test|live)$/.test(mode)
        )
          return;
        const theme = {
          appearance: container.getAttribute('data-appearance'),
          accent: container.getAttribute('data-accent'),
          button: container.getAttribute('data-button'),
        };
        if (
          (theme.appearance && !['light', 'dark'].includes(theme.appearance)) ||
          (theme.accent &&
            !['green', 'blue', 'violet'].includes(theme.accent)) ||
          (theme.button && !['rounded', 'square'].includes(theme.button))
        )
          return;
        const channel = Array.from(
          crypto.getRandomValues(new Uint8Array(16)),
          function (n) {
            return n.toString(16).padStart(2, '0');
          },
        ).join('');
        const url = new URL('/embed/events/' + event, origin);
        url.searchParams.set('widget', widget);
        url.searchParams.set('environment', mode);
        url.searchParams.set('parent_origin', location.origin);
        let returnUrl;
        try {
          returnUrl = new URL(
            container.getAttribute('data-return-url') ||
              location.origin + location.pathname,
          );
          if (
            returnUrl.origin !== location.origin ||
            returnUrl.search ||
            returnUrl.hash ||
            returnUrl.username ||
            returnUrl.password
          )
            return;
        } catch {
          return;
        }
        url.searchParams.set('return_url', returnUrl.href);
        url.searchParams.set('channel', channel);
        Object.entries(theme).forEach(function (entry) {
          if (entry[1]) url.searchParams.set(entry[0], entry[1]);
        });
        const frame = document.createElement('iframe');
        frame.src = url.href;
        frame.title = 'Choose event tickets with Naija Tickets';
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer';
        frame.setAttribute(
          'sandbox',
          'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox',
        );
        frame.style.width = '100%';
        frame.style.maxWidth = '100%';
        frame.style.height = '640px';
        frame.style.border = '0';
        frame.style.display = 'block';
        const fallback = document.createElement('a');
        fallback.href = url.href;
        fallback.target = '_blank';
        fallback.rel = 'noopener noreferrer';
        fallback.textContent = 'Open ticket selection';
        frames.push({ frame: frame, channel: channel });
        container.appendChild(frame);
        container.appendChild(fallback);
        container.setAttribute('data-naija-mounted', 'true');
      });
  }
  window.addEventListener('message', function (event) {
    if (
      event.origin === origin &&
      event.data &&
      event.data.type === 'naija:widget:checkout-complete:v1'
    ) {
      const entry = frames.find(function (item) {
        return (
          item.channel === event.data.channel &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
            event.data.sessionId || '',
          ) &&
          event.data.status === 'paid' &&
          /^(test|live)$/.test(event.data.environment || '')
        );
      });
      if (!entry) return;
      const detail = Object.freeze({
        sessionId: event.data.sessionId,
        status: event.data.status,
        environment: event.data.environment,
      });
      window.dispatchEvent(
        new CustomEvent('naijaTicketsCheckoutComplete', { detail: detail }),
      );
      if (!entry.frame.parentNode.querySelector('.naija-ticket-status')) {
        const status = document.createElement('p');
        status.className = 'naija-ticket-status';
        status.setAttribute('role', 'status');
        status.textContent =
          'Payment confirmed. Your ticket details are being verified.';
        entry.frame.parentNode.appendChild(status);
      }
      return;
    }
    if (
      event.origin !== origin ||
      !event.data ||
      event.data.type !== 'naija:widget:resize:v1'
    )
      return;
    const message = event.data;
    const entry = frames.find(function (item) {
      return (
        item.frame.contentWindow === event.source &&
        item.channel === message.channel
      );
    });
    if (
      !entry ||
      !Number.isInteger(message.height) ||
      message.height < 260 ||
      message.height > 1200
    )
      return;
    entry.frame.style.height = message.height + 'px';
  });
  window.__naijaWidgetV1 = Object.freeze({ mount: mount });
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
