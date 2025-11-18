const express = require('express');
const router = express.Router();
const db = require('../database/pooldb');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { enviarEmailVerificacao, enviarEmailAlertaEstoque, enviarEmailConfirmacaoPedido, enviarEmailRedefinicaoSenha } = require('../frontend/js/enviarEmail');
const session = require('express-session');
const axios = require('axios');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { v4: uuidv4 } = require('uuid');
const RATE_MINUTES = 5;
const COOLDOWN_SECONDS = 60;

// Configuração do cliente do Mercado Pago
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
const payment = new Payment(client);

router.use(bodyParser.urlencoded({ extended: true }));
// Middleware específico para a rota do webhook para usar o raw body
router.use('/mercado-pago-webhook', express.raw({ type: 'application/json' }));
router.use(express.json());

router.use(session({
    secret: 'seu-segredo-super-secreto-aqui',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

router.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.mercadoPagoPublicKey = process.env.MERCADOPAGO_PUBLIC_KEY;
    res.locals.getMessages = () => {
        const messages = req.session.messages || {};
        req.session.messages = {};
        return messages;
    };
    next();
});

// --- NOVO MIDDLEWARE: Proteção de Rotas ---
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login');
};

// Isolando admin do usuário
router.use((req, res, next) => {
    if (req.session && req.session.isAdmin && req.session.pinValidated) {
        if (!req.path.startsWith('/admin')) {
            return res.redirect('/admin');
        }
    }
    next();
});

// --- Gerar NF Fictícia (AC2) ---
async function gerarNotaFiscalFicticia(connection, pedido_id) {
    try {
        // Gera um link fictício único
        const fakeLink = `/pedidos/nf/${uuidv4()}/${pedido_id}.pdf`;
        await connection.query(
            'INSERT INTO notas_fiscais (pedido_id, link_arquivo) VALUES (?, ?)',
            [pedido_id, fakeLink]
        );
        return fakeLink;
    } catch (error) {
        console.error(`[ERRO NF] Erro ao gerar NF fictícia para pedido ${pedido_id}:`, error);
        return null; // Continua o processo mesmo se a NF falhar
    }
}

// --- Enviar E-mail de Confirmação (AC1, AC3, DoD1, DoD3) ---
async function enviarConfirmacaoEGerarNF(connection, pedido_id) {
    try {
        // 1. Gerar Nota Fiscal (AC2)
        const linkNF = await gerarNotaFiscalFicticia(connection, pedido_id);

        // 2. Buscar dados completos para o e-mail
        const [[pedido]] = await connection.query(
            `SELECT p.*, u.email, u.nome 
       FROM pedidos p 
       JOIN users u ON p.user_id = u.id 
       WHERE p.id = ?`,
            [pedido_id]
        );

        const [itens] = await connection.query(
            `SELECT pi.*, prod.nome 
       FROM pedido_itens pi 
       JOIN produtos prod ON pi.produto_id = prod.id 
       WHERE pi.pedido_id = ?`,
            [pedido_id]
        );

        if (!pedido) {
            throw new Error('Pedido não encontrado para envio de e-mail.');
        }

        // 3. Enviar e-mail de confirmação (AC1, AC3, DoD3)
        // (Assumindo que a função enviarEmailConfirmacaoPedido existe no módulo importado)
        await enviarEmailConfirmacaoPedido(pedido, itens, linkNF);

        console.log(`[SUCESSO] E-mail de confirmação e NF gerada para pedido ${pedido_id}.`);

    } catch (error) {
        console.error(`[ERRO EMAIL/NF] Falha ao processar pós-pagamento para pedido ${pedido_id}:`, error.message);
    }
}

router.get('/', async (req, res) => {
    try {
        // Lógica de favoritos
        const userId = req.session.userId || null;
        const isUserLoggedIn = !!userId;
        let favoritosSet = new Set();

        if (userId) {
            const [favRows] = await db.query('SELECT produto_id FROM user_favoritos WHERE user_id = ?', [userId]);
            favoritosSet = new Set(favRows.map(f => f.produto_id));
        }
        
        const [novosProdutos] = await db.query(
            `SELECT id, nome, preco, desconto_percentual, imagem_url, novo, promocao
         FROM produtos
        WHERE novo = TRUE
     ORDER BY id DESC
        LIMIT 2`
        );
        const idsIgnorados = novosProdutos.length > 0 ? novosProdutos.map(p => p.id) : [0];
        const [produtosEmPromocao] = await db.query(
            `SELECT id, nome, preco, desconto_percentual, imagem_url, novo, promocao
         FROM produtos
        WHERE desconto_percentual > 0 AND id NOT IN (?)
     ORDER BY desconto_percentual DESC
        LIMIT 2`,
            [idsIgnorados]
        );
        const destaques = [...novosProdutos, ...produtosEmPromocao];
        res.render('index', { 
            destaques: destaques,
            favoritosSet: favoritosSet,
            isUserLoggedIn: isUserLoggedIn
        });
    } catch (err) {
        console.error("Erro ao carregar destaques da página inicial:", err);
        res.render('index', { 
            destaques: [], 
            favoritosSet: new Set(),
            isUserLoggedIn: false
        });
    }
});

