const express = require('express');
const app = express();
const path = require('path');
require('dotenv').config();

// Rotas
const routes = require('./backend/index');

// Configurações
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'frontend', 'ejs'));

// Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Rotas
app.use('/', routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));