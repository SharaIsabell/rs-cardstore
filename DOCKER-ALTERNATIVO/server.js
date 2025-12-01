require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();

// 1. Configura o motor de visualização (EJS)
// Aponta para a pasta onde estão os arquivos .ejs
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'frontend/ejs'));

// 2. Configura os arquivos estáticos (CSS, JS do front, Imagens)
// Isso permite que o navegador ache o /css/index.css, etc.
app.use(express.static(path.join(__dirname, 'frontend')));

// 3. Importa as suas rotas
const mainRouter = require('./backend/index'); // arquivo principal
const { adminRouter } = require('./backend/admin'); // arquivo de admin

// 4. Usa as rotas
// Tudo que for /admin vai para o roteador de admin
app.use('/admin', adminRouter);
// Todo o resto vai para o roteador principal
app.use('/', mainRouter);

// 5. INICIA O SERVIDOR 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`👉 Acesse: http://localhost:${PORT}`);
});