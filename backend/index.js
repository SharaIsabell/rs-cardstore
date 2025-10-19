const express = require('express');
const router = express.Router();
const db = require('../database/pooldb');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { enviarEmailVerificacao } = require('../frontend/js/enviarEmail');
const session = require('express-session');
const axios = require('axios');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { v4: uuidv4 } = require('uuid');

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
  next();
});

// ... (outras rotas como '/', '/magic', etc. permanecem as mesmas)
router.get('/', async (req, res) => {
  try {
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
    res.render('index', { destaques: destaques });
  } catch (err) {
    console.error("Erro ao carregar destaques da página inicial:", err);
    res.render('index', { destaques: [] });
  }
});

router.get('/magic', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos 
        WHERE categoria = ? 
     ORDER BY id DESC`,
      ['Magic']
    );
    res.render('magic', { produtos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao carregar produtos de Magic.');
  }
});

router.get('/yugioh', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo
         FROM produtos
        WHERE categoria = ?
     ORDER BY id DESC`,
      ['Yu-Gi-Oh']
    );
    res.render('yugioh', { produtos: rows });
  } catch (err) {
    console.error('Erro ao consultar produtos Yu-Gi-Oh:', err);
    res.status(500).send('Erro ao carregar produtos de Yu-Gi-Oh.');
  }
});

router.get('/pokemon', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo
         FROM produtos
        WHERE categoria = ?
     ORDER BY id DESC`,
      ['Pokemon']
    );
    res.render('pokemon', { produtos: rows });
  } catch (err) {
    console.error('Erro ao consultar produtos Pokémon:', err);
    res.status(500).send('Erro ao carregar produtos de Pokémon.');
  }
});

router.get('/produto/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, categoria, estoque 
         FROM produtos 
        WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).send('Produto não encontrado.');
    }
    res.render('produto', { produto: rows[0] });
  } catch (err) {
    console.error('Erro ao carregar o produto:', err);
    res.status(500).send('Erro ao carregar a página do produto.');
  }
});

router.get('/acessorios', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos 
        WHERE categoria = ? 
     ORDER BY id DESC`,
      ['Acessorios']
    );
    res.render('acessorios', { produtos: rows });
  } catch (err) {
    console.error('Erro ao carregar produtos de Acessórios:', err);
    res.status(500).send('Erro ao carregar a página de acessórios.');
  }
});

