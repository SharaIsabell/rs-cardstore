document.addEventListener('DOMContentLoaded', () => {
    const mpPublicKey = window.mpPublicKey;
    if (!mpPublicKey) {
        console.error('Chave pública do Mercado Pago não encontrada.');
        return;
    }

    const mp = new MercadoPago(mpPublicKey);

    // --- Lógica para o Cartão Animado ---
    new Card({
        form: '#form-checkout-card',
        container: '.card-wrapper',
        formSelectors: {
            numberInput: 'input[name="number"]',
            expiryInput: 'input[name="expiry"]',
            cvcInput: 'input[name="cvc"]',
            nameInput: 'input[name="name"]'
        },
        placeholders: {
            number: '•••• •••• •••• ••••',
            name: 'Nome Completo',
            expiry: '••/••',
            cvc: '•••'
        }
    });
    
    let pollingInterval;

    // Elementos do DOM
    const paymentMethodRadios = document.querySelectorAll('input[name="paymentMethod"]');
    const cardFormContainer = document.getElementById('form-checkout-card');
    const pixContainer = document.getElementById('payment-pix-container');
    const errorMessageContainer = document.getElementById('payment-error-message');
    const progressBar = document.querySelector('.progress-bar');
    const generatePixButton = document.getElementById('generate-pix-button');
    const pixQrCodeContainer = document.getElementById('pix-qr-code');
    const pixQrTextContainer = document.getElementById('pix-qr-text');
    const pixCopyButton = document.getElementById('pix-copy-button');
    const cardWrapper = document.querySelector('.card-wrapper');

    let cardForm;

    // Função para exibir erros
    const showErrorMessage = (message) => {
        errorMessageContainer.textContent = message;
        errorMessageContainer.style.display = 'block';
        hideLoading();
    };

    // Funções para controlar o loading
    const showLoading = () => {
        progressBar.style.display = 'block';
        progressBar.removeAttribute('value');
    };
    const hideLoading = () => {
        progressBar.style.display = 'none';
        progressBar.setAttribute('value', '0');
    };

    // Altera a visibilidade dos formulários
    const handlePaymentMethodChange = () => {
        if (pollingInterval) clearInterval(pollingInterval);

        const selectedMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
        cardFormContainer.style.display = selectedMethod === 'card' ? 'block' : 'none';
        cardWrapper.style.display = selectedMethod === 'card' ? 'block' : 'none';
        pixContainer.style.display = selectedMethod === 'pix' ? 'block' : 'none';
        errorMessageContainer.style.display = 'none';
    };

    // Inicializa o formulário de cartão de crédito/débito
    const initializeCardForm = async () => {
        if (cardForm) {
            cardForm.unmount();
        }
        
        cardForm = await mp.cardForm({
            amount: window.totalAmount,
            iframe: false,
            form: {
                id: "form-checkout-card",
                cardholderName: { id: "form-checkout__cardholderName" },
                cardholderEmail: { id: "form-checkout__cardholderEmail" },
                identificationType: { id: "form-checkout__identificationType" },
                identificationNumber: { id: "form-checkout__identificationNumber" },
                cardNumber: { id: "form-checkout__cardNumber" },
                securityCode: { id: "form-checkout__securityCode" },
                expirationDate: { id: "form-checkout__expirationDate" },
                issuer: { id: "form-checkout__issuer" },
                installments: { id: "form-checkout__installments" },
            },
            callbacks: {
                onFormMounted: error => { if (error) console.warn("Form Mounted error: ", error); },
                onFetching: (resource) => {
                    showLoading();
                    return () => hideLoading();
                },
                onSubmit: event => {
                    event.preventDefault();
                    showLoading();
                    const {
                        paymentMethodId: payment_method_id,
                        issuerId: issuer_id,
                        cardholderEmail: email,
                        token,
                        installments,
                        identificationNumber,
                        identificationType,
                    } = cardForm.getCardFormData();

                    fetch("/process_payment", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            payment_method: 'card',
                            token,
                            issuer_id,
                            payment_method_id,
                            installments: Number(installments),
                            email,
                            identificationType,
                            identificationNumber,
                        }),
                    })
                    .then(response => response.json())
                    .then(result => {
                        if (result.success) {
                            window.location.href = `/pedido/confirmacao/${result.orderId}`;
                        } else {
                            showErrorMessage(result.message || 'Erro inesperado.');
                        }
                    })
                    .catch(error => showErrorMessage('Não foi possível conectar ao servidor.'))
                    .finally(() => hideLoading());
                },
            },
        });
    };
    
    // --- Gera o pagamento PIX e inicia a verificação ---
    const handleGeneratePix = () => {
        showLoading();
        generatePixButton.disabled = true;

        fetch("/process_payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                payment_method: 'pix',
                email: window.userEmail,
            }),
        })
        .then(res => res.json())
        .then(data => {
            if(data.success) {
                pixQrCodeContainer.innerHTML = `<img src="data:image/jpeg;base64,${data.qr_code}" alt="QR Code PIX">`;
                pixQrTextContainer.value = data.qr_code_text;
                pixCopyButton.style.display = 'block';
                pixQrTextContainer.style.display = 'block';
                generatePixButton.style.display = 'none';
                document.querySelector('#payment-pix-container p').textContent = 'Escaneie o QR Code para pagar. Aguardando confirmação...';
                
                // Inicia a verificação do status do pagamento
                startPolling(data.orderId);
            } else {
                showErrorMessage(data.message || 'Não foi possível gerar o PIX.');
                generatePixButton.disabled = false;
            }
        })
        .catch(() => {
            showErrorMessage('Erro de comunicação ao gerar o PIX.');
            generatePixButton.disabled = false;
        })
        .finally(() => hideLoading());
    };

    // --- Verifica o status do pedido no backend ---
    function startPolling(orderId) {
        pollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`/pedido/status/${orderId}`);
                const data = await response.json();

                if (data.status === 'pago') {
                    clearInterval(pollingInterval); // Para a verificação
                    // Redireciona para a página de sucesso
                    window.location.href = `/pedido/confirmacao/${orderId}`;
                }
            } catch (error) {
                console.error('Erro ao verificar status:', error);
            }
        }, 5000); // Verifica a cada 5 segundos
    }

    // Copia o código PIX
    pixCopyButton.addEventListener('click', () => {
        pixQrTextContainer.select();
        document.execCommand('copy');
        pixCopyButton.textContent = 'Copiado!';
        setTimeout(() => { pixCopyButton.textContent = 'Copiar Código'; }, 2000);
    });

    // Adiciona os listeners
    paymentMethodRadios.forEach(radio => radio.addEventListener('change', handlePaymentMethodChange));
    generatePixButton.addEventListener('click', handleGeneratePix);

    // Inicialização
    handlePaymentMethodChange();
    initializeCardForm();
});