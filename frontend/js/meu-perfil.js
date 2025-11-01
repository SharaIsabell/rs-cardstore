document.addEventListener('DOMContentLoaded', () => {

    /**
     * Função reutilizável para configurar a busca de CEP (ViaCEP) em um formulário.
     * @param {HTMLFormElement} formElement - O elemento <form> (Adicionar ou Editar).
     * @param {string} cepInputSelector - O seletor CSS para o input de CEP (ex: '#cep').
     * @param {string} btnSelector - O seletor CSS para o botão de busca (ex: '#btn-buscar-cep').
     */
    const setupViaCEP = (formElement, cepInputSelector, btnSelector) => {
        const btnBuscarCep = formElement.querySelector(btnSelector);
        const cepInput = formElement.querySelector(cepInputSelector);

        if (!btnBuscarCep || !cepInput) return;

        btnBuscarCep.addEventListener('click', async () => {
            const cep = cepInput.value.replace(/\D/g, ''); // Remove não numéricos

            if (cep.length !== 8) {
                alert('CEP inválido. Deve conter 8 dígitos.');
                return;
            }

            // Inputs do formulário (usamos 'name' para ser genérico e funcionar em ambos)
            const logradouro = formElement.querySelector('[name="logradouro"]');
            const bairro = formElement.querySelector('[name="bairro"]');
            const cidade = formElement.querySelector('[name="cidade"]');
            const estado = formElement.querySelector('[name="estado"]');
            const numero = formElement.querySelector('[name="numero"]');

            // Feedback de carregamento
            btnBuscarCep.disabled = true;
            btnBuscarCep.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

            try {
                const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                if (!response.ok) {
                    throw new Error('Não foi possível buscar o CEP.');
                }
                
                const data = await response.json();

                if (data.erro) {
                    alert('CEP não encontrado.');
                    cepInput.focus();
                } else {
                    // Preenche os campos
                    if (logradouro) logradouro.value = data.logradouro;
                    if (bairro) bairro.value = data.bairro;
                    if (cidade) cidade.value = data.localidade;
                    if (estado) estado.value = data.uf;
                    
                    // Foca no campo "Número"
                    if (numero) numero.focus();
                }

            } catch (error) {
                console.error('Erro no ViaCEP:', error);
                alert('Erro ao buscar o CEP. Tente novamente.');
            } finally {
                // Restaura o botão
                btnBuscarCep.disabled = false;
                btnBuscarCep.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
            }
        });
    };

    // 1. Ativa o ViaCEP para o formulário de ADICIONAR
    const formAdd = document.getElementById('form-add-endereco');
    if (formAdd) {
        setupViaCEP(formAdd, '#cep', '#btn-buscar-cep');
    }

    // 2. Ativa o ViaCEP para o formulário de EDITAR (do modal)
    const formEdit = document.getElementById('form-edit-endereco');
    if (formEdit) {
        setupViaCEP(formEdit, '#cep-edit', '#btn-buscar-cep-edit');
    }

    // --- Lógica do Modal de Edição ---
    const modal = document.getElementById('editAddressModal');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const editButtons = document.querySelectorAll('.btn-edit-address');

    if (modal) {
        const openModal = () => modal.style.display = 'flex';
        const closeModal = () => modal.style.display = 'none';

        // Abrir o modal ao clicar em "Editar"
        editButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                // Pega o ID do data attribute (pode ser o <i> ou o <button>)
                const targetButton = e.currentTarget; 
                const id = targetButton.dataset.id;
                
                if (!id) return;

                // 1. Buscar dados do endereço via API
                try {
                    const response = await fetch(`/api/minha-conta/endereco/${id}`);
                    if (!response.ok) throw new Error('Endereço não encontrado');
                    
                    const data = await response.json();
                    if (!data.success) throw new Error(data.message);
                    
                    const addr = data.endereco;

                    // 2. Popular o formulário de EDIÇÃO
                    formEdit.querySelector('#apelido-edit').value = addr.apelido;
                    formEdit.querySelector('#cep-edit').value = addr.cep;
                    formEdit.querySelector('#logradouro-edit').value = addr.logradouro;
                    formEdit.querySelector('#numero-edit').value = addr.numero;
                    formEdit.querySelector('#complemento-edit').value = addr.complemento || '';
                    formEdit.querySelector('#bairro-edit').value = addr.bairro;
                    formEdit.querySelector('#cidade-edit').value = addr.cidade;
                    formEdit.querySelector('#estado-edit').value = addr.estado;

                    // 3. Definir o 'action' do formulário
                    formEdit.action = `/minha-conta/endereco/editar/${id}`;
                    
                    // 4. Abrir o modal
                    openModal();

                } catch (error) {
                    console.error('Erro ao carregar dados para edição:', error);
                    alert('Não foi possível carregar os dados do endereço.');
                }
            });
        });

        // Fechar o modal
        if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(); // Fecha se clicar no overlay
        });
    }
});