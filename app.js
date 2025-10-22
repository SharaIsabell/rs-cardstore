const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
const db = require('./database/pooldb');
const { enviarEmailAlertaEstoque } = require('./frontend/js/enviarEmail');
require('dotenv').config();

app.use(session({
  secret: process.env.SESSION_SECRET || 'seu-segredo-super-secreto-aqui',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'frontend', 'ejs'));

// Middlewares globais
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// arquivos estáticos
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.static('public'));

// Rotas de cliente (mantém como já está no projeto)
const routes = require('./backend/index');
app.use('/', routes);

// Rotas do ADMIN (dashboard e logout; sem tela própria de login)
const { adminRouter } = require('./backend/admin');
app.use('/admin', adminRouter);

// Garantir que a tabela/seed do admin exista ANTES de subir o servidor
// (colocamos em /database por padrão do projeto)
const { ensureAdminSchemaAndSeed } = require('./database/admin.setup');

(async () => {
  try {
    await ensureAdminSchemaAndSeed();
    await ensureStockNotifyColumns();
    startStockWatcher();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
  } catch (err) {
    console.error('[admin.setup] Falha ao preparar tabela/seed de admin:', err);
    process.exit(1);
  }
})();

async function ensureStockNotifyColumns() {
  const [cols] = await db.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos'
      AND COLUMN_NAME IN ('low_stock_notified','out_of_stock_notified')
  `);
  const haveLow = cols.some(c => c.COLUMN_NAME === 'low_stock_notified');
  const haveOut = cols.some(c => c.COLUMN_NAME === 'out_of_stock_notified');

  if (!haveLow) {
    await db.query(`ALTER TABLE produtos
      ADD COLUMN low_stock_notified TINYINT(1) NOT NULL DEFAULT 0`);
  }
  if (!haveOut) {
    await db.query(`ALTER TABLE produtos
      ADD COLUMN out_of_stock_notified TINYINT(1) NOT NULL DEFAULT 0`);
  }
}

async function scanAndNotifyLowStock() {
  const LOW = parseInt( '5', 10);

  await db.query(`
    UPDATE produtos
       SET low_stock_notified = 0,
           out_of_stock_notified = 0
     WHERE estoque > ?
  `, [LOW]);

  const [lowRows] = await db.query(`
    SELECT id, nome, estoque, imagem_url
      FROM produtos
     WHERE estoque > 0
       AND estoque <= ?
       AND low_stock_notified = 0
  `, [LOW]);

  for (const p of lowRows) {
    try {
      await enviarEmailAlertaEstoque(p, 'LOW');
      await db.query(`UPDATE produtos SET low_stock_notified = 1 WHERE id = ?`, [p.id]);
    } catch (e) {
      console.error('[estoque] falha ao notificar LOW para id', p.id, e);
    }
  }

  const [outRows] = await db.query(`
    SELECT id, nome, estoque, imagem_url
      FROM produtos
     WHERE estoque = 0
       AND out_of_stock_notified = 0
  `);

  for (const p of outRows) {
    try {
      await enviarEmailAlertaEstoque(p, 'OUT');
      await db.query(`UPDATE produtos SET out_of_stock_notified = 1 WHERE id = ?`, [p.id]);
    } catch (e) {
      console.error('[estoque] falha ao notificar OUT para id', p.id, e);
    }
  }
}

function startStockWatcher() {
  const interval = parseInt( '600000', 10); // 10 min
  scanAndNotifyLowStock().catch(err => console.error('[estoque] scan inicial falhou:', err));
  setInterval(() => {
    scanAndNotifyLowStock().catch(err => console.error('[estoque] scan periódico falhou:', err));
  }, interval);
}