async function renderProductPage(req, res, viewName, category, baseUrl, searchTerm = null) {
    try {
        const userId = req.session.userId || null;
        const isUserLoggedIn = !!userId;
        let favoritosSet = new Set();

        if (userId) {
            const [favRows] = await db.query('SELECT produto_id FROM user_favoritos WHERE user_id = ?', [userId]);
            favoritosSet = new Set(favRows.map(f => f.produto_id));
        }

        const {
            min_price,
            max_price,
            on_sale,
            state,
            sort_by
        } = req.query;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = 4; // Limite de 4 produtos por página
        const offset = (page - 1) * limit;

        const whereConditions = [];
        const queryParams = [];

        if (searchTerm) {
            // A lógica de busca no back-end pesquisa por nome e descrição
            whereClause = 'WHERE (nome LIKE ? OR descricao LIKE ?)';
            queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
        } else if (category) {
            whereConditions.push('categoria = ?');
            queryParams.push(category);
        } else {
            // Fallback para /promocoes
            whereConditions.push('promocao = TRUE');
        }

        // Adiciona os novos filtros de preço
        if (min_price) {
            whereConditions.push('(preco * (1 - desconto_percentual / 100)) >= ?');
            queryParams.push(parseFloat(min_price));
        }
        if (max_price) {
            whereConditions.push('(preco * (1 - desconto_percentual / 100)) <= ?');
            queryParams.push(parseFloat(max_price));
        }
        // Adiciona filtro de promoção (desconto)
        if (on_sale === 'true') {
            whereConditions.push('desconto_percentual > 0');
        }
        // Adiciona filtro de estado (novo/usado)
        if (state === 'novo' || state === 'usado') {
            whereConditions.push('estado = ?');
            queryParams.push(state);
        }

        // Junta todas as condições com 'AND'
        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // --- 3. Construção da cláusula ORDER BY ---
        let orderByClause = 'ORDER BY id DESC'; // Default: Mais novos (relevância)
        switch (sort_by) {
            case 'price_asc':
                orderByClause = 'ORDER BY (preco * (1 - desconto_percentual / 100)) ASC';
                break;
            case 'price_desc':
                orderByClause = 'ORDER BY (preco * (1 - desconto_percentual / 100)) DESC';
                break;
            case 'name_asc':
                orderByClause = 'ORDER BY nome ASC';
                break;
            case 'name_desc':
                orderByClause = 'ORDER BY nome DESC';
                break;
        }

        // Contar o total de produtos para calcular as páginas
        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) as total FROM produtos ${whereClause}`,
            queryParams
        );

        const totalPages = Math.ceil(total / limit);

        // Buscar os produtos da página atual com filtros e ordenação
        const [produtos] = await db.query(
            `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo, estado 
             FROM produtos 
             ${whereClause}
             ${orderByClause} 
             LIMIT ? 
             OFFSET ?`,
            [...queryParams, limit, offset]
        );

        res.render(viewName, {
            produtos: produtos,
            totalPages: totalPages,
            currentPage: page,
            baseUrl: baseUrl,
            searchTerm: searchTerm,
            // Passa os filtros atuais para a view (para preencher o formulário)
            currentFilters: {
                min_price: min_price || '',
                max_price: max_price || '',
                on_sale: on_sale || '',
                state: state || '',
                sort_by: sort_by || 'newest'
            },
            favoritosSet: favoritosSet,
            isUserLoggedIn: isUserLoggedIn
        });

    } catch (err) {
        console.error(`Erro ao carregar produtos para a página ${viewName}:`, err);
        res.status(500).send(`Erro ao carregar a página de ${viewName}.`);
    }
}

router.get('/magic', (req, res) => {
    renderProductPage(req, res, 'magic', 'Magic', '/magic');
});

router.get('/yugioh', (req, res) => {
    renderProductPage(req, res, 'yugioh', 'Yu-Gi-Oh', '/yugioh');
});

router.get('/pokemon', (req, res) => {
    renderProductPage(req, res, 'pokemon', 'Pokemon', '/pokemon');
});

router.get('/busca', async (req, res) => {
    const { termo } = req.query;
    if (!termo) {
        return res.redirect('/');
    }
    // Os resultados da busca devem ser exibidos em uma página de listagem
    // Passamos 'null' para categoria e o 'termo' para searchTerm
    await renderProductPage(req, res, 'busca-resultados', null, '/busca', termo);
});

router.get('/produto/:id', async (req, res) => {
    try { 
        const { id } = req.params;
        const userId = req.session.userId || null;
        const [rows] = await db.query(
            `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, categoria, estoque 
         FROM produtos 
        WHERE id = ?`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).send('Produto não encontrado.');
        }
        let isFavorito = false;
        const isUserLoggedIn = !!userId;

        if (isUserLoggedIn) {
            const [favoritoRows] = await db.query(
                'SELECT id FROM user_favoritos WHERE user_id = ? AND produto_id = ?',
                [userId, id]
            );
            if (favoritoRows.length > 0) {
                isFavorito = true;
            }
        }

        res.render('produto', { 
            produto: rows[0],
            isFavorito: isFavorito,
            isUserLoggedIn: isUserLoggedIn
        });
    } catch (err) {
        console.error('Erro ao carregar o produto:', err);
        res.status(500).send('Erro ao carregar a página do produto.');
    }
});

router.get('/acessorios', (req, res) => {
    renderProductPage(req, res, 'acessorios', 'Acessorios', '/acessorios');
});

router.get('/promocoes', (req, res) => {
    // Passamos 'null' para a categoria, pois o filtro é por 'promocao = TRUE'
    renderProductPage(req, res, 'promocoes', null, '/promocoes');
});

router.get('/login', (req, res) => {
    let message = '';
    if (req.query.status === 'verificado') {
        message = 'E-mail verificado com sucesso! Você já pode fazer o login.';
    }
    if (req.query.status === 'reset_success') {
        message = 'Senha redefinida com sucesso! Você já pode fazer o login.';
    }
    
    let errorMessage = null;
    if (req.query.status === 'reset_expired') {
        errorMessage = 'O link de redefinição de senha é inválido ou expirou. Tente novamente.';
    }

    res.render('login', { message: message, errorMessage: errorMessage });
});

// ROTA DE REGISTRO MODIFICADA
router.post('/register', async (req, res) => {
    const { nome, email, telefone, senha, confirmSenha } = req.body;

    const respondError = (message) => {
        if (req.accepts('json')) return res.status(400).json({ success: false, message });
        return res.status(400).render('login', { message: null, errorMessage: message, showRegister: true });
    };

    if (senha !== confirmSenha) return respondError('As senhas não coincidem.');
    if (senha.length < 8 || !/\d/.test(senha) || !/[a-zA-Z]/.test(senha))
        return respondError('A senha deve ter no mínimo 8 caracteres, incluindo letras e números.');

    const telefoneNumerico = telefone.replace(/\D/g, '');
    if (telefoneNumerico.length < 10 || telefoneNumerico.length > 11)
        return respondError('O telefone deve conter 10 ou 11 dígitos numéricos.');

    try {
        const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) return respondError('Este e-mail já está cadastrado.');

        const salt = await bcrypt.genSalt(10);
        const senha_hash = await bcrypt.hash(senha, salt);
        const token_verificacao = crypto.randomBytes(32).toString('hex');
        const token_verificacao_expira = new Date(Date.now() + 5 * 60 * 1000); // expira em 1h

        await db.query(
            'INSERT INTO users (nome, email, telefone, senha_hash, token_verificacao, token_verificacao_expira, email_verificado) VALUES (?, ?, ?, ?, ?, ?, FALSE)',
            [nome, email, telefoneNumerico, senha_hash, token_verificacao, token_verificacao_expira]
        );

        await enviarEmailVerificacao(email, token_verificacao);
        await db.query('UPDATE users SET last_verification_sent_at = NOW() WHERE email = ?', [email]);

        if (req.accepts('json'))
            return res.status(201).json({ success: true, message: 'Cadastro realizado! Verifique seu e-mail.' });

        return res.status(201).render('login', {
            errorMessage: null,
            message: 'Cadastro realizado! Verifique seu e-mail para continuar.',
            showRegister: false
        });
    } catch (error) {
        console.error('ERRO AO CADASTRAR:', error);
        return respondError('Erro no servidor ao cadastrar.');
    }
});

router.get('/verificar-email', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).render('verificacao_expirada', { email: '', cooldown: 0 });
        }

        // Busca o usuário pelo token
        const [users] = await db.query(
            'SELECT id, email, token_verificacao_expira, email_verificado FROM users WHERE token_verificacao = ?',
            [token]
        );

        if (users.length === 0) {
            return res.status(400).render('verificacao_expirada', { email: '', cooldown: 0 });
        }

        const user = users[0];

        // Se já estiver verificado, apenas redireciona
        if (user.email_verificado) {
            return res.redirect('/login?status=verificado');
        }

        const expiraEm = new Date(
            typeof user.token_verificacao_expira === 'string'
                ? user.token_verificacao_expira.replace(' ', 'T') // corrige formato 'YYYY-MM-DD HH:MM:SS'
                : user.token_verificacao_expira
        );

        const agora = new Date();

        console.log('🔎 DEBUG: Agora:', agora);
        console.log('🔎 DEBUG: Expira em:', expiraEm);

        if (agora > expiraEm) {
            console.log(`[TOKEN EXPIRADO] Token de ${user.email} expirou em ${expiraEm.toISOString()}`);
            return res.status(400).render('verificacao_expirada', { email: user.email, cooldown: 0 });
        }

        await db.query(
            'UPDATE users SET email_verificado = TRUE, token_verificacao = NULL, token_verificacao_expira = NULL WHERE id = ?',
            [user.id]
        );

        console.log(`[TOKEN OK] E-mail ${user.email} verificado com sucesso.`);
        return res.redirect('/login?status=verificado');
    } catch (error) {
        console.error('[ERRO AO VERIFICAR E-MAIL]:', error);
        return res.status(500).render('verificacao_expirada', { email: '', cooldown: 0 });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        // 1) Tenta o ADMIN primeiro
        {
            const [admins] = await db.query(
                'SELECT id, email, password_hash, is_active FROM admins WHERE email = ?',
                [email]
            );

            if (admins.length > 0 && admins[0].is_active === 1) {
                const ok = await bcrypt.compare(senha, admins[0].password_hash);
                if (ok) {
                    return req.session.regenerate(err => {
                        if (err) {
                            console.error('Erro ao regenerar sessão (admin):', err);
                            return res.status(500).render('login', { message: null, errorMessage: 'Erro no servidor.' });
                        }

                        // flags de admin
                        req.session.isAdmin = true;
                        req.session.adminId = admins[0].id;
                        req.session.adminEmail = admins[0].email;

                        // limpa flags de cliente para evitar dados do usuário (uma forma de ter segurança)
                        delete req.session.userId;
                        delete req.session.userName;
                        delete req.session.canAccessCheckout;
                        delete req.session.frete;
                        delete req.session.freteInfo;
                        delete req.session.pagamento;

                        // Gera PIN de 6 dígitos por sessão e exige confirmação
                        req.session.adminPin = String(Math.floor(100000 + Math.random() * 900000));
                        req.session.pinValidated = false;

                        return req.session.save(() => res.redirect('/admin/pin'));
                    });
                }
            }
        }
        // 2) Não é admin (ou senha incorreta) -> segue fluxo de CLIENTE
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).render('login', { message: null, errorMessage: 'E-mail ou senha inválidos.' });
        }

        const user = users[0];
        const senhaCorreta = await bcrypt.compare(senha, user.senha_hash);
        if (!senhaCorreta) {
            return res.status(401).render('login', { message: null, errorMessage: 'E-mail ou senha inválidos.' });
        }

        if (!user.email_verificado) {
            return res.status(403).render('login', { message: null, errorMessage: 'Por favor, verifique seu e-mail antes de fazer o login.' });
        }

        // Regenera sessão p/ cliente
        req.session.regenerate(err => {
            if (err) {
                console.error('Erro ao regenerar sessão (cliente):', err);
                return res.status(500).render('login', { message: null, errorMessage: 'Erro no servidor.' });
            }

            req.session.userId = user.id;
            req.session.userName = user.nome;

            // Garante que NÃO é admin
            req.session.isAdmin = false;
            delete req.session.adminId;
            delete req.session.adminEmail;

            return req.session.save(() => res.redirect('/'));
        });

    } catch (error) {
        console.error('ERRO DETALHADO AO FAZER LOGIN:', error);
        res.status(500).render('login', { message: null, errorMessage: 'Ocorreu um erro no servidor ao tentar fazer login.' });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Não foi possível fazer logout.');
        }
        res.redirect('/');
    });
});

// Exibe a página para o usuário inserir o e-mail
router.get('/esqueci-senha', (req, res) => {
    res.render('esqueci-senha', { message: null, errorMessage: null });
});

// Processa o e-mail, gera o token e envia o e-mail
router.post('/esqueci-senha', async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await db.query('SELECT id, email FROM users WHERE email = ?', [email]);
        
        if (users.length > 0) {
            const user = users[0];
            const token = crypto.randomBytes(32).toString('hex');
            // Token com expiração (5 minutos)
            const expira = new Date(Date.now() + 300000); // 5 minutos

            await db.query(
                'UPDATE users SET token_redefinicao_senha = ?, token_redefinicao_expira = ? WHERE id = ?',
                [token, expira, user.id]
            );
            
            // Dispara o e-mail
            await enviarEmailRedefinicaoSenha(user.email, token);
        }
        
        // Responde com sucesso mesmo se o e-mail não existir (para evitar enumeração de usuários)
        res.render('esqueci-senha', {
            message: 'Se um e-mail cadastrado for encontrado, um link de redefinição será enviado.',
            errorMessage: null
        });

    } catch (error) {
        console.error('ERRO AO SOLICITAR REDEFINIÇÃO:', error);
        res.render('esqueci-senha', {
            message: null,
            errorMessage: 'Ocorreu um erro no servidor. Tente novamente.'
        });
    }
});

// Exibe a página para o usuário criar a nova senha
router.get('/redefinir-senha', async (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.redirect('/login?status=reset_expired');
    }
    
    try {
        // Busca o usuário pelo token E verifica se não expirou
        const [users] = await db.query(
            'SELECT id FROM users WHERE token_redefinicao_senha = ? AND token_redefinicao_expira > NOW()',
            [token]
        );

        if (users.length === 0) {
            // Token inválido ou expirado
            return res.redirect('/login?status=reset_expired');
        }

        // Token válido, renderiza a página de redefinição
        res.render('redefinir-senha', { token: token, errorMessage: null });
        
    } catch (error) {
        console.error('ERRO AO VALIDAR TOKEN DE REDEFINIÇÃO:', error);
        res.redirect('/login?status=reset_expired');
    }
});

// Processa a nova senha, atualiza o banco e invalida o token
router.post('/redefinir-senha', async (req, res) => {
    const { token, nova_senha, confirmar_nova_senha } = req.body;

    // Validação de senhas
    if (nova_senha !== confirmar_nova_senha) {
        return res.render('redefinir-senha', { token, errorMessage: 'As senhas não coincidem.' });
    }
    // Validação de complexidade (igual ao registro)
    if (nova_senha.length < 8 || !/\d/.test(nova_senha) || !/[a-zA-Z]/.test(nova_senha)) {
        return res.render('redefinir-senha', { token, errorMessage: 'A senha deve ter no mínimo 8 caracteres, com letras e números.' });
    }

    try {
        // Busca o usuário pelo token E verifica se não expirou (Dupla verificação)
        const [users] = await db.query(
            'SELECT id FROM users WHERE token_redefinicao_senha = ? AND token_redefinicao_expira > NOW()',
            [token]
        );

        if (users.length === 0) {
            return res.redirect('/login?status=reset_expired');
        }
        
        const user = users[0];

        // Armazena com hash
        const salt = await bcrypt.genSalt(10);
        const senha_hash = await bcrypt.hash(nova_senha, salt);
        
        // Atualiza a senha e invalida o token (usa o ID do usuário para garantir)
        await db.query(
            'UPDATE users SET senha_hash = ?, token_redefinicao_senha = NULL, token_redefinicao_expira = NULL WHERE id = ?',
            [senha_hash, user.id]
        );
        
        // Redireciona para o login com mensagem de sucesso
        res.redirect('/login?status=reset_success');

    } catch (error) {
        console.error('ERRO AO SALVAR NOVA SENHA:', error);
        res.render('redefinir-senha', { token, errorMessage: 'Erro no servidor ao salvar sua senha.' });
    }
});

router.get('/api/get-address', isAuthenticated, async (req, res) => {
    // Agora busca o endereço principal da nova tabela
    try {
        const [enderecos] = await db.query(
            'SELECT * FROM user_enderecos WHERE user_id = ? AND is_principal = TRUE',
            [req.session.userId]
        );

        if (enderecos.length > 0) {
            const principal = enderecos[0];
            const address = {
                cep: principal.cep,
                rua: principal.logradouro,
                numero: principal.numero,
                complemento: principal.complemento,
                bairro: principal.bairro,
                cidade: principal.cidade,
                estado: principal.estado,
            };
            res.json({ success: true, address: JSON.stringify(address) });
        } else {
            res.json({ success: false, message: 'Nenhum endereço principal cadastrado.' });
        }
    } catch (error) {
        console.error('Erro ao buscar endereço principal:', error);
        res.status(500).json({ success: false, message: 'Erro no servidor.' });
    }
});

// ROTA CHECKOUT MODIFICADA
router.get('/checkout', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    // Verifica se o endereço e o frete foram definidos
    if (!req.session.frete || !req.session.endereco_entrega) {
        console.log("Frete ou endereço não definidos, redirecionando para o carrinho.");
        return res.redirect('/carrinho');
    }

    try {
        const [userRows] = await db.query('SELECT nome, email FROM users WHERE id = ?', [req.session.userId]);
        if (userRows.length === 0) return res.redirect('/login');

        const user = userRows[0];

        const [cart] = await db.query('SELECT id FROM carrinhos WHERE user_id = ?', [req.session.userId]);
        if (cart.length === 0) return res.render('carrinho', { cart: null });

        const carrinho_id = cart[0].id;
        const [items] = await db.query(`
            SELECT ci.produto_id, ci.quantidade, p.nome, p.preco, p.imagem_url, p.desconto_percentual
            FROM carrinho_itens ci JOIN produtos p ON ci.produto_id = p.id
            WHERE ci.carrinho_id = ?`, [carrinho_id]
        );

        if (items.length === 0) return res.redirect('/carrinho');

        const subtotal = items.reduce((acc, item) => {
            const precoFinal = item.preco * (1 - item.desconto_percentual / 100);
            return acc + (precoFinal * item.quantidade);
        }, 0);

        const frete = req.session.frete.cost;
        const frete_metodo = req.session.frete.name;
        const endereco_entrega = req.session.endereco_entrega;
        const total = subtotal + frete;

        res.render('checkout', {
            cart: { items, subtotal, frete, frete_metodo, total },
            user: user,
            endereco: endereco_entrega,
            message: null
        });
    } catch (e) {
        console.error('Erro no checkout:', e);
        res.status(500).send('Erro ao carregar o checkout.');
    }
});

router.post('/process_payment', async (req, res) => {
    if (!req.session.userId || !req.session.frete || !req.session.endereco_entrega) {
        return res.status(401).json({ error: 'Sessão inválida ou dados de entrega ausentes.' });
    }

    const { payment_method } = req.body;
    const user_id = req.session.userId;

    const frete_info = req.session.frete;
    const endereco_entrega = req.session.endereco_entrega;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [cart] = await connection.query('SELECT id FROM carrinhos WHERE user_id = ?', [user_id]);
        if (cart.length === 0) throw new Error('Carrinho não encontrado.');

        const carrinho_id = cart[0].id;
        const [items] = await connection.query(`
            SELECT ci.produto_id, ci.quantidade, p.nome, p.preco, p.desconto_percentual
            FROM carrinho_itens ci JOIN produtos p ON ci.produto_id = p.id WHERE ci.carrinho_id = ?`,
            [carrinho_id]
        );
        if (items.length === 0) throw new Error('Carrinho vazio.');

        // Verificação de estoque antes de prosseguir
        for (const item of items) {
            const [[product]] = await connection.query('SELECT nome, estoque FROM produtos WHERE id = ? FOR UPDATE', [item.produto_id]);
            if (!product || product.estoque < item.quantidade) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: `Estoque insuficiente para o produto: ${product.nome}.` });
            }
        }

        const subtotal = items.reduce((acc, item) => {
            const precoFinal = item.preco * (1 - item.desconto_percentual / 100);
            return acc + (precoFinal * item.quantidade);
        }, 0);

        const transaction_amount = subtotal + frete_info.cost;
        let paymentResult;
        const idempotencyKey = uuidv4();

        if (payment_method === 'card' || payment_method === 'pix') {
            const pedido_id = await createOrder(connection, user_id, transaction_amount, items, 'pendente', frete_info, endereco_entrega);
            if (payment_method === 'card') {
                const { token, issuer_id, payment_method_id, installments, email, identificationType, identificationNumber } = req.body;
                const card_payment_data = {
                    transaction_amount: parseFloat(transaction_amount.toFixed(2)), token, description: `Pedido #${pedido_id}`, installments, payment_method_id, issuer_id,
                    payer: { email, identification: { type: identificationType, number: identificationNumber } },
                };
                paymentResult = await payment.create({ body: card_payment_data, requestOptions: { idempotencyKey } });

                if (paymentResult.status === 'approved') {
                    await connection.query("UPDATE pedidos SET status = 'pago' WHERE id = ?", [pedido_id]);
                    await createPaymentRecord(connection, pedido_id, payment_method_id.includes('deb') ? 'debito' : 'credito', 'aprovado', paymentResult.id);

                    // NOVO: Decremento de estoque e notificação
                    for (const item of items) {
                        await connection.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.produto_id]);
                        const [[updatedProduct]] = await connection.query('SELECT nome, estoque FROM produtos WHERE id = ?', [item.produto_id]);
                        const prevEstoque = updatedProduct.estoque + item.quantidade;

                        // LOW: cruzou de >5 para 1..5
                        if (prevEstoque > 5 && updatedProduct.estoque > 0 && updatedProduct.estoque <= 5) {
                            await enviarEmailAlertaEstoque(updatedProduct, 'LOW');
                            await connection.query('UPDATE produtos SET low_stock_notified = 1 WHERE id = ?', [item.produto_id]);
                        }

                        // OUT: chegou a 0
                        if (updatedProduct.estoque === 0) {
                            await enviarEmailAlertaEstoque(updatedProduct, 'OUT');
                            await connection.query('UPDATE produtos SET out_of_stock_notified = 1 WHERE id = ?', [item.produto_id]);
                            await connection.query('UPDATE produtos SET low_stock_notified = 1 WHERE id = ?', [item.produto_id]);
                        }
                    }

                    await connection.query('DELETE FROM carrinho_itens WHERE carrinho_id = ?', [carrinho_id]);

                    // Dispara o e-mail e gera a NF para pagamento com cartão
                    await enviarConfirmacaoEGerarNF(connection, pedido_id);

                    delete req.session.frete;
                    delete req.session.endereco_entrega;
                    await connection.commit();
                    return res.status(201).json({ success: true, message: 'Pagamento aprovado!', orderId: pedido_id });
                } else {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: `Pagamento recusado: ${paymentResult.status_detail}`, status: paymentResult.status_detail });
                }

            } else { // PIX
                const { email } = req.body;
                const pix_payment_data = {
                    transaction_amount: parseFloat(transaction_amount.toFixed(2)), description: `Pedido #${pedido_id}`, payment_method_id: 'pix',
                    payer: { email, first_name: req.session.userName },
                };
                paymentResult = await payment.create({ body: pix_payment_data, requestOptions: { idempotencyKey } });
                await createPaymentRecord(connection, pedido_id, 'pix', 'pendente', paymentResult.id);

                delete req.session.frete;
                delete req.session.endereco_entrega;
                await connection.commit();

                return res.status(201).json({
                    success: true, payment_method: 'pix',
                    qr_code: paymentResult.point_of_interaction.transaction_data.qr_code_base64,
                    qr_code_text: paymentResult.point_of_interaction.transaction_data.qr_code,
                    orderId: pedido_id
                });
            }
        } else {
            throw new Error('Método de pagamento inválido.');
        }

    } catch (error) {
        await connection.rollback();
        console.error('Erro ao processar pagamento:', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor.' });
    } finally {
        connection.release();
    }
});

