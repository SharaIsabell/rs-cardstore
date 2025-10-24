const express = require('express');
const router = express.Router();
const db = require('../database/pooldb');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { enviarEmailVerificacao, enviarEmailAlertaEstoque, enviarEmailConfirmacaoPedido } = require('../frontend/js/enviarEmail');
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

// Isolando admin do usuário
router.use((req, res, next) => {
  if (req.session && req.session.isAdmin && req.session.pinValidated) {
    if (!req.path.startsWith('/admin')) {
      return res.redirect('/admin');
    }
  }
  next();
});

// --- Gerar NF Fictícia ---
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

// --- Enviar E-mail de Confirmação ---
async function enviarConfirmacaoEGerarNF(connection, pedido_id) {
  try {
    // Gerar Nota Fiscal
    const linkNF = await gerarNotaFiscalFicticia(connection, pedido_id);

    // Buscar dados completos para o e-mail
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
    
    // Enviar e-mail de confirmação 
    await enviarEmailConfirmacaoPedido(pedido, itens, linkNF);
    
    console.log(`[SUCESSO] E-mail de confirmação e NF gerada para pedido ${pedido_id}.`);

  } catch (error) {
      console.error(`[ERRO EMAIL/NF] Falha ao processar pós-pagamento para pedido ${pedido_id}:`, error.message);
  }
}

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

