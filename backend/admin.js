const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/pooldb');

// novo roteador
const { produtosAdminRouter } = require('./produtos-admin'); 

function requireAdminLogin(req, res, next) {
  if (!(req.session && req.session.isAdmin)) {
    return res.redirect('/admin/login');
  }
  next();
}

function requireAdminPin(req, res, next) {
  if (!(req.session && req.session.isAdmin)) {
    return res.redirect('/admin/login');
  }
  if (!req.session.pinValidated) {
    return res.redirect('/admin/pin');
  }
  next();
}

/* Utilitário de PIN */
const PIN_LEN = parseInt(process.env.ADMIN_PIN_LENGTH || '6', 10);
function generatePin(len = PIN_LEN) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
}

// Tela de login 
router.get('/login', (req, res) => {
  res.render('login', { message: null, errorMessage: null });
});

// Autenticação do admin
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    // Busca admin no BD (MySQL)
    const [rows] = await db.query(
      'SELECT id, email, senha_hash FROM admins WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res
        .status(401)
        .render('login', { message: null, errorMessage: 'E-mail ou senha inválidos.' });
    }

    const admin = rows[0];
    const ok = await bcrypt.compare(senha, admin.senha_hash);
    if (!ok) {
      return res
        .status(401)
        .render('login', { message: null, errorMessage: 'E-mail ou senha inválidos.' });
    }

    // Seta sessão de admin e força fluxo do PIN
    req.session.isAdmin = true;
    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    req.session.pinValidated = false;
    req.session.adminPin = generatePin();

    return res.redirect('/admin/pin');
  } catch (e) {
    console.error('[admin] login error:', e);
    return res
      .status(500)
      .render('login', { message: null, errorMessage: 'Erro ao autenticar.' });
  }
});

// Tela do PIN
router.get('/pin', requireAdminLogin, (req, res) => {
  const pin = req.session.adminPin || generatePin();
  req.session.adminPin = pin; // garante que existe
  return res.render('admin/pin', {
    adminEmail: req.session.adminEmail,
    pin,
    pinLen: String(pin).length,
    errorMessage: null
  });
});

// Valida o PIN
router.post('/pin', requireAdminLogin, (req, res) => {
  const { pin } = req.body;

  if (!pin || pin !== String(req.session.adminPin)) {
    return res.status(400).render('admin/pin', {
      adminEmail: req.session.adminEmail,
      pin: req.session.adminPin,
      pinLen: String(req.session.adminPin || '').length,
      errorMessage: 'PIN inválido.'
    });

  }

  req.session.pinValidated = true;
  return res.redirect('/admin');
});

// Dashboard (somente admin com PIN validado)
router.get('/', requireAdminPin, async (req, res) => {
  try {
    // Busca produtos com 5 ou menos unidades em estoque para exibir no painel
    const [notificacoesEstoque] = await db.query(
      `SELECT id, nome, estoque 
         FROM produtos 
        WHERE estoque <= 5 
     ORDER BY estoque ASC, nome ASC`
    );

    return res.render('admin/dashboard', { 
      adminEmail: req.session.adminEmail,
      notificacoesEstoque: notificacoesEstoque // Passa a lista de produtos para o template
    });

  } catch (error) {
    console.error("Erro ao carregar o dashboard do admin:", error);
    // Em caso de erro, renderiza o dashboard sem as notificações para não quebrar a página
    return res.render('admin/dashboard', { 
      adminEmail: req.session.adminEmail,
      notificacoesEstoque: [] 
    });
  }
});

// Rota para LISTAR todos os pedidos
router.get('/pedidos', requireAdminPin, async (req, res) => {
    try {
        const [pedidos] = await db.query(
            `SELECT 
                p.id, p.status, p.total, 
                DATE_FORMAT(p.criado_em, '%d/%m/%Y %H:%i') as data_formatada,
                u.nome as user_nome, u.email as user_email
             FROM pedidos p
             JOIN users u ON p.user_id = u.id
             ORDER BY p.criado_em DESC`
        );
        
        // Mapeia os status para exibição
        const statusMap = {
            'pendente': 'Pendente',
            'pago': 'Pago',
            'enviado': 'Enviado',
            'entregue': 'Entregue',
            'cancelado': 'Cancelado'
        };

        res.render('admin/pedidos', { 
            pedidos, 
            statusMap,
            message: req.query.message,
            adminEmail: req.session.adminEmail 
        });
    } catch (error) {
        console.error("Erro ao carregar lista de pedidos:", error);
        res.redirect('/admin?error=pedidos');
    }
});