router.post('/process_payment_bypass', async (req, res) => {
    // 1. Validação de sessão (essencial)
    if (!req.session.userId || !req.session.frete || !req.session.endereco_entrega) {
        return res.status(401).json({ success: false, message: 'Sessão inválida ou dados de entrega ausentes.' });
    }

    const user_id = req.session.userId;
    // --- MODIFICAÇÃO ---
    // Pegamos o objeto de frete inteiro da sessão
    const frete_info = req.session.frete;
    const endereco_entrega = req.session.endereco_entrega;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 2. Busca carrinho
        const [cart] = await connection.query('SELECT id FROM carrinhos WHERE user_id = ?', [user_id]);
        if (cart.length === 0) throw new Error('Carrinho não encontrado.');

        const carrinho_id = cart[0].id;
        const [items] = await connection.query(`
            SELECT ci.produto_id, ci.quantidade, p.nome, p.preco, p.desconto_percentual
            FROM carrinho_itens ci JOIN produtos p ON ci.produto_id = p.id WHERE ci.carrinho_id = ?`,
            [carrinho_id]
        );
        if (items.length === 0) throw new Error('Carrinho vazio.');

        // 3. Verificação de estoque (ESSENCIAL)
        for (const item of items) {
            const [[product]] = await connection.query('SELECT nome, estoque FROM produtos WHERE id = ? FOR UPDATE', [item.produto_id]);
            if (!product || product.estoque < item.quantidade) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: `Estoque insuficiente para o produto: ${product.nome}.` });
            }
        }

        // 4. Calcular total
        const subtotal = items.reduce((acc, item) => {
            const precoFinal = item.preco * (1 - item.desconto_percentual / 100);
            return acc + (precoFinal * item.quantidade);
        }, 0);
        // --- MODIFICAÇÃO ---
        // Usamos frete_info.cost para o cálculo
        const transaction_amount = subtotal + frete_info.cost;

        // 5. Criar Pedido (Simulação)
        // --- MODIFICAÇÃO ---
        // Passamos o objeto frete_info completo
        const pedido_id = await createOrder(connection, user_id, transaction_amount, items, 'pago', frete_info, endereco_entrega);

        // Criamos um registro de pagamento fictício aprovado
        await createPaymentRecord(connection, pedido_id, 'credito', 'aprovado', 'TEST_BYPASS_PAYMENT');

        // 6. Decremento de estoque e notificação (Lógica copiada do /process_payment)
        for (const item of items) {
            await connection.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.produto_id]);
            const [[updatedProduct]] = await connection.query('SELECT nome, estoque FROM produtos WHERE id = ?', [item.produto_id]);
            const prevEstoque = updatedProduct.estoque + item.quantidade;

            if (prevEstoque > 5 && updatedProduct.estoque > 0 && updatedProduct.estoque <= 5) {
                await enviarEmailAlertaEstoque(updatedProduct, 'LOW');
                await connection.query('UPDATE produtos SET low_stock_notified = 1 WHERE id = ?', [item.produto_id]);
            }
            if (updatedProduct.estoque === 0) {
                await enviarEmailAlertaEstoque(updatedProduct, 'OUT');
                await connection.query('UPDATE produtos SET out_of_stock_notified = 1 WHERE id = ?', [item.produto_id]);
                await connection.query('UPDATE produtos SET low_stock_notified = 1 WHERE id = ?', [item.produto_id]);
            }
        }

        // 7. Limpar carrinho
        await connection.query('DELETE FROM carrinho_itens WHERE carrinho_id = ?', [carrinho_id]);

        // 8. Disparar o e-mail e gerar a NF
        await enviarConfirmacaoEGerarNF(connection, pedido_id);

        // 9. Limpar sessão
        delete req.session.frete;
        delete req.session.endereco_entrega;

        // 10. Commit
        await connection.commit();

        // 11. Sucesso
        return res.status(201).json({ success: true, message: 'Pagamento de teste aprovado!', orderId: pedido_id });

    } catch (error) {
        await connection.rollback();
        console.error('Erro ao processar pagamento (BYPASS):', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor durante o teste.' });
    } finally {
        connection.release();
    }
});