async function renderProductPage(req, res, viewName, category, baseUrl) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 4; // Limite de 4 produtos por página
    const offset = (page - 1) * limit;

    // Condição WHERE para a consulta
    const whereClause = category ? `WHERE categoria = ?` : `WHERE promocao = TRUE`;
    const queryParams = category ? [category] : [];

    // Contar o total de produtos para calcular as páginas
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM produtos ${whereClause}`,
      queryParams
    );

    const totalPages = Math.ceil(total / limit);

    // Buscar os produtos da página atual
    const [produtos] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos 
         ${whereClause}
         ORDER BY id DESC 
         LIMIT ? 
         OFFSET ?`,
      [...queryParams, limit, offset]
    );

    res.render(viewName, {
      produtos: produtos,
      totalPages: totalPages,
      currentPage: page,
      baseUrl: baseUrl 
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

router.get('/acessorios', (req, res) => {
  renderProductPage(req, res, 'acessorios', 'Acessorios', '/acessorios');
});

router.get('/promocoes', (req, res) => {
  renderProductPage(req, res, 'promocoes', null, '/promocoes');
});

router.get('/login', (req, res) => {
    let message = '';
    if (req.query.status === 'verificado') {
        message = 'E-mail verificado com sucesso! Você já pode fazer o login.';
    }
    // Passamos tanto a mensagem de sucesso quanto a de erro (inicialmente nula)
    res.render('login', { message: message, errorMessage: null });
});

// ROTA DE REGISTRO 
router.post('/register', async (req, res) => {
  const { nome, email, telefone, senha, confirmSenha } = req.body;
  
  const respondError = (message) => {
    if (req.accepts('json')) {
      return res.status(400).json({ success: false, message });
    }
    return res.status(400).render('login', { 
        message: null, 
        errorMessage: message,
        showRegister: true
    });
  };

  if (senha !== confirmSenha) {
    return respondError('As senhas não coincidem.');
  }

  if (senha.length < 8 || !/\d/.test(senha) || !/[a-zA-Z]/.test(senha)) {
    return respondError('A senha deve ter no mínimo 8 caracteres, incluindo letras e números.');
  }

  const telefoneNumerico = telefone.replace(/\D/g, '');
  if (telefoneNumerico.length < 10 || telefoneNumerico.length > 11) {
    return respondError('O telefone deve conter 10 ou 11 dígitos numéricos.');
  }

  try {
    const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      return respondError('Este e-mail já está cadastrado.');
    }

    const salt = await bcrypt.genSalt(10);
    const senha_hash = await bcrypt.hash(senha, salt);
    const token_verificacao = crypto.randomBytes(32).toString('hex');
    const token_verificacao_expira = new Date(Date.now() + 5 * 60 * 1000);
    
    await db.query(
      'INSERT INTO users (nome, email, telefone, senha_hash, token_verificacao, token_verificacao_expira) VALUES (?, ?, ?, ?, ?, ?)',
      [nome, email, telefoneNumerico, senha_hash, token_verificacao, token_verificacao_expira]
    );

    await enviarEmailVerificacao(email, token_verificacao);
    
  // Ao cadastrar com sucesso, renderize a página de login com uma mensagem de sucesso
  if (req.accepts('json')) {
      return res.status(201).json({ success: true, message: 'Cadastro realizado com sucesso! Por favor, verifique seu e-mail para continuar.' });
  }

  return res.status(201).render('login', {
    errorMessage: null,
    message: 'Cadastro realizado com sucesso! Por favor, verifique seu e-mail para continuar.',
    showRegister: false
  });

  } catch (error) {
    console.error('ERRO DETALHADO AO CADASTRAR:', error);
    return respondError('Ocorreu um erro no servidor ao tentar realizar o cadastro.');
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

// Tenta o ADMIN primeiro
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

        // limpa flags de cliente para evitar dados do usuário
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
    // Não é admin (ou senha incorreta) -> segue fluxo de CLIENTE
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

// --- Buscar endereço do usuário ---
router.get('/api/get-address', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Não autenticado.' });
    }
    try {
        // Seleciona as novas colunas de endereço
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

// ROTA CHECKOUT 
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
                  
                  // Decremento de estoque e notificação
                  for (const item of items) {
                    await connection.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?',[item.quantidade, item.produto_id]);
                    const [[updatedProduct]] = await connection.query('SELECT nome, estoque FROM produtos WHERE id = ?',[item.produto_id]);
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

async function createOrder(connection, user_id, total, items, status, frete, endereco) {
    const { cep, rua, numero, complemento, bairro, cidade, estado } = endereco;
    
    // Verifica se o usuário já tem um CEP cadastrado
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

        // Busca também os dados de endereço do pedido
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
        
        // Busca pedidos e a NF associada (se houver)
        const [pedidos] = await db.query(
            `SELECT 
                p.id, 
                p.status, 
                p.total, 
                DATE_FORMAT(p.criado_em, '%d/%m/%Y') as data_pedido,
                nf.link_arquivo
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
        const pedidosComItens = pedidos.map(pedido => ({
            ...pedido,
            itens: itens.filter(item => item.pedido_id === pedido.id)
        }));

        res.render('meus-pedidos', { pedidos: pedidosComItens });

    } catch (error) {
        console.error("Erro ao carregar 'Meus Pedidos':", error);
        res.status(500).send("Erro ao carregar seu histórico de pedidos.");
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
                color: #0D1B2A; 
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
                // Define o conteúdo do arquivo TXT
                const content = \`
Resumo do Pedido - RS Card Store
---------------------------------

Este é um resumo fictício do seu pedido.

Pedido ID: ${pedidoId}
Documento ID (NF): ${documentoId}

(Em um sistema real, aqui estariam todos os itens, preços e dados do cliente)
                \`;

                // Cria um objeto "Blob" (um arquivo em memória)
                const blob = new Blob([content.trim()], { type: 'text/plain' });

                // Cria um link <a> invisível
                const a = document.createElement('a');
                
                // Cria uma URL para o Blob e a define como href do link
                a.href = URL.createObjectURL(blob);
                
                // Define o nome do arquivo que será baixado
                a.download = 'pedido_${pedidoId}.txt';
                
                // Simula o clique no link para iniciar o download
                document.body.appendChild(a);
                a.click();
                
                // Remove o link da memória
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

            if (paymentInfo && paymentInfo.status === 'approved'){
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
                          await connection.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?',[item.quantidade, item.produto_id]);
                          const [[updatedProduct]] = await connection.query('SELECT nome, estoque FROM produtos WHERE id = ?',[item.produto_id]);
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

module.exports = router;