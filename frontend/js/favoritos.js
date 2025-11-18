/**
 * Script para gerenciar a adição/remoção de produtos favoritos.
 * Funciona para usuários logados (via API) e convidados (via localStorage).
 */
document.addEventListener('DOMContentLoaded', () => {

    const FAVORITES_KEY = 'rs_card_store_favorites';

    /**
     * Busca os favoritos do convidado no localStorage.
     * @returns {Set<string>} Um Set com os IDs dos produtos.
     */
    function getGuestFavorites() {
        try {
            const stored = localStorage.getItem(FAVORITES_KEY);
            return new Set(stored ? JSON.parse(stored) : []);
        } catch (e) {
            console.error("Erro ao ler favoritos do localStorage", e);
            return new Set();
        }
    }

    /**
     * Salva os favoritos do convidado no localStorage.
     * @param {Set<string>} favoritesSet - Um Set com os IDs dos produtos.
     */
    function saveGuestFavorites(favoritesSet) {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favoritesSet)));
        } catch (e) {
            console.error("Erro ao salvar favoritos no localStorage", e);
        }
    }

    /**
     * Atualiza a interface de todos os botões de favorito na página.
     * @param {Set<string>} favoritesSet - O Set de IDs de favoritos (para convidados).
     * @param {boolean} isUserLoggedIn - Se o usuário está logado.
     */
    function updateAllFavoriteButtons(favoritesSet, isUserLoggedIn) {
        const buttons = document.querySelectorAll('.btn-favorite, .btn-favorite-card');
        
        buttons.forEach(btn => {
            const produtoId = btn.dataset.produtoId;
            if (!produtoId) return;

            // Para usuários logados, o estado já vem do EJS (servidor).
            // Para convidados, atualizamos com base no localStorage.
            if (!isUserLoggedIn) {
                if (favoritesSet.has(produtoId)) {
                    btn.classList.add('favorited');
                } else {
                    btn.classList.remove('favorited');
                }
            }
        });
    }

    /**
     * Manipula o clique em um botão de favorito.
     * @param {Event} e - O evento de clique.
     */
    async function handleFavoriteClick(e) {
        e.preventDefault();
        const button = e.currentTarget;
        const produtoId = button.dataset.produtoId;
        const isUserLoggedIn = button.dataset.userLoggedIn === 'true' || 
                               document.querySelector('.user-greeting') != null; // Fallback

        if (!produtoId) return;

        const isCurrentlyFavorited = button.classList.contains('favorited');
        button.classList.toggle('favorited');

        if (isUserLoggedIn) {
            try {
                const response = await fetch(`/api/favoritos/toggle/${produtoId}`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    // Reverte a UI em caso de erro
                    button.classList.toggle('favorited'); 
                    console.error("Erro da API:", data.message);
                }

            } catch (error) {
                button.classList.toggle('favorited');
                console.error("Erro na requisição fetch:", error);
            }

        } else {
            // --- LÓGICA PARA CONVIDADO (localStorage) ---
            const guestFavorites = getGuestFavorites();
            if (isCurrentlyFavorited) {
                // Estava favoritado, agora remove
                guestFavorites.delete(produtoId);
            } else {
                // Não estava favoritado, agora adiciona
                guestFavorites.add(produtoId);
            }
            saveGuestFavorites(guestFavorites);
            // Atualiza outros botões na página (caso haja duplicatas)
            updateAllFavoriteButtons(guestFavorites, false);
        }
    }

    // --- INICIALIZAÇÃO ---
    
    // Pega o estado de login do primeiro botão que o tiver (geralmente o da página de produto)
    const mainFavButton = document.querySelector('.btn-favorite');
    const isUserLoggedIn = mainFavButton ? 
                           mainFavButton.dataset.userLoggedIn === 'true' : 
                           document.querySelector('.user-greeting') != null; // Fallback para listagens

    // Se for convidado, inicializa os botões com base no localStorage
    if (!isUserLoggedIn) {
        const guestFavorites = getGuestFavorites();
        updateAllFavoriteButtons(guestFavorites, false);
    }
    
    // Adiciona o listener a TODOS os botões de favorito (página e cards)
    const allFavoriteButtons = document.querySelectorAll('.btn-favorite, .btn-favorite-card');
    allFavoriteButtons.forEach(btn => {
        // Passa o estado de login para o dataset (útil para os cards)
        if (btn.dataset.userLoggedIn === undefined) {
            btn.dataset.userLoggedIn = isUserLoggedIn.toString();
        }
        btn.addEventListener('click', handleFavoriteClick);
    });

});