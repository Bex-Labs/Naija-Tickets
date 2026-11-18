(function () {
  'use strict';
  const setup = document.getElementById('setup');
  setup.addEventListener('submit', function (event) {
    event.preventDefault();
    const error = document.getElementById('error');
    error.textContent = '';
    try {
      const url = new URL(document.getElementById('api').value);
      const mode = document.getElementById('mode').value;
      const widget = document.getElementById('widget').value.trim();
      const id = document.getElementById('event').value.trim();
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        (url.protocol !== 'https:' &&
          !(mode === 'test' && local && url.protocol === 'http:')) ||
        !/^nt_widget_[a-f0-9]{32}$/.test(widget) ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
      )
        throw new Error(
          'Enter the exact deployment origin, public widget ID and assigned event ID.',
        );
      const container = document.createElement('div');
      container.setAttribute('data-naija-widget', widget);
      container.setAttribute('data-event', id);
      container.setAttribute('data-environment', mode);
      ['appearance', 'accent', 'button'].forEach(function (setting) {
        container.setAttribute('data-' + setting, document.getElementById(setting).value);
      });
      document.getElementById('mount').replaceChildren(container);
      const script = document.createElement('script');
      script.src = new URL('/integrations/widget-v1.js', url).href;
      script.defer = true;
      document.head.appendChild(script);
      setup.querySelectorAll('input, select, button').forEach(function (input) {
        input.disabled = true;
      });
      document.getElementById('configuration').open = false;
    } catch (cause) {
      error.textContent = cause.message;
    }
  });
  document.querySelectorAll('[data-width]').forEach(function (button) {
    button.addEventListener('click', function () {
      const width = button.getAttribute('data-width');
      document.getElementById('preview').style.width =
        width === '100%' ? width : width + 'px';
    });
  });
})();