// --- ROTA MODIFICADA: createOrder ---
async function createOrder(connection, user_id, total, items, status, frete_info, endereco) {
    const { cep, rua, numero, complemento, bairro, cidade, estado } = endereco;

    // A lógica de salvar o endereço na tabela 'users' foi REMOVIDA
    // O endereço de entrega agora é salvo apenas no pedido.

    // Insere o pedido com os novos dados de frete (custo, método e prazo)
    const [pedidoResult] = await connection.query(
        `INSERT INTO pedidos (user_id, status, total, frete, frete_metodo, prazo_entrega_dias, 
                           endereco_cep, endereco_rua, endereco_numero, endereco_complemento, 
                           endereco_bairro, endereco_cidade, endereco_estado) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [user_id, status, total, frete_info.cost, frete_info.name, frete_info.time,
            cep, rua, numero, complemento, bairro, cidade, estado]
    );
    const pedido_id = pedidoResult.insertId;

    const pedidoItensData = items.map(item => [
        pedido_id,
        item.produto_id,
        item.quantidade,
        item.preco * (1 - item.desconto_percentual / 100)
    ]);

    await connection.query(
        'INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, preco_unitario) VALUES ?',
        [pedidoItensData]
    );
    return pedido_id;
}

async function createPaymentRecord(connection, pedido_id, metodo, status, mp_payment_id = null) {
    await connection.query(
        'INSERT INTO pagamentos (pedido_id, metodo, status, mp_payment_id) VALUES (?, ?, ?, ?)',
        [pedido_id, metodo, status, mp_payment_id]
    );
}

// Rota de Confirmação
router.get('/pedido/confirmacao/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const pedido_id = req.params.id;
        const user_id = req.session.userId;

        // ATUALIZAÇÃO: Busca também os dados de endereço do pedido
        const [pedidos] = await db.query(
            `SELECT p.*, DATE_FORMAT(p.criado_em, '%d/%m/%Y %H:%i') as data_pedido,
                    pag.metodo, pag.status as status_pagamento
             FROM pedidos p
             LEFT JOIN pagamentos pag ON p.id = pag.pedido_id
             WHERE p.id = ? AND p.user_id = ?`,
            [pedido_id, user_id]
        );

        if (pedidos.length === 0) return res.status(404).send('Pedido não encontrado.');

        const [itens] = await db.query(
            `SELECT pi.quantidade, pi.preco_unitario, prod.nome, prod.imagem_url 
             FROM pedido_itens pi JOIN produtos prod ON pi.produto_id = prod.id 
             WHERE pi.pedido_id = ?`,
            [pedido_id]
        );

        res.render('confirmacao', { pedido: pedidos[0], itens });
    } catch (error) {
        console.error("Erro ao carregar confirmação:", error);
        res.status(500).send("Erro ao carregar a página de confirmação.");
    }
});

router.get('/carrinho', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    try {
        // Limpa dados de frete/endereço antigos ao visitar o carrinho
        delete req.session.frete;
        delete req.session.endereco_entrega;

        const [cart] = await db.query('SELECT id FROM carrinhos WHERE user_id = ?', [req.session.userId]);
        if (cart.length === 0) {
            return res.render('carrinho', { cart: null });
        }
        const carrinho_id = cart[0].id;
        const [items] = await db.query(
            `SELECT ci.produto_id, ci.quantidade, p.nome, p.preco, p.imagem_url, p.desconto_percentual 
             FROM carrinho_itens ci JOIN produtos p ON ci.produto_id = p.id 
             WHERE ci.carrinho_id = ?`,
            [carrinho_id]
        );
        const total = items.reduce((acc, item) => {
            const precoFinal = item.preco * (1 - item.desconto_percentual / 100);
            return acc + (precoFinal * item.quantidade);
        }, 0);
        res.render('carrinho', { cart: { items, total } });
    } catch (error) {
        console.error('Erro ao buscar carrinho:', error);
        res.status(500).send('Erro ao carregar o carrinho.');
    }
});

router.post('/carrinho/adicionar/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    const produto_id = req.params.id;
    const quantidade = parseInt(req.body.quantity) || 1;
    const user_id = req.session.userId;
    try {
        let [cart] = await db.query('SELECT id FROM carrinhos WHERE user_id = ?', [user_id]);
        let carrinho_id;
        if (cart.length === 0) {
            const [newCart] = await db.query('INSERT INTO carrinhos (user_id) VALUES (?)', [user_id]);
            carrinho_id = newCart.insertId;
        } else {
            carrinho_id = cart[0].id;
        }
        const [existingItem] = await db.query('SELECT * FROM carrinho_itens WHERE carrinho_id = ? AND produto_id = ?', [carrinho_id, produto_id]);
        if (existingItem.length > 0) {
            await db.query('UPDATE carrinho_itens SET quantidade = quantidade + ? WHERE id = ?', [quantidade, existingItem[0].id]);
        } else {
            await db.query('INSERT INTO carrinho_itens (carrinho_id, produto_id, quantidade) VALUES (?, ?, ?)', [carrinho_id, produto_id, quantidade]);
        }
        res.redirect('/carrinho');
    } catch (error) {
        console.error('Erro ao adicionar ao carrinho:', error);
        res.status(500).send('Erro ao adicionar o produto ao carrinho.');
    }
});

router.post('/carrinho/remover/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    const produto_id = req.params.id;
    const user_id = req.session.userId;
    try {
        const [cart] = await db.query('SELECT id FROM carrinhos WHERE user_id = ?', [user_id]);
        if (cart.length > 0) {
            const carrinho_id = cart[0].id;
            await db.query('DELETE FROM carrinho_itens WHERE carrinho_id = ? AND produto_id = ?', [carrinho_id, produto_id]);
        }
        res.redirect('/carrinho');
    } catch (error) {
        console.error('Erro ao remover do carrinho:', error);
        res.status(500).send('Erro ao remover o produto do carrinho.');
    }
});

router.post('/carrinho/atualizar/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    const produto_id = req.params.id;
    const quantidade = parseInt(req.body.quantidade);
    const user_id = req.session.userId;
    if (quantidade < 1) {
        return res.redirect('/carrinho');
    }
    try {
        const [cart] = await db.query('SELECT id FROM carrinhos WHERE user_id = ?', [user_id]);
        if (cart.length > 0) {
            const carrinho_id = cart[0].id;
            await db.query('UPDATE carrinho_itens SET quantidade = ? WHERE carrinho_id = ? AND produto_id = ?', [quantidade, carrinho_id, produto_id]);
        }
        res.redirect('/carrinho');
    } catch (error) {
        console.error('Erro ao atualizar o carrinho:', error);
        res.status(500).send('Erro ao atualizar a quantidade do produto.');
    }
});

router.post('/carrinho/calcular-frete', async (req, res) => {
    const { cep } = req.body;
    const user_id = req.session.userId;
    if (!user_id) {
        return res.status(401).json({ error: 'Usuário não autenticado.' });
    }
    if (!cep || cep.replace(/\D/g, '').length !== 8) {
        return res.status(400).json({ error: 'CEP inválido.' });
    }
    try {
        const [cart] = await db.query('SELECT id FROM carrinhos WHERE user_id = ?', [user_id]);
        if (cart.length === 0) {
            return res.status(404).json({ error: 'Carrinho vazio.' });
        }
        const carrinho_id = cart[0].id;
        const [items] = await db.query(
            `SELECT p.id, p.preco, p.peso, p.largura, p.altura, p.comprimento, ci.quantidade
             FROM carrinho_itens ci JOIN produtos p ON ci.produto_id = p.id
             WHERE ci.carrinho_id = ?`,
            [carrinho_id]
        );
        if (items.length === 0) {
            return res.status(404).json({ error: 'Nenhum item encontrado no carrinho.' });
        }
        const payload = {
            from: { postal_code: process.env.ME_FROM_POSTAL_CODE },
            to: { postal_code: cep },
            products: items.map(item => ({
                id: item.id.toString(),
                width: item.largura,
                height: item.altura,
                length: item.comprimento,
                weight: item.peso,
                insurance_value: parseFloat(item.preco),
                quantity: item.quantidade
            }))
        };
        const response = await axios.post(
            'https://www.melhorenvio.com.br/api/v2/me/shipment/calculate',
            payload,
            {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${process.env.ME_API_TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': `Aplicação ${process.env.ME_EMAIL_TECNICO}`
                }
            }
        );
        res.json(response.data);
    } catch (error) {
        console.error('ERRO DETALHADO AO CALCULAR FRETE:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Não foi possível calcular o frete. Verifique o CEP e tente novamente.' });
    }
});

// Rota para salvar a opção de frete na sessão do usuário
router.post('/carrinho/salvar-frete-e-endereco', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Usuário não autenticado.' });
    }
    const { shipping, address } = req.body;
    if (!shipping || !address || typeof shipping.cost !== 'number' || typeof shipping.name !== 'string') {
        return res.status(400).json({ error: 'Dados de entrega inválidos.' });
    }

    req.session.frete = shipping;
    req.session.endereco_entrega = address;

    res.json({ success: true, message: 'Dados de entrega salvos na sessão.' });
});

// --- Para o frontend verificar o status do pedido ---
router.get('/pedido/status/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Não autorizado" });
    }
    try {
        const [pedidos] = await db.query(
            'SELECT status FROM pedidos WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.userId]
        );
        if (pedidos.length > 0) {
            res.json({ status: pedidos[0].status });
        } else {
            res.status(404).json({ error: 'Pedido não encontrado.' });
        }
    } catch (error) {
        console.error('Erro ao verificar status do pedido:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.get('/meus-pedidos', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const user_id = req.session.userId;

        // Adicionado p.codigo_rastreamento à consulta
        const [pedidos] = await db.query(
            `SELECT 
                p.id, 
                p.status, 
                p.total, 
                DATE_FORMAT(p.criado_em, '%d/%m/%Y') as data_pedido,
                p.criado_em,
                p.prazo_entrega_dias,
                nf.link_arquivo,
                p.codigo_rastreamento 
             FROM pedidos p
             LEFT JOIN notas_fiscais nf ON p.id = nf.pedido_id
             WHERE p.user_id = ?
             ORDER BY p.criado_em DESC`,
            [user_id]
        );
        // Busca os itens de todos os pedidos
        const [itens] = await db.query(
            `SELECT 
                pi.pedido_id, 
                prod.nome, 
                prod.imagem_url
             FROM pedido_itens pi
             JOIN produtos prod ON pi.produto_id = prod.id
             JOIN pedidos p ON pi.pedido_id = p.id
             WHERE p.user_id = ?`,
            [user_id]
        );

        // Agrupa os itens por pedido_id para facilitar a renderização
        const pedidosComItens = pedidos.map(pedido => {
            let data_entrega_estimada = null;

            // Se tivermos o prazo em dias, calculamos a data de entrega
            if (pedido.prazo_entrega_dias) {
                const dataPedido = new Date(pedido.criado_em);
                // Adiciona os dias de prazo à data do pedido
                dataPedido.setDate(dataPedido.getDate() + pedido.prazo_entrega_dias);
                // Formata no estilo "30 de outubro"
                data_entrega_estimada = dataPedido.toLocaleDateString('pt-BR', {
                    day: 'numeric',
                    month: 'long'
                });
            }

            return {
                ...pedido,
                data_entrega_estimada, // Adiciona a nova propriedade
                itens: itens.filter(item => item.pedido_id === pedido.id)
            };
        });

        res.render('meus-pedidos', { pedidos: pedidosComItens });

    } catch (error) {
        console.error("Erro ao carregar 'Meus Pedidos':", error);
        res.status(500).send("Erro ao carregar seu histórico de pedidos.");
    }
});

// Rota para CANCELAR um pedido
router.post('/pedido/cancelar/:id', isAuthenticated, async (req, res) => {
    const pedido_id = req.params.id;
    const user_id = req.session.userId;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Buscar o pedido e o ID do pagamento (FOR UPDATE trava a linha)
        const [[pedidoInfo]] = await connection.query(
            `SELECT 
                p.status, 
                pag.mp_payment_id 
             FROM pedidos p
             LEFT JOIN pagamentos pag ON p.id = pag.pedido_id
             WHERE p.id = ? AND p.user_id = ?
             FOR UPDATE`,
            [pedido_id, user_id]
        );

        // Validar
        if (!pedidoInfo) {
            throw new Error('Pedido não encontrado ou não pertence ao usuário.');
        }

        // Só pode cancelar se estiver 'pago'
        if (pedidoInfo.status !== 'pago') {
            req.session.messages = { error: 'Este pedido não pode ser cancelado (status: ' + pedidoInfo.status + ').' };
            await connection.rollback(); // Libera o lock
            return res.redirect('/meus-pedidos');
        }

        // Iniciar Estorno
        console.log(`[CANCELAR-BYPASS] Estorno simulado para Pedido ${pedido_id}. Nenhum contato com o gateway de pagamento.`);

        // Retornar Itens ao Estoque
        const [itens] = await connection.query(
            'SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?',
            [pedido_id]
        );

        for (const item of itens) {
            await connection.query(
                'UPDATE produtos SET estoque = estoque + ? WHERE id = ?',
                [item.quantidade, item.produto_id]
            );
        }
        console.log(`[CANCELAR] Estoque do pedido ${pedido_id} retornado.`);


        // Atualizar Status do Pedido 
        await connection.query(
            "UPDATE pedidos SET status = 'cancelado' WHERE id = ?",
            [pedido_id]
        );

        // Commit
        await connection.commit();
        
        req.session.messages = { success: 'Pedido cancelado com sucesso!' };
        res.redirect('/meus-pedidos');

    } catch (error) {
        await connection.rollback();
        console.error(`[ERRO CANCELAR] Falha ao cancelar pedido ${pedido_id}:`, error.message);
        req.session.messages = { error: `Não foi possível cancelar o pedido: ${error.message}` };
        res.redirect('/meus-pedidos');
    } finally {
        if (connection) connection.release();
    }
});

// --- ROTA FICTÍCIA: Download NF (Versão Modernizada) ---
router.get('/pedidos/nf/:uuid/:id.pdf', (req, res) => {
    // Pegamos os dados dos parâmetros da rota
    const pedidoId = req.params.id;
    const documentoId = req.params.uuid;

    res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nota Fiscal Fictícia - Pedido #${pedidoId}</title>
        
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Lato:wght@400;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">

        <style>
            /* Copiando as variáveis de cor do seu index.css para consistência */
            :root {
                --color-blue-dark: #0A2463;
                --color-orange-vibrant: #FF9F1C;
                --color-white: #FFFFFF;
                --color-gray-light: #F4F4F9;
                --color-text: #333;
                --font-heading: 'Montserrat', sans-serif;
                --font-body: 'Lato', sans-serif;
                --theme-transition: all 0.5s ease;
            }

            /* Variáveis para o Modo Escuro */
            body.dark-mode {
                --color-blue-dark: #e0e0e0;
                --color-white: #0D1B2A;
                --color-gray-light: #1B263B;
                --color-text: #E0E1E2;
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: var(--font-body);
                color: var(--color-text);
                background-color: var(--color-gray-light);
                transition: var(--theme-transition);
                padding: 2rem 1rem;
            }

            .container {
                max-width: 800px;
                margin: 0 auto;
            }

            /* Estilo do Logo (copiado do header.ejs) */
            .logo {
                font-family: var(--font-heading);
                font-size: 1.8rem;
                font-weight: 800;
                color: var(--color-blue-dark);
                text-decoration: none;
            }
            .logo span {
                color: var(--color-orange-vibrant);
            }

            /* Caixa da Nota Fiscal */
            .invoice-box {
                background-color: var(--color-white);
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.07);
                border: 1px solid #e0e0e0;
                transition: var(--theme-transition);
            }

            .invoice-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 2rem;
                border-bottom: 2px dashed #eee;
            }
            
            .invoice-header h1 {
                font-family: var(--font-heading);
                color: var(--color-blue-dark);
                font-size: 2.2rem;
                display: flex;
                align-items: center;
                gap: 1rem;
            }

            .invoice-body {
                padding: 2.5rem;
                font-size: 1.1rem;
                line-height: 1.7;
            }
            .invoice-body p {
                margin-bottom: 1.5rem;
            }
            .invoice-body strong {
                color: var(--color-blue-dark);
                font-weight: 700;
                margin-right: 8px;
            }
            .invoice-body div {
                margin-bottom: 0.5rem;
            }

            .invoice-footer {
                display: flex;
                justify-content: space-between;
                gap: 1rem;
                padding: 2rem;
                background-color: var(--color-gray-light);
                border-top: 1px solid #e0e0e0;
                border-radius: 0 0 12px 12px;
            }

            /* Botões */
            .btn {
                text-decoration: none;
                font-family: var(--font-heading);
                font-weight: 700;
                font-size: 1rem;
                padding: 0.8rem 1.5rem;
                border-radius: 50px;
                border: 2px solid transparent;
                cursor: pointer;
                transition: all 0.3s ease;
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
            }
            .btn-primary {
                background-color: var(--color-orange-vibrant);
                border-color: var(--color-orange-vibrant);
                color: var(--color-white);
            }
            .btn-primary:hover {
                background-color: #ffb14b;
                border-color: #ffb14b;
                transform: translateY(-3px);
            }
            .btn-secondary {
                background-color: var(--color-blue-dark);
                border-color: var(--color-blue-dark);
                color: var(--color-white);
            }
            .btn-secondary:hover {
                opacity: 0.8;
                transform: translateY(-3px);
            }
            
            /* Ajustes Dark Mode */
            body.dark-mode .invoice-box {
                border-color: #2a3b52;
            }
            body.dark-mode .invoice-header {
                border-color: #2a3b52;
            }
            body.dark-mode .invoice-body strong {
                color: var(--color-orange-vibrant);
            }
            body.dark-mode .invoice-footer {
                border-color: #2a3b52;
            }
            body.dark-mode .btn-primary {
                color: #0D1B2A; /* Texto escuro no botão laranja */
            }
            body.dark-mode .btn-secondary {
                background-color: var(--color-gray-light);
                border-color: var(--color-blue-dark);
                color: var(--color-blue-dark);
            }
            body.dark-mode .btn-secondary:hover {
                background-color: var(--color-blue-dark);
                color: var(--color-gray-light);
            }

        </style>
    </head>
    <body>
        <div class="container">
            <div class="invoice-box">
                <header class="invoice-header">
                    <h1><i class="fas fa-receipt"></i> Nota Fiscal</h1>
                    <div class="logo">RS<span>CardStore</span></div>
                </header>

                <main class="invoice-body">
                    <p>Este é um <strong>documento de simulação</strong> gerado pelo sistema para fins de demonstração.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 1.5rem 0;">
                    <div><strong>Pedido ID:</strong> ${pedidoId}</div>
                    <div><strong>Documento ID:</strong> ${documentoId}</div>
                    
                    <p style="margin-top: 1.5rem; font-size: 0.9rem; color: #555;">
                        Em um sistema real, aqui seriam exibidos os dados completos do comprador,
                        os itens do pedido com valores, impostos e o QR Code da Sefaz.
                    </p>
                </main>

                <footer class="invoice-footer">
                    <a href="/meus-pedidos" class="btn btn-secondary">
                        <i class="fas fa-arrow-left"></i> Voltar
                    </a>
                    
                    <button onclick="downloadTxt()" class="btn btn-primary">
                        <i class="fas fa-download"></i> Baixar .txt
                    </button>
                </footer>
            </div>
        </div>

        <script>
            (function() {
                const checkbox = document.getElementById('theme-checkbox'); // Embora não exista, o script verifica o localStorage
                const userPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                const localTheme = localStorage.getItem('theme');

                if (localTheme === 'dark' || (!localTheme && userPrefersDark)) {
                    document.body.classList.add('dark-mode');
                }
                
                // Simplesmente aplicamos o tema na carga, já que não há switch nesta página
            })();
        </script>
        
        <script>
            function downloadTxt() {
                // 1. Define o conteúdo do arquivo TXT
                const content = \`
Resumo do Pedido - RS Card Store
---------------------------------

Este é um resumo fictício do seu pedido.

Pedido ID: ${pedidoId}
Documento ID (NF): ${documentoId}

(Em um sistema real, aqui estariam todos os itens, preços e dados do cliente)
                \`;

                // 2. Cria um objeto "Blob" (um arquivo em memória)
                const blob = new Blob([content.trim()], { type: 'text/plain' });

                // 3. Cria um link <a> invisível
                const a = document.createElement('a');
                
                // 4. Cria uma URL para o Blob e a define como href do link
                a.href = URL.createObjectURL(blob);
                
                // 5. Define o nome do arquivo que será baixado
                a.download = 'pedido_${pedidoId}.txt';
                
                // 6. Simula o clique no link para iniciar o download
                document.body.appendChild(a);
                a.click();
                
                // 7. Remove o link da memória
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
            }
        </script>
    </body>
    </html>
    `);
});

