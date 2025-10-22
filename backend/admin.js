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

// Use o roteador de produtos sob o prefixo /admin/produtos
router.use('/produtos', produtosAdminRouter);

module.exports = { adminRouter: router };