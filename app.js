const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
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
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
  } catch (err) {
    console.error('[admin.setup] Falha ao preparar tabela/seed de admin:', err);
    process.exit(1);
  }
})();