// --- Webhook para receber notificações do Mercado Pago ---
router.post('/mercado-pago-webhook', async (req, res) => {
    console.log('--- NOVO WEBHOOK RECEBIDO ---');
    try {
        const notification = JSON.parse(req.body.toString('utf8'));

        if (notification.type === 'payment' && notification.data && notification.data.id) {
            const paymentId = notification.data.id;
            const paymentInfo = await payment.get({ id: paymentId });

            if (paymentInfo && paymentInfo.status === 'approved') {
                const mp_payment_id = paymentInfo.id;
                const connection = await db.getConnection();
                try {
                    const [pagamentos] = await connection.query(
                        'SELECT p.pedido_id, ped.status FROM pagamentos p JOIN pedidos ped ON p.pedido_id = ped.id WHERE p.mp_payment_id = ?',
                        [mp_payment_id]
                    );

                    // Garante que a atualização de estoque só ocorra uma vez
                    if (pagamentos.length > 0 && pagamentos[0].status !== 'pago') {
                        const pedido_id = pagamentos[0].pedido_id;
                        await connection.beginTransaction();

                        await connection.query("UPDATE pagamentos SET status = 'aprovado' WHERE mp_payment_id = ?", [mp_payment_id]);
                        await connection.query("UPDATE pedidos SET status = 'pago' WHERE id = ?", [pedido_id]);

                        // Decremento de estoque para pagamentos via webhook (PIX)
                        const [items] = await connection.query('SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?', [pedido_id]);
                        for (const item of items) {
                            await connection.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.produto_id]);
                            const [[updatedProduct]] = await connection.query('SELECT nome, estoque FROM produtos WHERE id = ?', [item.produto_id]);
                            const prevEstoque = updatedProduct.estoque + item.quantidade;

                            // LOW: cruzou de >5 para 1..5
                            if (prevEstoque > 5 && updatedProduct.estoque > 0 && updatedProduct.estoque <= 5) {
                                await enviarEmailAlertaEstoque(updatedProduct, 'LOW');
                                await connection.query('UPDATE produtos SET low_stock_notified = 1 WHERE id = ?', [item.produto_id]);
                            }

                            // OUT: chegou a 0 (sempre avisa)
                            if (updatedProduct.estoque === 0) {
                                await enviarEmailAlertaEstoque(updatedProduct, 'OUT');
                                await connection.query('UPDATE produtos SET out_of_stock_notified = 1 WHERE id = ?', [item.produto_id]);
                                await connection.query('UPDATE produtos SET low_stock_notified = 1 WHERE id = ?', [item.produto_id]);
                            }
                        }

                        await connection.commit();
                        console.log(`[SUCESSO] Pedido ${pedido_id} atualizado para 'pago' e estoque decrementado.`);
                    }
                } catch (dbError) {
                    console.error('[ERRO DB] Erro no banco de dados do webhook:', dbError);
                    await connection.rollback();
                } finally {
                    if (connection) connection.release();
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('[ERRO GERAL] Erro ao processar webhook:', error);
        res.status(500).send('Erro no webhook.');
    }
});

router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ ok: false, message: 'E-mail inválido.' });

        const [[user]] = await db.query(
            'SELECT id, email_verificado, last_verification_sent_at FROM users WHERE email = ?',
            [email]
        );

        if (!user) return res.status(404).json({ ok: false, message: 'Usuário não encontrado.' });
        if (user.email_verificado) return res.json({ ok: true, message: 'E-mail já verificado.' });

        const agora = new Date();
        if (user.last_verification_sent_at) {
            const diff = (agora - new Date(user.last_verification_sent_at)) / 1000;
            if (diff < 60) {
                const restante = Math.ceil(60 - diff);
                return res.status(429).json({ ok: false, message: `Aguarde ${restante}s para reenviar.`, cooldown: restante });
            }
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expira = new Date(Date.now() + 5 * 60 * 1000);

        await db.query(
            'UPDATE users SET token_verificacao = ?, token_verificacao_expira = ?, last_verification_sent_at = NOW() WHERE id = ?',
            [token, expira, user.id]
        );

        await enviarEmailVerificacao(email, token);

        return res.json({ ok: true, message: 'Novo link enviado para seu e-mail.', cooldown: 60 });
    } catch (err) {
        console.error('[resend-verification]', err);
        return res.status(500).json({ ok: false, message: 'Erro ao reenviar link.' });
    }
});

