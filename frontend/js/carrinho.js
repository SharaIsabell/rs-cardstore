document.addEventListener('DOMContentLoaded', () => {
    // Lógica para atualização de quantidade
    document.querySelectorAll('.quantity-input').forEach(input => {
        input.addEventListener('change', (e) => {
            if (parseInt(e.target.value, 10) > 0) {
                 e.target.closest('form').submit();
            }
        });
    });

    // --- Lógica para Cálculo de Frete ---
    const calculateBtn = document.getElementById('calculate-shipping-btn');
    const cepInput = document.getElementById('cep-input');
    const optionsContainer = document.getElementById('shipping-options-container');
    const shippingError = document.getElementById('shipping-error');

    if (calculateBtn) {
        calculateBtn.addEventListener('click', async () => {
            const cep = cepInput.value.replace(/\D/g, '');

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
            // Adicionado o atributo data-name para guardar o nome do serviço
            html += `
                <li>
                    <input type="radio" id="shipping-${option.id}" name="shipping-option" value="${option.price}" data-name="${option.name}" required ${index === 0 ? 'checked' : ''}>
                    <label for="shipping-${option.id}">
                        <strong>${option.name}</strong> - R$ ${parseFloat(option.price).toFixed(2)} 
                        <em>(Prazo: ${option.delivery_time} dias)</em>
                    </label>
                </li>
            `;
        });
        html += '</ul>';
        optionsContainer.innerHTML = html;

        document.querySelectorAll('input[name="shipping-option"]').forEach(radio => {
            radio.addEventListener('change', updateTotals);
        });

        // Chama a função pela primeira vez para selecionar a opção padrão
        updateTotals(); 
    }

    async function updateTotals() {
        const selectedShipping = document.querySelector('input[name="shipping-option"]:checked');
        if (!selectedShipping) return;

        const shippingCost = parseFloat(selectedShipping.value);
        const shippingName = selectedShipping.getAttribute('data-name'); // Pega o nome
        const subtotalElement = document.getElementById('summary-total');
        const subtotal = parseFloat(subtotalElement.getAttribute('data-subtotal'));
        const total = subtotal + shippingCost;

        // Atualiza os valores na tela
        document.getElementById('summary-shipping').textContent = `R$ ${shippingCost.toFixed(2)}`;
        document.getElementById('summary-total').textContent = `R$ ${total.toFixed(2)}`;

        // --- Envia o frete para o servidor para salvar na sessão ---
        try {
            await fetch('/carrinho/salvar-frete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cost: shippingCost, name: shippingName })
            });
        } catch (error) {
            console.error('Erro ao salvar o frete na sessão:', error);
        }
    }
});