document.addEventListener('DOMContentLoaded', () => {
    const mpPublicKey = window.mpPublicKey;
    if (!mpPublicKey) {
        console.error('Chave pública do Mercado Pago não encontrada.');
        return;
    }

    const mp = new MercadoPago(mpPublicKey);

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
    let cardForm;

    const paymentMethodRadios = document.querySelectorAll('input[name="paymentMethod"]');
    const cardFormContainer = document.getElementById('form-checkout-card');
    const pixContainer = document.getElementById('payment-pix-container');
    const progressBar = document.querySelector('.progress-bar');
    const generatePixButton = document.getElementById('generate-pix-button');
    const pixQrCodeContainer = document.getElementById('pix-qr-code');
    const pixQrTextContainer = document.getElementById('pix-qr-text');
    const pixCopyButton = document.getElementById('pix-copy-button');
    const cardWrapper = document.querySelector('.card-wrapper');
    const modal = document.getElementById('payment-feedback-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalRetryButton = document.getElementById('modal-retry-button');
    const modalChangeMethodButton = document.getElementById('modal-change-method-button');
    const modalCloseButton = document.querySelector('.modal-close');
    const errorMessageContainer = document.getElementById('payment-error-message');

    // --- Validação do formulário de cartão ---
    const validateCardForm = () => {
        const requiredFields = [
            { id: 'form-checkout__cardNumber', name: 'Número do Cartão' },
            { id: 'form-checkout__cardholderName', name: 'Nome do Titular' },
            { id: 'form-checkout__expirationDate', name: 'Data de Vencimento' },
            { id: 'form-checkout__securityCode', name: 'CVV' },
            { id: 'form-checkout__cardholderEmail', name: 'E-mail' },
            { id: 'form-checkout__identificationType', name: 'Tipo de Documento' },
            { id: 'form-checkout__identificationNumber', name: 'Número do Documento' },
            { id: 'form-checkout__issuer', name: 'Emissor do Cartão' },
            { id: 'form-checkout__installments', name: 'Número de Parcelas' }
        ];

        let firstInvalidField = null;

        document.querySelectorAll('.form-control.invalid').forEach(el => el.classList.remove('invalid'));
        
        for (const field of requiredFields) {
            const element = document.getElementById(field.id);
            if (!element || !element.value || element.value.trim() === '') {
                if (element) {
                    element.classList.add('invalid'); 
                }
                firstInvalidField = field.name;
                break; 
            }
        }

        if (firstInvalidField) {
            showModal(
                'Campo Obrigatório', 
                `Por favor, preencha o campo: ${firstInvalidField}.`, 
                true 
            );
            return false; 
        }
        
        errorMessageContainer.style.display = 'none'; 
        return true; 
    };

    const getErrorMessageForStatus = (status) => {
        const messages = {
            // --- Pagamentos Recusados ---
            // OTHE (Recusado por erro geral)
            'cc_rejected_other_reason': 'O pagamento foi recusado por um erro geral. Por favor, tente com outro cartão.',
            
            // CALL (Recusado com validação para autorizar)
            'cc_rejected_call_for_authorize': 'Você precisa autorizar o pagamento junto ao emissor do seu cartão.',
            
            // FUND (Recusado por quantia insuficiente)
            'cc_rejected_insufficient_amount': 'O cartão não possui saldo suficiente.',
            
            // SECU (Recusado por código de segurança inválido)
            'cc_rejected_bad_filled_security_code': 'O código de segurança (CVV) é inválido. Verifique os dados e tente novamente.',
            
            // EXPI (Recusado por problema com a data de vencimento)
            'cc_rejected_bad_filled_date': 'A data de vencimento do cartão é inválida.',
            
            // FORM (Recusado por erro no formulário)
            'cc_rejected_bad_filled_other': 'Um ou mais campos do formulário estão incorretos. Por favor, verifique os dados do cartão.',
            
            // CARD (Rejeitado por falta de card_number)
            'cc_rejected_bad_filled_card_number': 'O número do cartão inserido é inválido.',
            
            // INST (Rejeitado por parcelas inválidas)
            'cc_rejected_invalid_installments': 'O número de parcelas selecionado não é válido para esta compra.',
            
            // DUPL (Rejeitado por pagamento duplicado)
            'cc_rejected_duplicated_payment': 'Você já realizou um pagamento com este valor. Se for um erro, aguarde alguns minutos e tente novamente.',
            
            // LOCK (Rejeitado por cartão desabilitado)
            'cc_rejected_card_disabled': 'O cartão está bloqueado ou desabilitado para compras online. Entre em contato com seu banco.',
            
            // CTNA (Rejeitado por tipo de cartão não permitido)
            'cc_rejected_card_type_not_allowed': 'Seu cartão não é aceito para este tipo de pagamento.',
            
            // ATTE (Rejeitado devido a tentativas excedidas de pin do cartão)
            'cc_rejected_pin_error': 'Foram excedidas as tentativas de autenticação. Entre em contato com seu banco.',

            // BLAC (Rejeitado por estar na lista negra)
            'cc_rejected_blacklist': 'O pagamento foi recusado por restrições de segurança. Por favor, utilize outro cartão.',
            'cc_rejected_high_risk': 'Sua compra não foi aprovada por motivos de segurança. Recomendamos tentar com outro meio de pagamento.',

            // UNSU (Não suportado)
            'unsupported_payment_method': 'O método de pagamento não é suportado.',

            // CONT (Pagamento pendente)
            'pending_contingency': 'O pagamento está sendo processado. Avisaremos por e-mail assim que for aprovado.',
            'pending_review_manual': 'O pagamento está em revisão manual. Isso pode levar algumas horas. Você receberá a confirmação por e-mail.'
        };
        
        return messages[status] || 'Não foi possível processar seu pagamento. Tente novamente ou escolha outro método.';
    };

    const showModal = (title, message, isValidationError = false) => {
        modalTitle.textContent = title;
        modalMessage.textContent = message;

        // Controla a visibilidade dos botões com base no tipo de erro
        if (isValidationError) {
            modalRetryButton.textContent = 'OK, Corrigir';
            modalChangeMethodButton.style.display = 'none'; 
        } else {
            modalRetryButton.textContent = 'Tentar Novamente'; 
            modalChangeMethodButton.style.display = 'block';
        }

        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('show'), 10);
    };
    
    const hideModal = () => {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
            console.log("Recriando formulário de cartão para obter um novo token.");
            initializeCardForm();
        }, 300);
    };

    modalCloseButton.addEventListener('click', hideModal);
    modalRetryButton.addEventListener('click', hideModal);
    modalChangeMethodButton.addEventListener('click', () => {
        hideModal();
        document.querySelector('input[name="paymentMethod"][value="pix"]').click();
    });

    // Função de erro agora serve tanto para validação quanto para erros de API
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
        // --- Para a verificação se o usuário mudar de método ---
        if (pollingInterval) clearInterval(pollingInterval);

        const selectedMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
        cardFormContainer.style.display = selectedMethod === 'card' ? 'block' : 'none';
        cardWrapper.style.display = selectedMethod === 'card' ? 'block' : 'none';
        pixContainer.style.display = selectedMethod === 'pix' ? 'block' : 'none';
        errorMessageContainer.style.display = 'none';
    };

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

                    if (!validateCardForm()) {
                        return; // Para a execução se a validação falhar
                    }

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
                            const errorMessage = getErrorMessageForStatus(result.status);
                            showModal('Pagamento Recusado', errorMessage);
                        }
                    })
                    .catch(error => {
                        console.error("Erro no fetch:", error);
                        showModal('Erro de Comunicação', 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
                    })
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
                    clearInterval(pollingInterval);
                    window.location.href = `/pedido/confirmacao/${orderId}`;
                }
            } catch (error) {
                console.error('Erro ao verificar status:', error);
            }
        }, 5000); // Verifica a cada 5 segundos
    }

    pixCopyButton.addEventListener('click', () => {
        pixQrTextContainer.select();
        document.execCommand('copy');
        pixCopyButton.textContent = 'Copiado!';
        setTimeout(() => { pixCopyButton.textContent = 'Copiar Código'; }, 2000);
    });

    paymentMethodRadios.forEach(radio => radio.addEventListener('change', handlePaymentMethodChange));
    generatePixButton.addEventListener('click', handleGeneratePix);

    handlePaymentMethodChange();
    initializeCardForm();
});