// --- NOVAS ROTAS: MINHA CONTA / PERFIL ---

// 1. GET: Exibe a página "Minha Conta"
router.get('/minha-conta', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;

        const [userRows] = await db.query(
            'SELECT nome, email, telefone FROM users WHERE id = ?',
            [userId]
        );
        const [enderecos] = await db.query(
            'SELECT * FROM user_enderecos WHERE user_id = ? ORDER BY is_principal DESC, id ASC',
             [userId]
        );

        // Busca os produtos favoritos fazendo JOIN com a tabela de produtos
        const [favoritos] = await db.query(
            `SELECT p.id, p.nome, p.preco, p.desconto_percentual, p.imagem_url, p.categoria 
             FROM user_favoritos uf
             JOIN produtos p ON uf.produto_id = p.id
             WHERE uf.user_id = ?
             ORDER BY uf.criado_em DESC`,
            [userId]
        );

        if (userRows.length === 0) {
            return res.redirect('/logout');
        }

        res.render('meu-perfil', {
            user: userRows[0],
            enderecos: enderecos,
            favoritos: favoritos,
            messages: res.locals.getMessages() 
        });

    } catch (error) {
        console.error('Erro ao carregar Minha Conta:', error);
        res.status(500).send('Erro ao carregar sua página de perfil.');
    }
});

