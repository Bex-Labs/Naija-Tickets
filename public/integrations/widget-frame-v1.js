(function () {
  'use strict';
  const root = document.querySelector('.widget[data-parent-origin]');
  if (!root) return;
  const form = root.querySelector('form');
  const selects = Array.from(form.querySelectorAll('select[data-price]'));
  const output = document.getElementById('subtotal');
  const admissions = document.getElementById('admissions');
  const button = form.querySelector('button[type="submit"]');
  const checkoutAllowed = !button.disabled;
  function update() {
    let subtotal = 0,
      count = 0,
      packages = 0;
    selects.forEach(function (select) {
      let quantity = Number(select.value);
      if (!Number.isInteger(quantity) || quantity < 0) quantity = 0;
      subtotal += quantity * Number(select.getAttribute('data-price'));
      count += quantity * Number(select.getAttribute('data-admissions'));
      packages += quantity;
    });
    output.textContent = !packages
      ? 'Select tickets'
      : Number.isSafeInteger(subtotal)
        ? new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN',
            maximumFractionDigits: 2,
            minimumFractionDigits: 0,
          }).format(subtotal / 100)
        : 'Confirmed at checkout';
    admissions.textContent = count
      ? count +
        (count === 1 ? ' admission' : ' admissions') +
        ' · Discounts and fees confirmed at checkout.'
      : 'Discounts and fees are confirmed at checkout.';
    button.disabled = !checkoutAllowed || !packages || count > 400;
  }
  form.addEventListener('change', update);
  form.addEventListener('submit', function (event) {
    update();
    if (button.disabled) event.preventDefault();
    // Native form navigation preserves the user gesture and opens checkout at
    // the top level. No checkout capability is posted to the parent website.
  });
  function resize() {
    if (parent === window) return;
    const height = Math.min(
      1200,
      Math.max(260, Math.ceil(root.getBoundingClientRect().height) + 2),
    );
    parent.postMessage(
      {
        type: 'naija:widget:resize:v1',
        channel: root.getAttribute('data-channel'),
        height: height,
      },
      root.getAttribute('data-parent-origin'),
    );
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(root);
  window.addEventListener('resize', resize);
  update();
  resize();
})();