// Rota para ver/editar UM pedido
router.get('/pedidos/:id', requireAdminPin, async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const [[pedido]] = await db.query(
            `SELECT 
                p.*, 
                DATE_FORMAT(p.criado_em, '%d/%m/%Y %H:%i') as data_formatada,
                u.nome as user_nome, u.email as user_email
             FROM pedidos p
             JOIN users u ON p.user_id = u.id
             WHERE p.id = ?`,
            [pedidoId]
        );

        if (!pedido) {
            return res.status(404).redirect('/admin/pedidos');
        }

        const [itens] = await db.query(
            `SELECT pi.*, prod.nome 
             FROM pedido_itens pi
             JOIN produtos prod ON pi.produto_id = prod.id
             WHERE pi.pedido_id = ?`,
            [pedidoId]
        );

        const allStatus = ['pendente', 'pago', 'enviado', 'entregue', 'cancelado'];

        res.render('admin/pedido-detalhe', {
            pedido,
            itens,
            allStatus,
            adminEmail: req.session.adminEmail
        });
    } catch (error) {
        console.error(`Erro ao carregar pedido ${req.params.id}:`, error);
        res.redirect('/admin/pedidos');
    }
});

// Rota para ATUALIZAR o pedido
router.post('/pedidos/:id', requireAdminPin, async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const { status, codigo_rastreamento } = req.body;

        // Se o status não for 'enviado', limpa o código de rastreio
        const codigoFinal = (status === 'enviado') ? codigo_rastreamento : null;

        await db.query(
            `UPDATE pedidos 
             SET status = ?, codigo_rastreamento = ? 
             WHERE id = ?`,
            [status, codigoFinal, pedidoId]
        );

        res.redirect('/admin/pedidos?message=Pedido atualizado com sucesso!');
    } catch (error) {
        console.error(`Erro ao atualizar pedido ${req.params.id}:`, error);
        res.redirect(`/admin/pedidos/${req.params.id}?error=true`);
    }
});

// Logout do admin
router.get('/logout', (req, res) => {
  if (req.session) {
    req.session.isAdmin = false;
    req.session.pinValidated = false;
    delete req.session.adminId;
    delete req.session.adminEmail;
    delete req.session.adminPin;
  }
  return res.redirect('/login');
});

// Rota pra quando for preciso o admin repor o estoque ou algo do tipo
router.post('/produtos/:id/repor', requireAdminPin, async (req, res) => {
  try {
    const produtoId = parseInt(req.params.id, 10);
    const qtd = parseInt(req.body.quantidade, 10);
    const LOW = 5;

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      return res.status(400).send('Produto inválido.');
    }
    if (!Number.isInteger(qtd) || qtd <= 0) {
      return res.status(400).send('Quantidade inválida.');
    }

    // Transação para calcular novo estoque e ajustar flags
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [[cur]] = await conn.query(
        'SELECT estoque FROM produtos WHERE id = ? FOR UPDATE',
        [produtoId]
      );
      if (!cur) {
        await conn.rollback();
        return res.status(404).send('Produto não encontrado.');
      }

      const novoEstoque = Math.max(0, Number(cur.estoque) + qtd);

      await conn.query(
        `UPDATE produtos
            SET estoque = ?,
                -- se voltou a ter estoque, zera OUT
                out_of_stock_notified = CASE WHEN ? > 0 THEN 0 ELSE out_of_stock_notified END,
                -- se ultrapassou o LOW, zera LOW; se ficou entre 1..LOW, zera LOW p/ permitir novo alerta se cair/oscilar
                low_stock_notified = 0
          WHERE id = ?`,
        [novoEstoque, novoEstoque, produtoId]
      );

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    return res.redirect('/admin');
  } catch (e) {
    console.error('[admin] falha ao repor estoque:', e);
    return res.status(500).send('Erro ao repor estoque.');
  }
});

// Use o roteador de produtos sob o prefixo /admin/produtos
router.use('/produtos', produtosAdminRouter);

module.exports = { adminRouter: router };