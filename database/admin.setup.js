const db = require('./pooldb');
const bcrypt = require('bcryptjs');

async function ensureAdminSchemaAndSeed() {
  // 1) Cria tabela do admin
  await db.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(100) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 2) Seed do admin con login (em produção temos que fazer algo pra esconder a senha)  
  const email = (process.env.ADMIN_EMAIL || 'admin@rscardstore.com').trim().toLowerCase();
  const plain = process.env.ADMIN_PASSWORD || 'adminrs123'; 
  const hash = await bcrypt.hash(plain, 12);

  const [rows] = await db.query('SELECT id FROM admins WHERE email = ?', [email]);
  if (rows.length === 0) {
    await db.query(
      'INSERT INTO admins (email, password_hash, is_active) VALUES (?, ?, 1)',
      [email, hash]
    );
    console.log('[admin.setup] Admin criado:', email);
  } else {
    await db.query('UPDATE admins SET is_active = 1 WHERE email = ?', [email]);
  }
}

module.exports = { ensureAdminSchemaAndSeed };