router.get('/promocoes', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos 
        WHERE promocao = ? 
     ORDER BY id DESC`,
      [true]
    );
    res.render('promocoes', { produtos: rows });
  } catch (err) {
    console.error('Erro ao carregar produtos em promoção:', err);
    res.status(500).send('Erro ao carregar a página de promoções.');
  }
});

router.get('/login', (req, res) => {
    let message = '';
    if (req.query.status === 'verificado') {
        message = 'E-mail verificado com sucesso! Você já pode fazer o login.';
    }
    // Passamos tanto a mensagem de sucesso quanto a de erro (inicialmente nula)
    res.render('login', { message: message, errorMessage: null });
});

// ROTA DE REGISTRO MODIFICADA
router.post('/register', async (req, res) => {
  // O campo 'endereco' não é mais coletado aqui
  const { nome, email, telefone, senha, confirmSenha } = req.body;
  
  if (senha !== confirmSenha) {
    return res.status(400).send('As senhas não coincidem.');
  }
  if (senha.length < 8 || !/\d/.test(senha) || !/[a-zA-Z]/.test(senha)) {
      return res.status(400).send('A senha deve ter no mínimo 8 caracteres, incluindo letras e números.');
  }
  const telefoneNumerico = telefone.replace(/\D/g, '');
  if (telefoneNumerico.length < 10 || telefoneNumerico.length > 11) { // Ajuste para 10 ou 11 dígitos
    return res.status(400).send('O telefone deve conter 10 ou 11 dígitos numéricos.');
  }

  try {
    const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
        return res.status(409).send('Este e-mail já está cadastrado.');
    }
    const salt = await bcrypt.genSalt(10);
    const senha_hash = await bcrypt.hash(senha, salt);
    const token_verificacao = crypto.randomBytes(32).toString('hex');
    const token_verificacao_expira = new Date(Date.now() + 5 * 60 * 1000);
    
    // Query de inserção sem o campo 'endereco'
    await db.query(
      'INSERT INTO users (nome, email, telefone, senha_hash, token_verificacao, token_verificacao_expira) VALUES (?, ?, ?, ?, ?, ?)',
      [nome, email, telefoneNumerico, senha_hash, token_verificacao, token_verificacao_expira]
    );

    await enviarEmailVerificacao(email, token_verificacao);
    res.status(201).send('Cadastro realizado com sucesso! Por favor, verifique seu e-mail.');
  } catch (error) {
    console.error('ERRO DETALHADO AO CADASTRAR:', error);
    res.status(500).send('Ocorreu um erro no servidor ao tentar realizar o cadastro.');
  }
});

router.get('/verificar-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send('Token de verificação não fornecido.');
    }
    const [users] = await db.query(
      'SELECT * FROM users WHERE token_verificacao = ? AND token_verificacao_expira > NOW()',
      [token]
    );
    if (users.length === 0) {
      return res.status(400).send('Token de verificação inválido ou expirado.');
    }
    const user = users[0];
    await db.query(
      'UPDATE users SET email_verificado = TRUE, token_verificacao = NULL, token_verificacao_expira = NULL WHERE id = ?',
      [user.id]
    );
    res.redirect('/login?status=verificado');
  } catch (error) {
    console.error('ERRO AO VERIFICAR E-MAIL:', error);
    res.status(500).send('Ocorreu um erro no servidor ao tentar verificar o e-mail.');
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    // 1) Tenta ADMIN primeiro
    {
      const [admins] = await db.query(
        'SELECT id, email, password_hash, is_active FROM admins WHERE email = ?',
        [email]
      );
      if (admins.length > 0 && admins[0].is_active === 1) {
        const ok = await bcrypt.compare(senha, admins[0].password_hash);
        if (ok) {
          // Regenera sessão p/ evitar fixation
          return req.session.regenerate(err => {
            if (err) {
              console.error('Erro ao regenerar sessão (admin):', err);
              return res.status(500).render('login', { message: null, errorMessage: 'Erro no servidor.' });
            }
            // Seta flags de admin e limpa qualquer estado de cliente
            req.session.isAdmin = true;
            req.session.adminId = admins[0].id;
            req.session.adminEmail = admins[0].email;

            delete req.session.userId;
            delete req.session.userName;
            delete req.session.canAccessCheckout;
            delete req.session.frete;
            delete req.session.freteInfo;
            delete req.session.pagamento;

            return req.session.save(() => res.redirect('/admin'));
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

// --- NOVA ROTA: Buscar endereço do usuário ---
router.get('/api/get-address', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Não autenticado.' });
    }
    try {
        // CORREÇÃO: Seleciona as novas colunas de endereço
        const [users] = await db.query(
            'SELECT cep, logradouro, numero, complemento, bairro, cidade, estado FROM users WHERE id = ?', 
            [req.session.userId]
        );

        if (users.length > 0 && users[0].cep) {
            // Monta um objeto de endereço para enviar ao front-end
            const address = {
                cep: users[0].cep,
                rua: users[0].logradouro, // O front-end espera 'rua'
                numero: users[0].numero,
                complemento: users[0].complemento,
                bairro: users[0].bairro,
                cidade: users[0].cidade,
                estado: users[0].estado,
            };
            // O front-end espera um JSON stringificado, então mantemos esse padrão
            res.json({ success: true, address: JSON.stringify(address) });
        } else {
            res.json({ success: false, message: 'Nenhum endereço cadastrado.' });
        }
    } catch (error) {
        console.error('Erro ao buscar endereço:', error);
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
    const frete = req.session.frete.cost;
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

        const subtotal = items.reduce((acc, item) => {
            const precoFinal = item.preco * (1 - item.desconto_percentual / 100);
            return acc + (precoFinal * item.quantidade);
        }, 0);
        
        const transaction_amount = subtotal + frete;
        let paymentResult;
        const idempotencyKey = uuidv4();

        if (payment_method === 'card' || payment_method === 'pix') {
            const pedido_id = await createOrder(connection, user_id, transaction_amount, items, 'pendente', frete, endereco_entrega);

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
                    await connection.query('DELETE FROM carrinho_itens WHERE carrinho_id = ?', [carrinho_id]);
                    
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

async function createOrder(connection, user_id, total, items, status, frete, endereco) {
    const { cep, rua, numero, complemento, bairro, cidade, estado } = endereco;
    
    // CORREÇÃO: Verifica se o usuário já tem um CEP cadastrado
    const [[currentUser]] = await connection.query('SELECT cep FROM users WHERE id = ?', [user_id]);
    
    // Se o usuário não tiver um endereço principal, salva este como principal
    if (!currentUser || !currentUser.cep) {
        await connection.query(
            'UPDATE users SET cep = ?, logradouro = ?, numero = ?, complemento = ?, bairro = ?, cidade = ?, estado = ? WHERE id = ?', 
            [cep, rua, numero, complemento, bairro, cidade, estado, user_id]
        );
    }

    // Insere o pedido com o endereço de entrega específico
    const [pedidoResult] = await connection.query(
        'INSERT INTO pedidos (user_id, status, total, frete, endereco_cep, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user_id, status, total, frete, cep, rua, numero, complemento, bairro, cidade, estado]
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

// --- ROTA NOVA: Para o frontend verificar o status do pedido ---
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

// --- ROTA NOVA: Webhook para receber notificações do Mercado Pago ---
// SUBSTITUA SUA ROTA DE WEBHOOK ANTIGA POR ESTA:
router.post('/mercado-pago-webhook', async (req, res) => {
    console.log('--- NOVO WEBHOOK RECEBIDO ---');

    try {
        // LINHA CORRIGIDA: Converte o corpo bruto (Buffer) para JSON
        const notification = JSON.parse(req.body);
        
        if (notification.type === 'payment' && notification.data && notification.data.id) {
            const paymentId = notification.data.id;
            console.log(`[LOG 1] Notificação de pagamento recebida. ID do Pagamento (mp_payment_id): ${paymentId}`);

            const paymentInfo = await payment.get({ id: paymentId });
            console.log('[LOG 2] Informações do pagamento obtidas do MP:', { id: paymentInfo.id, status: paymentInfo.status });

            if (paymentInfo && (paymentInfo.status === 'approved' || paymentInfo.status === 'pending')){
                const mp_payment_id = paymentInfo.id;

                const connection = await db.getConnection();
                try {
                    console.log(`[LOG 3] Buscando no banco de dados pelo mp_payment_id: ${mp_payment_id}`);
                    const [pagamentos] = await connection.query(
                        'SELECT pedido_id FROM pagamentos WHERE mp_payment_id = ?',
                        [mp_payment_id]
                    );

                    if (pagamentos.length > 0) {
                        const pedido_id = pagamentos[0].pedido_id;
                        console.log(`[LOG 4] Pedido encontrado! ID do Pedido: ${pedido_id}. Iniciando atualização...`);

                        await connection.beginTransaction();
                        await connection.query("UPDATE pagamentos SET status = 'aprovado' WHERE mp_payment_id = ?", [mp_payment_id]);
                        await connection.query("UPDATE pedidos SET status = 'pago' WHERE id = ?", [pedido_id]);
                        await connection.commit();

                        console.log(`[LOG 5] Sucesso! Pedido ${pedido_id} atualizado para 'pago'.`);
                    } else {
                        console.warn(`[LOG FALHA] Nenhum pedido encontrado no banco de dados para o mp_payment_id: ${mp_payment_id}`);
                        // Mesmo em falha, não vamos reverter para garantir que a transação termine.
                    }
                } catch (dbError) {
                    console.error('[LOG ERRO DB] Erro no banco de dados:', dbError);
                } finally {
                    if (connection) connection.release();
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('[LOG ERRO GERAL] Erro ao processar webhook:', error);
        res.status(500).send('Erro no webhook.');
    }
});

module.exports = router;