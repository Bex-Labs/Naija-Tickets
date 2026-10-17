(function () {
  'use strict';
  const script = document.currentScript;
  if (!script || window.NaijaTicketsCheckout) return;
  const origin = new URL(script.src).origin;
  if (
    location.origin === 'null' ||
    (origin.indexOf('https://') !== 0 &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
  )
    return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = origin + '/integrations/checkout-v1.css';
  document.head.append(stylesheet);
  let active = null;
  window.NaijaTicketsCheckout = Object.freeze({
    open: function (options) {
      if (active) throw new Error('A checkout window is already open.');
      const url = new URL(options.popupUrl);
      const match =
        /^\/embed\/checkout\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.exec(
          url.pathname,
        );
      const channel = url.searchParams.get('permit');
      if (
        url.origin !== origin ||
        url.username ||
        url.password ||
        !match ||
        !channel ||
        channel.length > 4096 ||
        url.searchParams.size !== 1 ||
        !/^#access=[a-f0-9]{64}$/.test(url.hash)
      )
        throw new Error('The secure checkout address is invalid.');
      const focus = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'nt-checkout-dialog';
      dialog.setAttribute('aria-label', 'Secure ticket checkout');
      const bar = document.createElement('div');
      bar.className = 'nt-checkout-bar';
      const label = document.createElement('span');
      label.textContent = 'Secure checkout · ' + url.host;
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.textContent = 'Close ×';
      closeButton.setAttribute(
        'aria-label',
        'Close checkout and return to website',
      );
      bar.append(label, closeButton);
      const frame = document.createElement('iframe');
      frame.title = 'Naija Tickets secure checkout';
      frame.setAttribute(
        'sandbox',
        'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox',
      );
      frame.setAttribute('allow', 'payment *');
      frame.referrerPolicy = 'no-referrer';
      frame.src = url.toString();
      dialog.append(bar, frame);
      document.body.append(dialog);
      const previousOverflow = document.documentElement.style.overflow;
      function close(completed) {
        if (active !== dialog) return;
        active = null;
        window.removeEventListener('message', message);
        dialog.close();
        dialog.remove();
        document.documentElement.style.overflow = previousOverflow;
        if (focus && focus.isConnected) focus.focus();
        if (!completed && typeof options.onClose === 'function')
          options.onClose({ sessionId: match[1] });
      }
      function message(event) {
        const data = event.data;
        if (
          event.origin !== origin ||
          event.source !== frame.contentWindow ||
          !data ||
          data.type !== 'naija.checkout.complete' ||
          data.sessionId !== match[1] ||
          data.channel !== channel
        )
          return;
        close(true);
        // This callback is a UI hint. Verify the session on your server before fulfilment.
        if (typeof options.onComplete === 'function')
          options.onComplete({ sessionId: match[1] });
      }
      closeButton.addEventListener('click', function () {
        close(false);
      });
      dialog.addEventListener('cancel', function (event) {
        event.preventDefault();
        close(false);
      });
      window.addEventListener('message', message);
      active = dialog;
      try {
        dialog.showModal();
        document.documentElement.style.overflow = 'hidden';
        closeButton.focus();
      } catch (error) {
        close(false);
        throw error;
      }
      return Object.freeze({
        close: function () {
          close(false);
        },
      });
    },
  });
})();
