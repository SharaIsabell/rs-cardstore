document.addEventListener('DOMContentLoaded', () => {
    // Lógica para atualização de quantidade
    document.querySelectorAll('.quantity-input').forEach(input => {
        input.addEventListener('change', (e) => {
            if (parseInt(e.target.value, 10) > 0) {
                 e.target.closest('form').submit();
            }
        });
    });

    // --- Lógica do Endereço e Frete ---
    const useRegisteredBtn = document.getElementById('use-registered-address-btn');
    const useNewBtn = document.getElementById('use-new-address-btn');
    const addressFormContainer = document.getElementById('address-form-container');
    const calculateBtn = document.getElementById('calculate-shipping-btn');
    const cepInput = document.getElementById('cep-input');
    const optionsContainer = document.getElementById('shipping-options-container');
    const shippingError = document.getElementById('shipping-error');
    const checkoutBtn = document.querySelector('.checkout-btn');

    const addressFields = {
        rua: document.getElementById('rua-input'),
        numero: document.getElementById('numero-input'),
        complemento: document.getElementById('complemento-input'),
        bairro: document.getElementById('bairro-input'),
        cidade: document.getElementById('cidade-input'),
        estado: document.getElementById('estado-input')
    };

    const clearAddressForm = () => {
        cepInput.value = '';
        Object.values(addressFields).forEach(field => {
            field.value = '';
            if(field.hasAttribute('readonly')) {
                field.readOnly = false;
            }
        });
        shippingError.textContent = '';
        optionsContainer.innerHTML = '';
        checkoutBtn.classList.add('disabled');
    };

    if(useRegisteredBtn) {
        useRegisteredBtn.addEventListener('click', async () => {
            clearAddressForm();
            try {
                const response = await fetch('/api/get-address');
                if (!response.ok) throw new Error('Falha ao buscar endereço.');
                
                const data = await response.json();
                if (data.success && data.address) {
                    const address = JSON.parse(data.address);
                    cepInput.value = address.cep || '';
                    addressFields.rua.value = address.rua || '';
                    addressFields.numero.value = address.numero || '';
                    addressFields.complemento.value = address.complemento || '';
                    addressFields.bairro.value = address.bairro || '';
                    addressFields.cidade.value = address.cidade || '';
                    addressFields.estado.value = address.estado || '';
                    addressFormContainer.style.display = 'block';
                } else {
                    shippingError.textContent = 'Nenhum endereço cadastrado. Por favor, preencha abaixo.';
                    addressFormContainer.style.display = 'block';
                }
            } catch (error) {
                shippingError.textContent = error.message;
            }
        });
    }

    // Botão "Novo Endereço"
    if(useNewBtn) {
        useNewBtn.addEventListener('click', () => {
            clearAddressForm();
            addressFormContainer.style.display = 'block';
            cepInput.focus();
        });
    }

    // Auto-complete do CEP
    if(cepInput) {
        cepInput.addEventListener('blur', async () => {
            const cep = cepInput.value.replace(/\D/g, '');
            if (cep.length !== 8) return;

            shippingError.textContent = '';
            try {
                const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                const data = await response.json();
                if (data.erro) {
                    shippingError.textContent = 'CEP não encontrado.';
                    return;
                }
                
                const preencherCampo = (campo, valor) => {
                    campo.value = valor || '';
                };

                preencherCampo(addressFields.rua, data.logradouro); 
                preencherCampo(addressFields.bairro, data.bairro);
                preencherCampo(addressFields.cidade, data.localidade);
                preencherCampo(addressFields.estado, data.uf);

                addressFields.numero.focus();
            } catch (error) {
                shippingError.textContent = 'Erro ao consultar o CEP.';
            }
        });
    }

    // Desabilita botão de finalizar se qualquer campo do endereço for alterado
    [cepInput, ...Object.values(addressFields)].forEach(input => {
        if(input) {
            input.addEventListener('input', () => {
                checkoutBtn.classList.add('disabled');
                optionsContainer.innerHTML = '';
                document.getElementById('summary-shipping').textContent = 'R$ 0.00';
            });
        }
    });

    // Botão "Calcular Frete"
    if(calculateBtn) {
        calculateBtn.addEventListener('click', async () => {
            const cep = cepInput.value.replace(/\D/g, '');
            shippingError.textContent = '';
            optionsContainer.innerHTML = '';

            if (!cep) {
                shippingError.textContent = 'O campo CEP é obrigatório.';
                return;
            }

            optionsContainer.innerHTML = '<p>Calculando...</p>';
            calculateBtn.disabled = true;

            try {
                const response = await fetch('/carrinho/calcular-frete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cep })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Erro ao calcular frete.');
                
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
                    <input type="radio" id="shipping-${option.id}" name="shipping-option" value="${option.price}" data-name="${option.name}" required ${index === 0 ? 'checked' : ''}>
                    <label for="shipping-${option.id}">
                        <strong>${option.name}</strong> - R$ ${parseFloat(option.price).toFixed(2)} 
                        <em>(Prazo: ${option.delivery_time} dias)</em>
                    </label>
                </li>`;
        });
        html += '</ul>';
        optionsContainer.innerHTML = html;

        document.querySelectorAll('input[name="shipping-option"]').forEach(radio => {
            radio.addEventListener('change', updateTotalsAndSave);
        });

        updateTotalsAndSave();
    }

    async function updateTotalsAndSave() {
        const selectedShipping = document.querySelector('input[name="shipping-option"]:checked');
        if (!selectedShipping) return;

        // Atualiza resumo na tela
        const shippingCost = parseFloat(selectedShipping.value);
        const subtotalElement = document.getElementById('summary-total');
        const subtotal = parseFloat(subtotalElement.getAttribute('data-subtotal'));
        const total = subtotal + shippingCost;
        document.getElementById('summary-shipping').textContent = `R$ ${shippingCost.toFixed(2)}`;
        subtotalElement.textContent = `R$ ${total.toFixed(2)}`;

        // Coleta dados do frete e do endereço
        const shippingInfo = {
            cost: shippingCost,
            name: selectedShipping.getAttribute('data-name')
        };
        const addressInfo = {
            cep: cepInput.value,
            rua: addressFields.rua.value,
            numero: addressFields.numero.value,
            complemento: addressFields.complemento.value,
            bairro: addressFields.bairro.value,
            cidade: addressFields.cidade.value,
            estado: addressFields.estado.value
        };

        try {
            const response = await fetch('/carrinho/salvar-frete-e-endereco', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shipping: shippingInfo, address: addressInfo })
            });

            if (!response.ok) throw new Error('Falha ao salvar dados da entrega.');
            
            checkoutBtn.classList.remove('disabled'); // Habilita o botão
        } catch (error) {
            shippingError.textContent = error.message;
            checkoutBtn.classList.add('disabled');
        }
    }
});