// 2. POST: Atualiza dados básicos (Nome, Telefone)
router.post('/minha-conta/perfil', isAuthenticated, async (req, res) => {
    const { nome, telefone } = req.body;
    const telefoneNumerico = telefone.replace(/\D/g, '');

    if (telefoneNumerico.length < 10 || telefoneNumerico.length > 11) {
        req.session.messages = { error: 'O telefone deve conter 10 ou 11 dígitos.' };
        return res.redirect('/minha-conta');
    }

    try {
        await db.query(
            'UPDATE users SET nome = ?, telefone = ? WHERE id = ?',
            [nome, telefoneNumerico, req.session.userId]
        );
        req.session.messages = { success: 'Dados atualizados com sucesso!' };
        // Atualiza o nome na sessão
        req.session.userName = nome;
        res.redirect('/minha-conta');
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        req.session.messages = { error: 'Erro ao atualizar seus dados.' };
        res.redirect('/minha-conta');
    }
});

// 3. POST: Altera a senha
router.post('/minha-conta/senha', isAuthenticated, async (req, res) => {
    const { senha_atual, nova_senha, confirmar_nova_senha } = req.body;

    if (nova_senha !== confirmar_nova_senha) {
        req.session.messages = { error: 'As novas senhas não coincidem.' };
        return res.redirect('/minha-conta');
    }
    
    if (nova_senha.length < 8 || !/\d/.test(nova_senha) || !/[a-zA-Z]/.test(nova_senha)) {
        req.session.messages = { error: 'A nova senha deve ter no mínimo 8 caracteres, com letras e números.' };
        return res.redirect('/minha-conta');
    }

    try {
        const [users] = await db.query('SELECT senha_hash FROM users WHERE id = ?', [req.session.userId]);
        if (users.length === 0) return res.redirect('/logout');

        const user = users[0];
        const senhaCorreta = await bcrypt.compare(senha_atual, user.senha_hash);

        if (!senhaCorreta) {
            req.session.messages = { error: 'A senha atual está incorreta.' };
            return res.redirect('/minha-conta');
        }

        const salt = await bcrypt.genSalt(10);
        const nova_senha_hash = await bcrypt.hash(nova_senha, salt);

        await db.query('UPDATE users SET senha_hash = ? WHERE id = ?', [nova_senha_hash, req.session.userId]);
        
        req.session.messages = { success: 'Senha alterada com sucesso!' };
        res.redirect('/minha-conta');

    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        req.session.messages = { error: 'Erro no servidor ao tentar alterar a senha.' };
        res.redirect('/minha-conta');
    }
});

