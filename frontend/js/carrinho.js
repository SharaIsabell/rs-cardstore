document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.quantity-input').forEach(input => {
        input.addEventListener('change', (e) => {
            if (parseInt(e.target.value, 10) > 0) {
                e.target.closest('form').submit();
            }
        });
    });
    const calculateBtn = document.getElementById('calculate-shipping-btn');
    const cepInput = document.getElementById('cep-input');
    const optionsContainer = document.getElementById('shipping-options-container');
    const shippingError = document.getElementById('shipping-error');

    if (calculateBtn) {
        calculateBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cep = cepInput.value.replace(/\D/g, ''); // Remove caracteres não numéricos

            if (cep.length !== 8) {
                shippingError.textContent = 'Por favor, insira um CEP válido com 8 dígitos.';
                return;
            }

            optionsContainer.innerHTML = '<p>Calculando...</p>';
            shippingError.textContent = '';
            calculateBtn.disabled = true;

            try {
                const response = await fetch('/carrinho/calcular-frete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cep })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Erro ao calcular frete.');
                }

                const validOptions = data.filter(opt => !opt.error);

                if (validOptions.length === 0) {
                    optionsContainer.innerHTML = '<p>Nenhuma opção de frete encontrada para este CEP.</p>';
                } else {
                    displayShippingOptions(validOptions);
                }

            } catch (error) {
                shippingError.textContent = error.message;
                optionsContainer.innerHTML = '';
            } finally {
                calculateBtn.disabled = false;
            }
        });
    }

    function displayShippingOptions(options) {
        let html = '<ul>';
        options.forEach((option, index) => {
            html += `
      <li>
        <input
          type="radio"
          id="shipping-${option.id || index}"
          name="shipping-option"
          value="${option.price}"
          data-name="${option.name}"
          data-delivery="${option.delivery_time || ''}"
          required
          ${index === 0 ? 'checked' : ''}>
        <label for="shipping-${option.id || index}">
          <strong>${option.name}</strong> - R$ ${parseFloat(option.price).toFixed(2)}
          ${option.delivery_time ? `<em>(Prazo: ${option.delivery_time} dias)</em>` : ''}
        </label>
      </li>
    `;
        });
        html += '</ul>';
        optionsContainer.innerHTML = html;

        document.querySelectorAll('input[name="shipping-option"]').forEach(radio => {
            radio.addEventListener('change', updateTotals);
        });

        updateTotals();
    }

    function updateTotals() {
        const selectedShipping = document.querySelector('input[name="shipping-option"]:checked');
        if (!selectedShipping) return;

        const shippingCost = parseFloat(selectedShipping.value);
        const shippingName = selectedShipping.dataset.name || '';
        const shippingPrazo = selectedShipping.dataset.delivery || '';

        const subtotal = parseFloat(document.getElementById('subtotal').value) || 0;
        const total = subtotal + (isNaN(shippingCost) ? 0 : shippingCost);

        document.getElementById('summary-shipping').textContent =
            isNaN(shippingCost) ? 'R$ 0.00' : `R$ ${shippingCost.toFixed(2)}`;
        document.getElementById('summary-total').textContent = `R$ ${total.toFixed(2)}`;

        document.getElementById('frete_valor').value = isNaN(shippingCost) ? '' : shippingCost.toFixed(2);
        document.getElementById('frete_servico').value = shippingName;
        document.getElementById('frete_prazo').value = shippingPrazo;

        const btn = document.getElementById('btn-finalizar');
        if (btn) btn.disabled = isNaN(shippingCost);
    }
    const formFinalizar = document.getElementById('finalizar');
    formFinalizar && formFinalizar.addEventListener('submit', (e) => {
        if (!document.getElementById('frete_valor').value) {
            e.preventDefault();
            alert('Selecione uma opção de frete para continuar.');
        }
    });

});