// 4. POST: Adiciona um novo endereço
router.post('/minha-conta/endereco', isAuthenticated, async (req, res) => {
    const { apelido, cep, logradouro, numero, complemento, bairro, cidade, estado } = req.body;
    const user_id = req.session.userId;

    try {
        // Verifica se já existe algum endereço
        const [[{ count }]] = await db.query(
            'SELECT COUNT(*) as count FROM user_enderecos WHERE user_id = ?', 
            [user_id]
        );
        
        // Se for o primeiro, define como principal
        const is_principal = count === 0;

        await db.query(
            `INSERT INTO user_enderecos 
             (user_id, is_principal, apelido, cep, logradouro, numero, complemento, bairro, cidade, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user_id, is_principal, apelido, cep, logradouro, numero, complemento, bairro, cidade, estado]
        );
        
        req.session.messages = { success: 'Endereço adicionado com sucesso!' };
        res.redirect('/minha-conta');
    } catch (error) {
        console.error('Erro ao adicionar endereço:', error);
        req.session.messages = { error: 'Erro ao adicionar endereço.' };
        res.redirect('/minha-conta');
    }
});

// 5. POST: Define um endereço como principal (Requer transação)
router.post('/minha-conta/endereco/definir-principal/:id', isAuthenticated, async (req, res) => {
    const endereco_id = req.params.id;
    const user_id = req.session.userId;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        
        // 1. Remove 'principal' de todos os endereços do usuário
        await connection.query(
            'UPDATE user_enderecos SET is_principal = FALSE WHERE user_id = ?',
            [user_id]
        );
        
        // 2. Define o novo endereço como 'principal'
        await connection.query(
            'UPDATE user_enderecos SET is_principal = TRUE WHERE id = ? AND user_id = ?',
            [endereco_id, user_id]
        );
        
        await connection.commit();
        req.session.messages = { success: 'Endereço principal atualizado!' };

    } catch (error) {
        await connection.rollback();
        console.error('Erro ao definir endereço principal:', error);
        req.session.messages = { error: 'Erro ao atualizar endereço principal.' };
    } finally {
        connection.release();
        res.redirect('/minha-conta');
    }
});

// 6. POST: Remove um endereço
router.post('/minha-conta/endereco/remover/:id', isAuthenticated, async (req, res) => {
    const endereco_id = req.params.id;
    const user_id = req.session.userId;
    
    try {
        // Verifica se o endereço a ser removido é o principal
        const [[endereco]] = await db.query(
            'SELECT is_principal FROM user_enderecos WHERE id = ? AND user_id = ?',
            [endereco_id, user_id]
        );

        if (!endereco) {
            req.session.messages = { error: 'Endereço não encontrado.' };
            return res.redirect('/minha-conta');
        }

        await db.query('DELETE FROM user_enderecos WHERE id = ? AND user_id = ?', [endereco_id, user_id]);
        
        // Se era o principal, define outro (o mais antigo) como principal
        if (endereco.is_principal) {
            const [outrosEnderecos] = await db.query(
                'SELECT id FROM user_enderecos WHERE user_id = ? ORDER BY id ASC LIMIT 1',
                [user_id]
            );
            if (outrosEnderecos.length > 0) {
                await db.query('UPDATE user_enderecos SET is_principal = TRUE WHERE id = ?', [outrosEnderecos[0].id]);
            }
        }
        
        req.session.messages = { success: 'Endereço removido com sucesso!' };
        res.redirect('/minha-conta');
    } catch (error) {
        console.error('Erro ao remover endereço:', error);
        req.session.messages = { error: 'Erro ao remover endereço.' };
        res.redirect('/minha-conta');
    }
});

// 7. GET (API): Busca dados de um endereço para edição
router.get('/api/minha-conta/endereco/:id', isAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(
            'SELECT * FROM user_enderecos WHERE id = ? AND user_id = ?',
            [id, req.session.userId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Endereço não encontrado.' });
        }
        res.json({ success: true, endereco: rows[0] });
    } catch (error) {
        console.error('Erro ao buscar endereço por API:', error);
        res.status(500).json({ success: false, message: 'Erro no servidor.' });
    }
});

// 8. POST: Atualiza (Edita) um endereço
router.post('/minha-conta/endereco/editar/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const user_id = req.session.userId;
    // Extrai os dados do formulário
    const { apelido, cep, logradouro, numero, complemento, bairro, cidade, estado } = req.body;

    try {
        await db.query(
            `UPDATE user_enderecos SET 
             apelido = ?, cep = ?, logradouro = ?, numero = ?, complemento = ?, 
             bairro = ?, cidade = ?, estado = ?
             WHERE id = ? AND user_id = ?`,
            [apelido, cep, logradouro, numero, complemento, bairro, cidade, estado, id, user_id]
        );
        req.session.messages = { success: 'Endereço atualizado com sucesso!' };
    } catch (error) {
        console.error('Erro ao editar endereço:', error);
        req.session.messages = { error: 'Erro ao atualizar o endereço.' };
    }
    res.redirect('/minha-conta');
});

router.post('/api/favoritos/toggle/:id', isAuthenticated, async (req, res) => {
    try {
        const produto_id = req.params.id;
        const user_id = req.session.userId;

        // Verifica se o favorito já existe
        const [existing] = await db.query(
            'SELECT id FROM user_favoritos WHERE user_id = ? AND produto_id = ?',
            [user_id, produto_id]
        );

        if (existing.length > 0) {
            // Se existe, remove (unfavorite)
            await db.query('DELETE FROM user_favoritos WHERE id = ?', [existing[0].id]);
            res.json({ success: true, isFavorito: false, message: 'Removido dos favoritos.' });
        } else {
            // Se não existe, adiciona (favorite)
            await db.query('INSERT INTO user_favoritos (user_id, produto_id) VALUES (?, ?)', 
                [user_id, produto_id]
            );
            res.json({ success: true, isFavorito: true, message: 'Adicionado aos favoritos!' });
        }

    } catch (error) {
        console.error('Erro ao alternar favorito:', error);
        res.status(500).json({ success: false, message: 'Erro no servidor ao processar sua solicitação.' });
    }
});

module.exports = router;